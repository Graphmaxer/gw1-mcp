/**
 * Imports game data from @buildwars/gw-skilldata (MIT, npm) into
 * packages/gw-data/data/*.json.
 *
 * The upstream package is actively maintained and tracks Guild Wars Reforged
 * balance updates (including newly added skills). Updating the data is:
 *
 *   pnpm --filter @gw1-mcp/gw-data update @buildwars/gw-skilldata --latest
 *   pnpm --filter @gw1-mcp/gw-data import
 *
 * The generated JSON is committed: the MCP server never fetches at runtime.
 */
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

/**
 * Data source resolution:
 * - default: the installed @buildwars/gw-skilldata npm package (versioned, may
 *   lag the repository by a release)
 * - optional argv[2]: path to a git clone of build-wars/gw-skilldata — used by
 *   the automated update workflow to always import the repository tip.
 */
const cloneRoot = process.argv[2];

async function loadUpstream() {
  if (cloneRoot) {
    const constants = await import(pathToFileURL(join(cloneRoot, "es6", "constants.js")).href);
    const skilldata = JSON.parse(readFileSync(join(cloneRoot, "data", "json-full", "skilldata.json"), "utf8"));
    const desc = JSON.parse(readFileSync(join(cloneRoot, "data", "json-full", "skilldesc-en.json"), "utf8"));

    // Validate the upstream files against the schemas they publish
    // (data/schemas/, also served on their GitHub Pages). This makes the
    // weekly auto-update PR fail loudly on upstream format drift instead of
    // silently importing garbage.
    const { Ajv2020 } = await import("ajv/dist/2020.js");
    const ajv = new Ajv2020({ strict: false, allErrors: true });
    for (const [file, payload] of [
      ["skilldata", skilldata],
      ["skilldesc", desc],
    ] as const) {
      const schema = JSON.parse(
        readFileSync(join(cloneRoot, "data", "schemas", `${file}.schema.json`), "utf8"),
      ) as Record<string, unknown>;
      delete schema.$id; // avoid remote-$ref resolution
      delete schema.$schema;
      // Upstream quirk: "float" is not a JSON Schema type (they use
      // ["float","integer"] on adrenaline_precise). Normalize to "number".
      const normalizeTypes = (node: unknown): void => {
        if (Array.isArray(node)) return node.forEach(normalizeTypes);
        if (node && typeof node === "object") {
          const record = node as Record<string, unknown>;
          if (Array.isArray(record.type)) {
            record.type = [...new Set(record.type.map((t) => (t === "float" ? "number" : t)))];
          } else if (record.type === "float") {
            record.type = "number";
          }
          Object.values(record).forEach(normalizeTypes);
        }
      };
      normalizeTypes(schema);
      const validate = ajv.compile(schema);
      if (!validate(payload)) {
        console.error(`upstream ${file}.json fails its own schema:`, validate.errors?.slice(0, 5));
        process.exit(1);
      }
      console.log(`${file}.json: valid against upstream schema`);
    }

    const version = `git:${JSON.parse(readFileSync(join(cloneRoot, "package.json"), "utf8")).version}`;
    return { ...constants, skilldata: skilldata.skilldata, skilldesc: desc.skilldesc, version };
  }
  const module_ = await import("@buildwars/gw-skilldata");
  const require = createRequire(import.meta.url);
  const pkg = JSON.parse(readFileSync(require.resolve("@buildwars/gw-skilldata/package.json"), "utf8"));
  const english = new module_.SkillLangEnglish() as unknown as {
    skilldata: Record<string, unknown>;
    skilldesc: Record<string, unknown>;
  };
  return {
    ATTRIBUTES: module_.ATTRIBUTES,
    CAMPAIGNS: module_.CAMPAIGNS,
    PROFESSIONS: module_.PROFESSIONS,
    SKILLTYPES: module_.SKILLTYPES,
    skilldata: english.skilldata,
    skilldesc: english.skilldesc,
    version: `npm:${pkg.version}`,
  };
}

const upstream = await loadUpstream();
const { ATTRIBUTES, CAMPAIGNS, PROFESSIONS, SKILLTYPES } = upstream;

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "data");
mkdirSync(outDir, { recursive: true });

