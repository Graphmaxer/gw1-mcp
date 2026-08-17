/**
 * Does an incoming data import change descriptions in a way that deserves human
 * eyes? (audit C1, calibrated against upstream history 2026-07-24.)
 *
 * The first version of this check withheld auto-merge whenever any description
 * line changed. Measuring build-wars/gw-skilldata proved that unworkable: 97% of
 * descriptions embed the numbers a balance patch edits, and legitimate upstream
 * commits reword text wholesale — 6e05969 changed 301 description fields in one
 * go ("spells does not" -> "spell[s] do[es] not"). A gate that fires every week
 * is not review, it is rubber-stamping.
 *
 * What an injected instruction looks like instead is ADDED TEXT. Across the
 * whole upstream history the largest growth of any single description in a
 * legitimate commit is +56 characters (distribution: 0, 0, 1, 10, 19, 53, 56
 * over the 7 commits that touch descriptions). 80 keeps a 1.4x margin over that
 * maximum while still catching a payload of ~81 characters or more; 120, tried
 * first, let a realistic 97-character injection through for no gain in false
 * positives, since every threshold from 60 upward fires 0/7 on real history.
 *
 * Second net, not the first: assertPlausibleDescription() in transform.ts
 * hard-fails the import on URLs, unexpected tags, over-length text and
 * instruction-shaped phrasing. This catches the shape such a payload has if it
 * dodges those patterns.
 *
 * ZERO DEPENDENCIES, and that constraint is load-bearing rather than tidy: this
 * runs in the privileged `open-pr` job, which has no `pnpm install` and must
 * never gain one — that job holds contents:write and the app token, and the
 * whole point of the two-job split is that it never executes third-party code.
 * It is therefore run by BARE `node`, using the type stripping that has been
 * unflagged since Node 22.18, which is why the workflow pins Node with
 * actions/setup-node rather than trusting the runner image's default.
 *
 * It was two `.mjs` files until 2026-08-17. TypeScript costs nothing here — node
 * strips the annotations and never sees them — and buys what the rest of the repo
 * already has: `tsc` now checks these 100-odd lines, which it silently did not
 * before (verified by planting `const oops: number = "not a number"` in the old
 * `.mjs` and watching typecheck pass). Merging the pair also removes a
 * cross-file import, so nothing needs `allowImportingTsExtensions`, and it puts
 * the CLI back inside the ONE script archetype: the old entry point ran
 * `execFileSync` at module top level, so importing it would have shelled out to
 * git.
 *
 * Run: node packages/gw-data/scripts/description-growth.ts >> "$GITHUB_OUTPUT"
 * Prints `changed=true|false` on stdout; findings and faults go to stderr.
 * Failure modes: NEVER exits non-zero — its only job is to decide whether a
 * human reads the diff before it merges — but any git fault it cannot interpret
 * prints `changed=true`, because withholding the merge is the safe direction.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export interface SkillDescription {
  id: number;
  name: string;
  description: string;
}

export interface GrowthFinding {
  id: number;
  name: string;
  growth: number;
  before: string;
  after: string;
}

export const MAX_DESCRIPTION_GROWTH = 80;

/** Descriptions that grew by more than the threshold, worst first. */
export function findDescriptionGrowth(
  before: readonly SkillDescription[],
  after: readonly SkillDescription[],
  threshold: number = MAX_DESCRIPTION_GROWTH,
): GrowthFinding[] {
  const previous = new Map(before.map((s) => [s.id, s]));
  const findings: GrowthFinding[] = [];
  for (const skill of after) {
    const old = previous.get(skill.id);
    // A brand-new skill has no baseline to grow from; its text still goes
    // through the plausibility gate at import time.
    if (!old) continue;
    const growth = skill.description.length - old.description.length;
    if (growth > threshold) {
      findings.push({
        id: skill.id,
        name: skill.name,
        growth,
        before: old.description,
        after: skill.description,
      });
    }
  }
  return findings.sort((a, b) => b.growth - a.growth);
}

const DATA_PATH = "packages/gw-data/data/skills.json";

function main(): void {
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();

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

  let committed: SkillDescription[] = [];
  if (isTracked) {
    try {
      committed = JSON.parse(
        execFileSync("git", ["show", `HEAD:${DATA_PATH}`], {
          encoding: "utf8",
          maxBuffer: 64 << 20,
          cwd: root,
        }),
      ) as SkillDescription[];
    } catch (error) {
      // The file is tracked, so a baseline must exist: this is a real fault, and
      // withholding auto-merge is the only safe answer.
      console.error(`Could not read the committed baseline for ${DATA_PATH}: ${error}`);
      console.log("changed=true");
      return;
    }
  }

  const findings = findDescriptionGrowth(
    committed,
    JSON.parse(readFileSync(`${root}/${DATA_PATH}`, "utf8")) as SkillDescription[],
  );

  for (const f of findings) {
    console.error(`${f.name} (id ${f.id}) grew by ${f.growth} characters:`);
    console.error(`  before: ${JSON.stringify(f.before)}`);
    console.error(`  after:  ${JSON.stringify(f.after)}`);
  }
  console.log(`changed=${findings.length > 0}`);
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  main();
}
