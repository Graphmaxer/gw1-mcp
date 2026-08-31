import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Runs provenance-changed.ts as a SUBPROCESS, which the unit tests cannot do
 * and which is the only way the bug that broke the weekly job shows up.
 *
 * Run #20 died with ENOENT because the workflow invoked the script through
 * `pnpm --filter <pkg> exec` — which chdirs into `packages/gw-data` — while
 * passing repo-root-relative paths, so `packages/gw-data/data/_meta.json`
 * resolved to `packages/gw-data/packages/gw-data/data/_meta.json`. Every unit
 * test passed throughout: they import the pure function and never touch a path
 * or a working directory. The manual check passed too, for the worse reason —
 * the bad path was supplied as BEFORE, where a read failure is deliberately
 * swallowed as "no record", so it printed `changed` and looked correct.
 *
 * So these run the real file, from a cwd that is NOT the repo root, and assert
 * on exit codes and stdout. That covers the argument contract the workflow
 * actually depends on, rather than the function behind it.
 */

const SCRIPT = resolve(import.meta.dirname, "../scripts/provenance-changed.ts");
const REPO_ROOT = resolve(import.meta.dirname, "../../..");
const COMMITTED_META = resolve(import.meta.dirname, "../data/_meta.json");

const meta = (sourceVersion: string) => JSON.stringify({ skills: { sourceVersion } });

/**
 * Invoke exactly as a caller would: tsx + two path arguments.
 *
 * spawnSync rather than execFileSync because BOTH streams are needed on BOTH
 * outcomes — execFileSync returns stdout alone on success and only exposes
 * stderr by throwing, which silently made the stderr assertions below vacuous
 * on the passing paths.
 */
function run(args: string[], cwd: string): { status: number; stdout: string; stderr: string } {
  const result = spawnSync("npx", ["tsx", SCRIPT, ...args], { cwd, encoding: "utf8" });
  return {
    status: result.status ?? 1,
    stdout: (result.stdout ?? "").trim(),
    stderr: result.stderr ?? "",
  };
}

describe("provenance-changed CLI (subprocess, as the workflow calls it)", () => {
  const dir = mkdtempSync(join(tmpdir(), "prov-cli-"));
  const npmMeta = join(dir, "before-npm.json");
  const pagesMeta = join(dir, "after-pages.json");
  writeFileSync(npmMeta, meta("npm:2.0.0"));
  writeFileSync(pagesMeta, meta("pages@e32dbdc4e0ec (sha256 skilldata:2f4bcec2bdec14fd)"));

  it("prints exactly one word on stdout, so a shell can capture it", () => {
    const { status, stdout } = run([npmMeta, pagesMeta], REPO_ROOT);
    expect(status).toBe(0);
    // Diagnostics go to stderr on purpose: stdout is the machine-readable answer.
    expect(stdout).toBe("changed");
  });

  it("answers unchanged for a same-channel bump", () => {
    const { status, stdout } = run([pagesMeta, pagesMeta], REPO_ROOT);
    expect(status).toBe(0);
    expect(stdout).toBe("unchanged");
  });

  it("works against the real committed _meta.json", () => {
    // End-to-end on the actual file the workflow reads, not a fixture.
    const { status, stdout } = run([COMMITTED_META, pagesMeta], REPO_ROOT);
    expect(status).toBe(0);
    expect(["changed", "unchanged"]).toContain(stdout);
  });

  it("FAILS LOUDLY when the after path does not resolve — the run #20 bug", () => {
    // The exact shape of the break: a repo-root-relative path, evaluated from
    // the package directory. Before the fix this exited 1 with a bare ENOENT;
    // it must still exit non-zero, but now name the resolved path and the cwd
    // so the job log explains itself.
    const { status, stderr } = run(
      [npmMeta, "packages/gw-data/data/_meta.json"],
      join(REPO_ROOT, "packages/gw-data"),
    );
    expect(status).not.toBe(0);
    expect(stderr).toContain("packages/gw-data/packages/gw-data/data/_meta.json");
    expect(stderr).toMatch(/working directory|cwd/);
  });

  it("does not let a mistyped AFTER path masquerade as a decision", () => {
    // The failure mode that hid the bug: a bad path must never print a verdict.
    const { status, stdout } = run([npmMeta, join(dir, "nope.json")], REPO_ROOT);
    expect(status).not.toBe(0);
    expect(stdout).toBe("");
  });

  it("still treats a genuinely absent BEFORE file as a first import", () => {
    // This one SHOULD be swallowed — but it must say so on stderr, since the
    // silence is what made the cwd bug look healthy.
    const { status, stdout, stderr } = run([join(dir, "no-history.json"), pagesMeta], REPO_ROOT);
    expect(status).toBe(0);
    expect(stdout).toBe("changed");
    expect(stderr).toContain("first import");
  });

  it("is cwd-independent when given absolute paths, which is what the workflow passes", () => {
    // The property the fix relies on: same answer from anywhere.
    for (const cwd of [REPO_ROOT, join(REPO_ROOT, "packages/gw-data"), dir]) {
      const { status, stdout } = run([npmMeta, pagesMeta], cwd);
      expect(status, `cwd=${cwd}`).toBe(0);
      expect(stdout, `cwd=${cwd}`).toBe("changed");
    }
  });
});

describe("the workflow invokes the CLI in a cwd-independent way", () => {
  it("passes absolute paths, since the runner's cwd is not guaranteed", async () => {
    // A static lock on the call site itself. The unit tests and even the
    // subprocess tests above all pass while the WORKFLOW still hands over a
    // relative path, so the argument style has to be asserted where it lives.
    const { readFileSync } = await import("node:fs");
    const yaml = readFileSync(join(REPO_ROOT, ".github/workflows/update-data.yml"), "utf8");
    const invocation = yaml
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

  it("carries every path the import writes into the PR, README included", async () => {
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
    const { readFileSync } = await import("node:fs");
    const yaml = readFileSync(join(REPO_ROOT, ".github/workflows/update-data.yml"), "utf8");
    const patchLine = yaml
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
});
