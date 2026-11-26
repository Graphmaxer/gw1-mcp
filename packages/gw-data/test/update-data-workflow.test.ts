import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Everything that reads or EXECUTES `.github/workflows/update-data.yml`.
 *
 * The workflow's decisions live in shell inside YAML, which no unit test can
 * import: a regex in an `env:`, an inline node predicate, a path list, a block
 * of `gh` calls. Each of them has been wrong once in a way the suite could not
 * see, so they are extracted from the workflow TEXT and run here — a loosened
 * pattern or a typo fails in this suite, not in the next weekly run.
 *
 * One harness on purpose. The disarm tests used to be a `node:test` file under
 * `.github/tests/`, run by a single CI step: outside tsc, the linter, knip,
 * `pnpm verify` and the production build gate, and carrying a type error nobody
 * had been shown. Here they get all of those for free.
 */

const REPO_ROOT = resolve(import.meta.dirname, "../../..");
const COMMITTED_META = resolve(import.meta.dirname, "../data/_meta.json");
const workflow = readFileSync(join(REPO_ROOT, ".github/workflows/update-data.yml"), "utf8");

const meta = (sourceVersion: string) => JSON.stringify({ skills: { sourceVersion } });

/**
 * The runner executes these steps with bash; a contributor's machine may not have
 * one on PATH (a bare Windows shell), and `pnpm -r test` is also the pre-push gate.
 * CI runs on ubuntu and stays authoritative, so the bash-spawning tests skip
 * there rather than fail for a reason unrelated to the change being pushed.
 */
const hasBash = spawnSync("bash", ["--version"]).status === 0;

/**
 * The environment for a spawned shell, WITHOUT git's own variables. Git exports
 * GIT_DIR and friends to its hooks, and this suite runs inside the pre-push hook:
 * inherited, they would point the `git` calls below at the real repository
 * instead of the throwaway one.
 */
function shellEnv(extra: Partial<Record<string, string>>): NodeJS.ProcessEnv {
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
  );
  return { ...inherited, ...extra };
}

function runDisarm(state: Partial<Record<string, string>>) {
  const step = workflow.match(/^        id: disarm-auto-merge\n([\s\S]*?)(?=^      - )/m);
  expect(step?.[1], "expected a disarm step in the data update workflow").toBeTruthy();
  const script = step![1]!.split("        run: |\n")[1];
  expect(script, "expected a shell script in the disarm step").toBeTruthy();

  // Exercise the workflow's commands with a local stand-in for the GitHub CLI.
  return spawnSync(
    "bash",
    [
      "-euo",
      "pipefail",
      "-c",
      `
    disarmed=false
    gh() {
      case "$1 $2" in
        "api --paginate") printf '%s\n' "$PR_NUMBERS"; return "$LIST_STATUS" ;;
        "pr view")
          if [[ $disarmed == true ]]; then
            printf '%s\n' "$AFTER_DISARM"
          else
            printf '%s\n' "$ARMED"
          fi
          ;;
        "pr merge")
          echo "disarm $3"
          disarmed=true
          return "$DISARM_STATUS"
          ;;
        *) return 99 ;;
      esac
    }
    ${script}
  `,
    ],
    {
      encoding: "utf8",
      env: shellEnv({
        GITHUB_REPOSITORY: "example/gw1-mcp",
        GITHUB_REPOSITORY_OWNER: "example",
        DATA_PR_BRANCH: "chore/update-game-data",
        PR_NUMBERS: "42",
        LIST_STATUS: "0",
        ARMED: "true",
        AFTER_DISARM: "false",
        DISARM_STATUS: "0",
        ...state,
      }),
    },
  );
}

describe("a flagged update withdraws auto-merge before it pushes", () => {
  it("serializes shared branch updates and disarms the PR before pushing flagged data", () => {
    expect(workflow).toMatch(
      /^concurrency:\n  group: update-game-data\n  cancel-in-progress: false$/m,
    );
    expect(workflow).toMatch(
      /id: disarm-auto-merge\n        if: .*steps.desc.outputs.changed != 'false'/,
    );
    const disarm = workflow.indexOf("id: disarm-auto-merge");
    const push = workflow.indexOf("uses: peter-evans/create-pull-request");
    expect(disarm).toBeGreaterThan(0);
    expect(push).toBeGreaterThan(disarm);
  });

  it.skipIf(!hasBash)("disarms an armed PR and permits a missing or already disarmed PR", () => {
    for (const [state, expectedOutput] of [
      [{}, "disarm 42\n"],
      [{ PR_NUMBERS: "" }, ""],
      [{ ARMED: "false" }, ""],
    ] as const) {
      const result = runDisarm(state);
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toBe(expectedOutput);
    }
  });

  it.skipIf(!hasBash)("blocks a flagged update when lookup, disarm, or confirmation fails", () => {
    const failures: Partial<Record<string, string>>[] = [
      { LIST_STATUS: "1" },
      { DISARM_STATUS: "1" },
      { AFTER_DISARM: "true" },
    ];
    for (const state of failures) {
      const result = runDisarm(state);
      expect(result.status, result.stderr).toBe(1);
    }
  });
});

