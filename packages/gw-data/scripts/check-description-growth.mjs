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

let committed = [];
try {
  committed = JSON.parse(
    execFileSync("git", ["show", `HEAD:${DATA_PATH}`], {
      encoding: "utf8",
      maxBuffer: 64 << 20,
      cwd: root,
    }),
  );
} catch {
  // No baseline (first import): the plausibility gate is the only check that applies.
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
