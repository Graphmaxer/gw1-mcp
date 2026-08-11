import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Writes one data file with a one-line count log. */
export function writeData(
  outDir: string,
  name: string,
  data: unknown,
  count: number | string,
): void {
  writeFileSync(join(outDir, name), JSON.stringify(data, null, 1) + "\n");
  console.log(`${name}: ${count}`);
}

/**
 * Rewrite the skill count quoted in README prose.
 *
 * The count is advertised on purpose, and `repository.test.ts` asserts README
 * quotes it EXACTLY — which made it a one-way ratchet on the only automated path
 * that can change it. `update-data.yml` regenerates `data/*.json` and a C++
 * header but never touched README, so the first count change reds the weekly job
 * until a human edits prose. That is the opposite of the zero-touch pipeline it
 * is sold as, and it is what blocked the 2026-08-10 run.
 *
 * So the generator now owns the number, like every other derived byte in the repo
 * ("no unmanaged copies"). Narrow on purpose: it rewrites the digits in front of
 * "skills" / "real skills" and nothing else, so it cannot reflow a sentence.
 *
 * @returns how many occurrences changed, for the caller's log.
 */
export function syncReadmeSkillCount(readmePath: string, count: number): number {
  const before = readFileSync(readmePath, "utf8");
  let changed = 0;
  const after = before.replace(/\b\d{3,5}(?= (?:real )?skills\b)/g, (found) => {
    if (found !== String(count)) changed++;
    return String(count);
  });
  if (changed > 0) writeFileSync(readmePath, after);
  return changed;
}

/**
 * _meta.json records provenance for EVERY generated data file, one key per
 * pipeline (skills here, heroes in import-heroes.ts). Each generator
 * read-merge-writes its own key so independent runs never clobber each other.
 */
export function mergeProvenance(outDir: string, key: string, entry: unknown): void {
  let existing: Record<string, unknown> = {};
  try {
    existing = JSON.parse(readFileSync(join(outDir, "_meta.json"), "utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    // first run: no _meta.json yet
  }
  writeData(
    outDir,
    "_meta.json",
    { ...existing, [key]: entry },
    String(entry && (entry as { sourceVersion?: string }).sourceVersion),
  );
}