// Upstream constant shapes (informal, mirrored from es6/constants.js).
type LangName = { en: string; de: string };
type UpstreamAttribute = { prof: number; pri: boolean; max: number; name: LangName };
type UpstreamProfession = { name: LangName; abbr: LangName };
type UpstreamCampaign = { name: LangName; continent: unknown };
type UpstreamSkillType = { name: LangName };
type UpstreamSkill = {
  id: number;
  campaign: number;
  profession: number;
  attribute: number;
  type: number;
  is_elite: boolean;
  is_rp: boolean;
  is_pvp: boolean;
  pvp_split: boolean;
  split_id: number;
  upkeep: number;
  energy: number;
  activation: number;
  recharge: number;
  adrenaline: number;
  sacrifice: number;
  overcast: number;
  name: string;
  description: string;
  concise: string;
};

// --- campaigns / professions / attributes / types ---------------------------
const campaigns = (CAMPAIGNS as unknown as UpstreamCampaign[]).map((c, id) => ({
  id,
  name: c.name.en,
  nameDe: c.name.de,
}));

const professions = (PROFESSIONS as unknown as UpstreamProfession[]).map((p, id) => ({
  id,
  name: p.name.en,
  nameDe: p.name.de,
  abbr: p.abbr.en,
}));

const attributes = Object.entries(ATTRIBUTES as unknown as Record<string, UpstreamAttribute>).map(
  ([id, a]) => ({
    id: Number(id),
    name: a.name.en,
    nameDe: a.name.de,
    isPrimary: a.pri,
    professionId: a.prof,
    /** Maximum achievable rank incl. bonuses (21 for regular attributes, title cap otherwise). */
    max: a.max,
  }),
);

const skillTypes = Object.entries(SKILLTYPES as unknown as Record<string, UpstreamSkillType>).map(
  ([id, t]) => ({ id: Number(id), name: t.name.en }),
);

// --- skills ------------------------------------------------------------------
const skills = Object.keys(upstream.skilldata)
  .map((id) => ({
    ...(upstream.skilldata[id] as object),
    ...(upstream.skilldesc[id] as object),
  }) as UpstreamSkill)
  .filter((s) => s.id !== 0) // id 0 = "No Skill" (empty-slot sentinel)
  .map((s) => ({
    id: s.id,
    name: s.name,
    description: s.concise || s.description,
    campaignId: s.campaign,
    professionId: s.profession,
    attributeId: s.attribute,
    elite: s.is_elite,
    /** True for the separate "(PvP)" version of a split skill (not encodable in PvE templates). */
    isPvpVersion: s.is_pvp,
    /** True if the skill has a separate PvP version; splitId points to it. */
    pvpSplit: s.pvp_split,
    splitId: s.split_id || 0,
    typeId: s.type,
    upkeep: s.upkeep,
    energy: s.energy,
    activation: s.activation,
    recharge: s.recharge,
    adrenaline: s.adrenaline,
    sacrifice: s.sacrifice,
    overcast: s.overcast,
  }))
  .sort((a, b) => a.id - b.id);

// --- provenance ---------------------------------------------------------------
const meta = {
  source: "https://github.com/build-wars/gw-skilldata (npm: @buildwars/gw-skilldata)",
  sourceVersion: upstream.version,
  importedAt: new Date().toISOString().slice(0, 10),
  freshness:
    "Upstream is actively maintained and tracks Guild Wars Reforged balance updates (stat changes and newly added skills). Data is only as fresh as the installed package version; run the update workflow or `pnpm update @buildwars/gw-skilldata` to refresh. Recent balance notes: https://wiki.guildwars.com/wiki/Game_updates",
};

// --- write --------------------------------------------------------------------
const write = (name: string, data: unknown, count: number | string) => {
  writeFileSync(join(outDir, name), JSON.stringify(data, null, 1) + "\n");
  console.log(`${name}: ${count}`);
};
write("campaigns.json", campaigns, campaigns.length);
write("professions.json", professions, professions.length);
write("attributes.json", attributes, attributes.length);
write("skill-types.json", skillTypes, skillTypes.length);
write("skills.json", skills, `${skills.length} (${skills.filter((s) => s.isPvpVersion).length} PvP versions)`);
write("_meta.json", meta, upstream.version);
