import {
  copyFileSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

interface ImportFile {
  path: string;
  content: string;
  summary: number | string;
}

/** Prepare a generated JSON file in the repository's canonical format. */
export function dataFile(path: string, data: unknown, summary: number | string): ImportFile {
  return { path, content: JSON.stringify(data, null, 1) + "\n", summary };
}

/** Prepare a README update only when its advertised skill count changes. */
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

interface StagedFile {
  path: string;
  directory: string;
  hadOriginal: boolean;
}

/** Stage every output beside its destination before replacing any of them. */
function publish(files: readonly ImportFile[]): void {
  const staged: StagedFile[] = [];
  const preserve = new Set<string>();
  let replaced = 0;
  try {
    for (const file of files) {
      const original = lstatSync(file.path, { throwIfNoEntry: false });
      if (original && !original.isFile()) {
        throw new Error(`Cannot replace ${file.path}: expected a regular file`);
      }
      const directory = mkdtempSync(join(dirname(file.path), ".gw1-import-"));
      staged.push({ path: file.path, directory, hadOriginal: original !== undefined });
      if (original) copyFileSync(file.path, join(directory, "original"));
      writeFileSync(join(directory, "updated"), file.content, { mode: original?.mode });
    }

    for (const file of staged) {
      renameSync(join(file.directory, "updated"), file.path);
      replaced++;
    }
  } catch (error) {
    const rollbackErrors: unknown[] = [];
    for (const file of staged.slice(0, replaced).reverse()) {
      try {
        if (file.hadOriginal) renameSync(join(file.directory, "original"), file.path);
        else rmSync(file.path);
      } catch (rollbackError) {
        preserve.add(file.directory);
        rollbackErrors.push(rollbackError);
      }
    }
    if (rollbackErrors.length > 0) {
      throw new AggregateError(
        [error, ...rollbackErrors],
        `Import failed and could not restore all files: ${error}. Remaining staging directories: ${[...preserve].join(", ")}`,
      );
    }
    throw error;
  } finally {
    for (const file of staged) {
      if (preserve.has(file.directory)) continue;
      try {
        rmSync(file.directory, { recursive: true, force: true });
      } catch (error) {
        console.warn(`Could not remove import staging directory ${file.directory}: ${error}`);
      }
    }
  }
}

/** Merge this import's provenance and publish it with the prepared files. */
export function writeImport(
  outDir: string,
  files: readonly ImportFile[],
  entries: Record<string, { sourceVersion?: string; generatedAt?: string; [key: string]: unknown }>,
  readme?: { path: string; count: number },
): void {
  mkdirSync(outDir, { recursive: true });
  // Both import commands share _meta.json. Hold the lock from reading the
  // previous entries through publication so simultaneous runs cannot lose keys.
  const lock = join(outDir, ".gw1-import-lock");
  try {
    mkdirSync(lock);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(
        `Another import holds ${lock}. If no import is running, remove that directory and retry.`,
        { cause: error },
      );
    }
    throw error;
  }
  try {
    const path = join(outDir, "_meta.json");
    const provenance = dataFile(
      path,
      { ...readProvenance(path), ...entries },
      Object.entries(entries)
        .map(([key, entry]) => `${key}=${entry.sourceVersion ?? entry.generatedAt ?? "updated"}`)
        .join(", "),
    );
    const outputs = [...files];
    // The README count describes the same snapshot as skills.json. Read it
    // under the import lock in case another skills import just updated it.
    const readmeChange = readme && syncReadmeSkillCount(readme.path, readme.count);
    if (readmeChange) outputs.push(readmeChange);
    outputs.push(provenance);
    publish(outputs);
    for (const file of outputs) console.log(`${basename(file.path)}: ${file.summary}`);
  } finally {
    try {
      rmdirSync(lock);
    } catch (error) {
      console.warn(`Could not release import lock ${lock}. Remove it before retrying: ${error}`);
    }
  }
}
