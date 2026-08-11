/**
 * CI entry point for the description-growth check (calibration in
 * description-growth.mjs). Compares the committed skills.json against the
 * working tree after the import patch is applied and prints
 * `changed=true|false` for $GITHUB_OUTPUT. Never fails the job: its only job is
 * to decide whether a human reads the diff before it merges.
 *
 * Run with bare `node` — no install, no dependencies. See description-growth.mjs
 * for why that constraint exists.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { findDescriptionGrowth } from "./description-growth.mjs";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const DATA_PATH = "packages/gw-data/data/skills.json";

// "No baseline" and "git failed" are NOT the same thing, and conflating them made
// this gate fail-OPEN: any git fault silently produced `changed=false` and the
// weekly PR auto-merged unreviewed (audit L3). Ask git-ls-files whether the file
// is tracked at all, and treat every other fault as "a human must look".
// `git ls-files <path>` prints the path when tracked and nothing when not, and
// exits 0 either way — so an empty result really does mean "first import" rather
// than "the command broke".
const isTracked =
  execFileSync("git", ["ls-files", "--", DATA_PATH], {
    encoding: "utf8",
    cwd: root,
  }).trim().length > 0;

let committed = [];
if (isTracked) {
  try {
    committed = JSON.parse(
      execFileSync("git", ["show", `HEAD:${DATA_PATH}`], {
        encoding: "utf8",
        maxBuffer: 64 << 20,
        cwd: root,
      }),
    );
  } catch (error) {
    // The file is tracked, so a baseline must exist: this is a real fault, and
    // withholding auto-merge is the only safe answer.
    console.error(`Could not read the committed baseline for ${DATA_PATH}: ${error}`);
    console.log("changed=true");
    process.exit(0);
  }
}

const findings = findDescriptionGrowth(
  committed,
  JSON.parse(readFileSync(`${root}/${DATA_PATH}`, "utf8")),
);

for (const f of findings) {
  console.error(`${f.name} (id ${f.id}) grew by ${f.growth} characters:`);
  console.error(`  before: ${JSON.stringify(f.before)}`);
  console.error(`  after:  ${JSON.stringify(f.after)}`);
}
console.log(`changed=${findings.length > 0}`);
