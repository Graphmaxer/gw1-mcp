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
