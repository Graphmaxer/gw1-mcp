/**
 * Answer one question for `update-data.yml`: did this import change WHICH
 * CHANNEL the data came from, as opposed to only the date and the content
 * hashes?
 *
 * Why this exists. The weekly job's change detection deliberately reverts
 * `_meta.json` when it is the only file that moved, because every run rewrites
 * the import date and a PR that bumps nothing but a date is noise. The cost of
 * that, discovered on 2026-08-17 by re-running the workflow by hand (run #19):
 * provenance can only ever reach the repository riding alongside a real data
 * change. Run #19 took the real Pages path for the first time since the 2.x
 * constant-table fix, computed `pages@e32dbdc4e0ec` with all five sha256
 * hashes — and threw it away, because upstream had not touched a skill. So the
 * committed record still read `npm:2.0.0`, the mode the fallback had written
 * weeks earlier, and nothing in the repository showed the Pages path was
 * working again.
 *
 * That is the same class of problem as the fallback being silent, in mirror
 * image: there a green run hid bad news, here a green run carried good news
 * that nothing persisted. A reader three weeks later would still conclude, from
 * the repository alone, that the importer was degraded.
 *
 * So: a change of KIND (`npm` <-> `pages`) is worth a commit on its own, and a
 * change of date, version or hashes within the same kind is not. Deliberately
 * narrow — this is the signal that answers "which importer path produced what
 * is committed", and nothing else.
 *
 * Run: tsx scripts/provenance-changed.ts <before.json> <after.json>
 * Prints `changed` or `unchanged` on one line, for the workflow to capture.
 * Failure modes: a missing or unparseable BEFORE file is treated as a first
 * import (`changed`), because "we have no record" is exactly when a record is
 * worth writing; an unreadable AFTER file exits non-zero, since that means the
 * import itself produced something unusable.
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/**
 * The channel an import came through, taken from a `sourceVersion` string.
 *
 * `npm:2.0.0` -> `npm`; `pages@e32dbdc4e0ec (sha256 ...)` -> `pages`;
 * `pages:2026-08-17 (...)` -> `pages` (the shape used when `git ls-remote`
 * fails and provenance falls back to the fetch date).
 *
 * Splitting on both separators rather than one is what makes that third shape
 * classify with the second instead of becoming its own kind.
 */
export function provenanceSourceKind(sourceVersion: unknown): string {
  if (typeof sourceVersion !== "string") return "unknown";
  const kind = sourceVersion.split(/[:@\s]/, 1)[0] ?? "";
  return kind.length > 0 ? kind : "unknown";
}

/** Read one pipeline's `sourceVersion` out of a `_meta.json` document. */
function sourceVersionOf(metaJson: string, key: string): unknown {
  const meta = JSON.parse(metaJson) as Record<string, { sourceVersion?: unknown }>;
  return meta[key]?.sourceVersion;
}

/**
 * True when the provenance kind differs between two `_meta.json` documents —
 * i.e. when the committed record would otherwise keep naming a channel that is
 * no longer the one in use.
 *
 * `before` accepts undefined for the first-import case.
 */
export function provenanceKindChanged(
  before: string | undefined,
  after: string,
  key = "skills",
): boolean {
  let beforeKind = "unknown";
  if (before !== undefined) {
    try {
      beforeKind = provenanceSourceKind(sourceVersionOf(before, key));
    } catch {
      // Unparseable history reads as "no record", not as "no change" — the
      // fail-OPEN direction, matching the growth gate's own correction.
      return true;
    }
  }
  return beforeKind !== provenanceSourceKind(sourceVersionOf(after, key));
}

function main(): void {
  const [beforePath, afterPath] = process.argv.slice(2);
  if (!beforePath || !afterPath) {
    throw new Error("usage: provenance-changed.ts <before.json> <after.json>");
  }
  let before: string | undefined;
  try {
    before = readFileSync(beforePath, "utf8");
  } catch {
    // No committed provenance yet (first import, or the file is new).
  }
  const after = readFileSync(afterPath, "utf8");
  console.log(provenanceKindChanged(before, after) ? "changed" : "unchanged");
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  try {
    main();
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
