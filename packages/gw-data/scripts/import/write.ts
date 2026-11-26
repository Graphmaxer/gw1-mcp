import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

interface ImportFile {
  path: string;
  content: string;
  summary: number | string;
}

/** Prepare a generated JSON file in the repository's canonical format. */
export function dataFile(path: string, data: unknown, summary: number | string): ImportFile {
  return { path, content: JSON.stringify(data, null, 1) + "\n", summary };
}

/**
 * Prepare the README rewrite for the advertised skill count, or nothing when it
 * already matches.
 *
 * The count is advertised on purpose and `repository.test.ts` asserts README quotes
 * it EXACTLY, so the generator owns the number like every other derived byte: left
 * to a human, the first count change reds the weekly job (2026-08-10). Narrow on
 * purpose: only the digits in front of "skills" / "real skills", so it cannot
 * reflow a sentence.
 */
export function syncReadmeSkillCount(readmePath: string, count: number): ImportFile | undefined {
  const before = readFileSync(readmePath, "utf8");
  let changed = 0;
  const content = before.replace(/\b\d{3,5}(?= (?:real )?skills\b)/g, (found) => {
    if (found !== String(count)) changed++;
    return String(count);
  });
  if (changed === 0) return undefined;
  return { path: readmePath, content, summary: `${changed} skill-count mention(s) -> ${count}` };
}

/**
 * The committed provenance record, `{}` on a first run. A file that exists but is
 * not an object of entries is an error rather than a fresh start: merging into
 * `{}` would silently drop the other pipeline's key.
 */
function readProvenance(path: string): Record<string, unknown> {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
  try {
    const entries: unknown = JSON.parse(text);
    if (entries === null || typeof entries !== "object" || Array.isArray(entries)) {
      throw new Error("expected an object of provenance entries");
    }
    return entries as Record<string, unknown>;
  } catch (error) {
    throw new Error(`Invalid provenance in ${path}: ${error}`, { cause: error });
  }
}

/**
 * Write one import's files, then its provenance.
 *
 * Everything is PREPARED before anything is written: callers transform first and
 * hand over finished contents, and the provenance and README reads happen here
 * before the first write. So a failed validation leaves the committed data as it
 * was. Nothing stronger than that is attempted — no staging, no rollback, no lock.
 * The outputs are tracked files, so `git checkout` undoes a half-written run, and
 * the two import commands run one after the other in a single CI job.
 *
 * `_meta.json` records provenance for every generated file, one key per pipeline
 * (skills and skillNamesFr here, heroes in import-heroes.ts). Each run merges its
 * own keys into what is there, so the pipelines never clobber each other.
 */
export function writeImport(
  outDir: string,
  files: readonly ImportFile[],
  entries: Record<string, { sourceVersion?: string; generatedAt?: string; [key: string]: unknown }>,
  readme?: { path: string; count: number },
): void {
  const metaPath = join(outDir, "_meta.json");
  const outputs = [...files];
  const readmeChange = readme && syncReadmeSkillCount(readme.path, readme.count);
  if (readmeChange) outputs.push(readmeChange);
  outputs.push(
    dataFile(
      metaPath,
      { ...readProvenance(metaPath), ...entries },
      // What identifies each record in the log: its version when it has one
      // (skills, French names), otherwise the day it was generated (heroes).
      Object.entries(entries)
        .map(([key, entry]) => `${key}=${entry.sourceVersion ?? entry.generatedAt ?? "updated"}`)
        .join(", "),
    ),
  );

  mkdirSync(outDir, { recursive: true });
  for (const file of outputs) {
    writeFileSync(file.path, file.content);
    console.log(`${basename(file.path)}: ${file.summary}`);
  }
}
