import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const workflow = readFileSync(new URL("../workflows/update-data.yml", import.meta.url), "utf8");

function runDisarm(state: Record<string, string>) {
  const step = workflow.match(/^        id: disarm-auto-merge\n([\s\S]*?)(?=^      - )/m);
  assert.ok(step?.[1], "expected a disarm step in the data update workflow");
  const script = step[1].split("        run: |\n")[1];
  assert.ok(script, "expected a shell script in the disarm step");

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
      env: {
        ...process.env,
        GITHUB_REPOSITORY: "example/gw1-mcp",
        GITHUB_REPOSITORY_OWNER: "example",
        DATA_PR_BRANCH: "chore/update-game-data",
        PR_NUMBERS: "42",
        LIST_STATUS: "0",
        ARMED: "true",
        AFTER_DISARM: "false",
        DISARM_STATUS: "0",
        ...state,
      },
    },
  );
}

test("serializes shared branch updates and disarms the PR before pushing flagged data", () => {
  assert.match(workflow, /^concurrency:\n  group: update-game-data\n  cancel-in-progress: false$/m);
  assert.match(
    workflow,
    /id: disarm-auto-merge\n        if: .*steps.desc.outputs.changed != 'false'/,
  );
  const disarm = workflow.indexOf("id: disarm-auto-merge");
  const push = workflow.indexOf("uses: peter-evans/create-pull-request");
  assert.ok(disarm > 0 && push > disarm);
});

test("disarms an armed PR and permits a missing or already disarmed PR", () => {
  for (const [state, expectedOutput] of [
    [{}, "disarm 42\n"],
    [{ PR_NUMBERS: "" }, ""],
    [{ ARMED: "false" }, ""],
  ] as const) {
    const result = runDisarm(state);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, expectedOutput);
  }
});

test("blocks a flagged update when lookup, disarm, or confirmation fails", () => {
  for (const state of [{ LIST_STATUS: "1" }, { DISARM_STATUS: "1" }, { AFTER_DISARM: "true" }]) {
    const result = runDisarm(state);
    assert.equal(result.status, 1, result.stderr);
  }
});
