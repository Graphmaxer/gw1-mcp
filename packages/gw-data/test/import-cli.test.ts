import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const generated = [
  "_meta.json",
  "attributes.json",
  "campaigns.json",
  "professions.json",
  "skill-names-fr.json",
  "skill-types.json",
  "skills.json",
];
const entry = {
  id: 1,
  name: "Healing Signet",
  description: "Heal yourself.",
  concise: "Heal yourself.",
};

describe("skill import publishes a complete snapshot", () => {
  let root: string;
  let scripts: string;
  let output: string;
  let source: string;
  let upstreamFiles: string;
  let readme: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "gw1-import-cli-"));
    const pkg = join(root, "packages", "gw-data");
    scripts = join(pkg, "scripts");
    output = join(pkg, "data");
    source = join(root, "upstream");
    upstreamFiles = join(source, "data", "json-full");
    const schemas = join(source, "data", "schemas");
    readme = join(root, "README.md");
    mkdirSync(output, { recursive: true });
    mkdirSync(upstreamFiles, { recursive: true });
    mkdirSync(schemas, { recursive: true });
    mkdirSync(join(source, "es6"));
    mkdirSync(join(pkg, "node_modules"));
    // Run bare Node like the CLI in CI. Resolve just its installed schema validator.
    symlinkSync(
      dirname(require.resolve("ajv/package.json")),
      join(pkg, "node_modules", "ajv"),
      "junction",
    );
    cpSync(new URL("../scripts", import.meta.url), scripts, { recursive: true });
    cpSync(new URL("../src/normalize.ts", import.meta.url), join(pkg, "src", "normalize.ts"));
    writeFileSync(join(root, "package.json"), '{"type":"module"}');
    writeFileSync(join(source, "package.json"), '{"type":"module","version":"2.0.0"}');
    writeFileSync(
      join(source, "es6", "index.js"),
      `
      export const CAMPAIGNS = [{ name: { en: "Core" } }];
      export const PROFESSIONS = [{ name: { en: "None" }, abbr: { en: "X" } }];
      export const ATTRIBUTES = { 101: { name: { en: "No Attribute" }, prof: 0, pri: false, max: 0 } };
      export const SKILLTYPES = { 1: { name: { en: "Skill" } } };
    `,
    );
    for (const file of ["skilldata.schema.json", "skilldesc.schema.json"]) {
      writeFileSync(join(schemas, file), '{"type":"object"}');
    }
    writeFileSync(
      join(upstreamFiles, "skilldata.json"),
      JSON.stringify({
        skilldata: {
          1: {
            id: 1,
            campaign: 0,
            profession: 0,
            attribute: 101,
            type: 1,
            is_elite: false,
            is_rp: false,
            is_pvp: false,
            pvp_split: false,
            split_id: 0,
            upkeep: 0,
            energy: 7,
            activation: 1,
            recharge: 10,
            adrenaline: 0,
            sacrifice: 0,
            overcast: 0,
          },
        },
      }),
    );
    writeFileSync(
      join(upstreamFiles, "skilldesc-en.json"),
      JSON.stringify({ skilldesc: { 1: entry } }),
    );
    setFrenchName("Sceau de guérison");
    for (const file of generated) {
      writeFileSync(join(output, file), "[]\n");
    }
    writeFileSync(join(output, "_meta.json"), '{"heroes":{"generatedAt":"2026-09-01"}}\n');
    writeFileSync(readme, "Contains 100 skills.\n");
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function setFrenchName(name: string) {
    writeFileSync(
      join(upstreamFiles, "skilldesc-fr.json"),
      JSON.stringify({ skilldesc: { 1: { ...entry, name } } }),
    );
  }

  function runImport() {
    return spawnSync(process.execPath, [join(scripts, "import.ts"), source], { encoding: "utf8" });
  }

  function snapshot() {
    return [...generated.map((name) => join(output, name)), readme].map((path) =>
      readFileSync(path, "utf8"),
    );
  }

  it("keeps the previous files when the French name fails validation", () => {
    setFrenchName("   ");
    const before = snapshot();
    const result = runImport();
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Implausible French skill name at 1: empty/);
    expect(snapshot()).toEqual(before);
  });

  it.each(['{"heroes":', "[]", "null"])("rejects invalid existing provenance %s", (provenance) => {
    writeFileSync(join(output, "_meta.json"), provenance);
    const before = snapshot();
    const result = runImport();
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/_meta\.json/);
    expect(snapshot()).toEqual(before);
  });

  it("keeps earlier artifacts when another output path cannot be replaced", () => {
    const path = join(output, "skills.json");
    rmSync(path);
    mkdirSync(path);
    const campaigns = readFileSync(join(output, "campaigns.json"), "utf8");
    const result = runImport();
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/skills\.json/);
    expect(readFileSync(join(output, "campaigns.json"), "utf8")).toBe(campaigns);
  });

  it("leaves a concurrent import's lock and files alone", () => {
    const lock = join(output, ".gw1-import-lock");
    mkdirSync(lock);
    const before = snapshot();
    const result = runImport();
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Another import holds .*\.gw1-import-lock/);
    expect(result.stderr).toMatch(/If no import is running, remove that directory and retry/);
    expect(snapshot()).toEqual(before);
    expect(() => mkdirSync(lock)).toThrow(/EEXIST/);
  });

  it("takes the import lock before reading the shared README", () => {
    mkdirSync(join(output, ".gw1-import-lock"));
    rmSync(readme);
    const result = runImport();
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Another import holds .*\.gw1-import-lock/);
  });

  it("publishes the transformed files and preserves existing hero provenance", () => {
    const result = runImport();
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(JSON.parse(readFileSync(join(output, "skills.json"), "utf8"))).toEqual([
      expect.objectContaining({ id: 1, name: "Healing Signet", energy: 7 }),
    ]);
    expect(JSON.parse(readFileSync(join(output, "skill-names-fr.json"), "utf8"))).toEqual({
      1: "Sceau de guérison",
    });
    expect(JSON.parse(readFileSync(join(output, "_meta.json"), "utf8"))).toMatchObject({
      heroes: { generatedAt: "2026-09-01" },
      skills: { sourceVersion: "git:2.0.0" },
      skillNamesFr: { sourceVersion: "git:2.0.0" },
    });
    expect(readFileSync(readme, "utf8")).toBe("Contains 1 skills.\n");
  });
});