describe("the workflow invokes the CLI in a cwd-independent way", () => {
  it("passes absolute paths, since the runner's cwd is not guaranteed", () => {
    // A static lock on the call site itself. The unit tests and even the
    // subprocess tests in provenance-cli.test.ts all pass while the WORKFLOW still
    // hands over a relative path, so the argument style has to be asserted where
    // it lives.
    const invocation = workflow
      .split("\n")
      .filter((line) => line.includes("provenance-changed.ts") || line.includes("meta-before.json"))
      .join("\n");
    expect(invocation, "workflow must still call the script").toContain("provenance-changed.ts");
    // Every path argument must be absolute: rooted at $GITHUB_WORKSPACE, at
    // RUNNER_TEMP, or at /tmp. A bare `packages/...` argument is the run #20 bug.
    expect(invocation, "no repo-relative path arguments").not.toMatch(
      /provenance-changed\.ts[^\n]*\s(?!\$|\/)[\w.]+\//,
    );
    expect(invocation).toContain("$GITHUB_WORKSPACE");
  });

  it("carries every path the import writes into the PR, README included", () => {
    // The import job and the open-pr job are split so the privileged half never
    // runs upstream code, and they communicate through ONE path-scoped `git diff`.
    // Any file the import writes that is missing from that path list is silently
    // dropped: on 2026-08-31 README.md was, so the data PR carried 1516 skills next
    // to a README still advertising 1485, and the failure surfaced as a gw-data test
    // three packages from the cause. Worse, the import job was GREEN — `pnpm -r test`
    // runs there, where the rewrite still exists.
    //
    // Static, like the assertion above, and for the same reason: every unit test of
    // syncReadmeSkillCount passes while the patch that transports its output omits
    // the file. The three paths are the three things the import generates.
    const patchLine = workflow
      .split("\n")
      .find((line) => line.includes("git diff") && line.includes("data-update.patch"));
    expect(
      patchLine,
      "the workflow must still build the patch with a scoped git diff",
    ).toBeDefined();
    for (const path of [
      "packages/gw-data/data",
      "gwtoolbox-plugin/AccountExport/hero-names.generated.h",
      "README.md",
    ]) {
      expect(patchLine, `${path} must reach the open-pr job`).toContain(path);
    }
  });

  it("applies the import job's patch only to generated files (audit 2026-11-13)", () => {
    // The patch crosses the trust boundary the two-job split exists for: it is
    // produced by the job that runs unpinned upstream code and consumed by the job
    // that holds contents:write. A bare `git apply` let it rewrite the growth gate
    // that job then executes. The allowlist is a regex in the workflow's env, so it
    // is extracted and EXECUTED here against hostile paths — a loosened pattern
    // fails in this suite, not in a compromised weekly run.
    const pattern = /^\s*ALLOWED: '([^']+)'$/m.exec(workflow)?.[1];
    expect(pattern, "the apply step must still declare ALLOWED").toBeDefined();
    const allowed = new RegExp(pattern!);

    // Everything the import generates must pass, or the weekly job refuses itself.
    const generated = readdirSync(join(REPO_ROOT, "packages/gw-data/data"))
      .filter((f) => f !== "heroes-overlay.json")
      .map((f) => `packages/gw-data/data/${f}`);
    for (const path of [
      ...generated,
      "gwtoolbox-plugin/AccountExport/hero-names.generated.h",
      "README.md",
    ]) {
      expect(allowed.test(path), `${path} must be accepted`).toBe(true);
    }
    for (const path of [
      "packages/gw-data/scripts/description-growth.ts",
      "packages/gw-data/src/repository.ts",
      "packages/gw-data/data/heroes-overlay.json", // curated by hand, never generated
      "packages/gw-data/data/../scripts/description-growth.ts",
      "packages/gw-data/data/sub/skills.json",
      "packages/gw-data/data/skills.json.ts",
      ".github/workflows/update-data.yml",
      "package.json",
      "docs/README.md",
      '"packages/gw-data/data/skills.json"', // git quotes unusual paths
      "packages/gw-data/data/a.json => packages/gw-data/scripts/b.ts",
    ]) {
      expect(allowed.test(path), `${path} must be refused`).toBe(false);
    }

    // And the step must consult git's own view of the patch BEFORE applying it:
    // touched paths, plus creates/deletes/renames/mode changes.
    const step = workflow.slice(workflow.indexOf("Apply the imported data"));
    const applyAt = step.indexOf("\n          git apply /tmp/data-update.patch");
    expect(applyAt, "the patch must still be applied").toBeGreaterThan(0);
    const before = step.slice(0, applyAt);
    expect(before).toContain("git apply --numstat /tmp/data-update.patch");
    expect(before).toContain("git apply --summary /tmp/data-update.patch");
    expect(before).toContain("exit 1");
  });

  it.skipIf(!hasBash)("refuses a README change that is more than the skill count", () => {
    // The allowlist above judges PATHS. README.md is on it because the import owns
    // the advertised skill count, and it is the one allowlisted file whose content
    // no test in the PR's CI covers beyond that count — so a patch from the
    // untrusted job could rewrite an install command or the server URL and still
    // auto-merge. The workflow compares the two WHOLE files with the counts
    // stripped; those lines are extracted and executed here in a throwaway
    // repository, against the working tree as `git apply` would have left it.
    const step = workflow.slice(workflow.indexOf("Apply the imported data"));
    const marker = "\n          git apply /tmp/data-update.patch\n";
    const start = step.indexOf(marker);
    expect(start, "the patch must still be applied").toBeGreaterThan(0);
    // To the end of the step's `run:` block: the first line indented less than it.
    const check = step.slice(start + marker.length).split(/\n {0,8}\S/, 1)[0]!;
    expect(check, "the README check must follow the apply").toContain("README.md");
    expect(check).toContain("exit 1");

    const committed =
      "# gw1-mcp\n\nKnows 1516 skills (1516 real skills, no guesses).\n\n" +
      "Install: `claude mcp add gw1 https://example.test/mcp` on port 8787.\n";
    const verdict = (patched: string): number | null => {
      const repo = mkdtempSync(join(tmpdir(), "gw1-readme-gate-"));
      const run = (command: string, args: string[]) =>
        spawnSync(command, args, {
          cwd: repo,
          encoding: "utf8",
          env: shellEnv({ RUNNER_TEMP: repo }),
        });
      writeFileSync(join(repo, "README.md"), committed);
      for (const args of [
        ["init", "--quiet"],
        ["add", "README.md"],
        ["-c", "user.name=t", "-c", "user.email=t@example.test", "commit", "--quiet", "-m", "init"],
      ]) {
        expect(run("git", args).status, `git ${args.join(" ")}`).toBe(0);
      }
      writeFileSync(join(repo, "README.md"), patched);
      // `bash -e`, as the runner executes a `run:` step with no explicit shell.
      return run("bash", ["-e", "-c", check]).status;
    };

    // What the import is entitled to do, and a run that changes no count at all.
    expect(verdict(committed.replaceAll("1516", "1520"))).toBe(0);
    expect(verdict(committed)).toBe(0);
    // Anything else, even alongside a legitimate count change.
    expect(verdict(committed.replaceAll("1516", "1520") + "\nAlso run this script.\n")).toBe(1);
    expect(verdict(committed.replace("example.test", "evil.test"))).toBe(1);
    // A number that is not a skill count is prose like any other.
    expect(verdict(committed.replace("8787", "9999"))).toBe(1);
    // An emptied file must not pass by comparing nothing with nothing.
    expect(verdict("")).toBe(1);
  });

  it("never lets the npm fallback downgrade Pages-sourced data (run #26)", () => {
    // Run #26 (2026-09-28): the Pages import was refused, the fallback rewrote
    // skills.json from npm 2.0.0 — 31 skills behind Pages — and the job died on a
    // French-table assertion naming neither cause. The guard is a shell `if` around
    // an inline node predicate, so no unit test can reach it: this extracts the
    // predicate from the workflow and EXECUTES it, so a typo in the JSON path (which
    // would make the predicate throw, i.e. exit non-zero, i.e. "keep the downgrade")
    // fails here instead of in the next degraded run.
    const lines = workflow.split("\n");
    const guard = lines.find((l) => l.includes("git show HEAD:packages/gw-data/data/_meta.json |"));
    expect(guard, "the fallback branch must still check the committed provenance").toBeDefined();
    const script = /node -e '([^']+)'/.exec(guard!)?.[1];
    expect(script, "the guard must still be an inline node predicate").toBeDefined();
    const decide = (input: string) =>
      spawnSync(process.execPath, ["-e", script!], { input, encoding: "utf8" }).status;
    expect(decide(meta("pages@8495ca2c6125 (sha256 skilldata:e6342516cb033f1e)"))).toBe(0);
    expect(decide(meta("npm:2.0.0"))).toBe(1);
    expect(decide(readFileSync(COMMITTED_META, "utf8")), "the real committed record").toBe(
      JSON.parse(readFileSync(COMMITTED_META, "utf8")).skills.sourceVersion.startsWith("pages")
        ? 0
        : 1,
    );
    // The revert must cover everything the import writes (heroes run after it).
    const revert = lines.find((l) => l.trim().startsWith("git checkout -- packages/gw-data/data"));
    expect(revert, "the fallback must still revert its data").toContain("README.md");
  });
});
