/**
 * Imports game data from build-wars/gw1-database (MIT) into packages/gw-data/data/*.json.
 *
 * Usage:
 *   git clone --depth 1 https://github.com/build-wars/gw1-database.git /tmp/gw1-database
 *   pnpm --filter @gw1-mcp/gw-data import /tmp/gw1-database
 *
 * The generated JSON is committed: the MCP server never fetches anything at runtime.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const sourceRoot = process.argv[2];
if (!sourceRoot) {
  console.error("Usage: tsx scripts/import.ts <path-to-gw1-database-clone>");
  process.exit(1);
}
const sqlDir = join(sourceRoot, "resources", "sql");
const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "data");
mkdirSync(outDir, { recursive: true });

type Value = string | number | null;

/** Parse every `INSERT INTO … VALUES (…), (…);` tuple in a MySQL dump. */
function parseInsertTuples(sql: string): Value[][] {
  const tuples: Value[][] = [];
  let i = 0;
  while (i < sql.length) {
    const insertAt = sql.indexOf("VALUES", i);
    if (insertAt === -1) break;
    i = insertAt + "VALUES".length;
    // Read tuples until the terminating semicolon.
    while (i < sql.length) {
      while (i < sql.length && /\s|,/.test(sql[i]!)) i++;
      if (sql[i] === ";") {
        i++;
        break;
      }
      if (sql[i] !== "(") break;
      i++; // consume '('
      const tuple: Value[] = [];
      let current = "";
      let inString = false;
      for (; i < sql.length; i++) {
        const c = sql[i]!;
        if (inString) {
          if (c === "'") {
            if (sql[i + 1] === "'") {
              current += "'";
              i++; // '' -> escaped quote
            } else {
              inString = false;
            }
          } else {
            current += c;
          }
        } else if (c === "'") {
          inString = true;
          current += "\u0000STR\u0000"; // mark as string
        } else if (c === "," || c === ")") {
          const raw = current.trim();
          if (raw.startsWith("\u0000STR\u0000")) {
            tuple.push(raw.replace("\u0000STR\u0000", ""));
          } else if (raw.toUpperCase() === "NULL") {
            tuple.push(null);
          } else if (raw.length > 0) {
            tuple.push(Number(raw));
          }
          current = "";
          if (c === ")") {
            i++;
            break;
          }
        } else {
          current += c;
        }
      }
      tuples.push(tuple);
    }
  }
  return tuples;
}

function load(file: string): Value[][] {
  return parseInsertTuples(readFileSync(join(sqlDir, file), "utf8"));
}

const num = (v: Value | undefined): number => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v !== "") return Number(v);
  throw new Error(`Expected number, got ${JSON.stringify(v)}`);
};
const str = (v: Value | undefined): string => (typeof v === "string" ? v : String(v ?? ""));

// --- campaigns ------------------------------------------------------------
// The campaigns table is 1-indexed (1=Core … 5=EotN) but gw1_skilldata.campaign
// is 0-indexed (0=Core … 4=EotN). We normalize everything to the skilldata
// convention, which is also what skill records reference.
const campaigns = load("gw1_campaigns.sql").map((t) => ({
  id: num(t[0]) - 1,
  name: str(t[3]),
  nameDe: str(t[2]),
}));

// --- professions ----------------------------------------------------------
// (id, name_de, name_en, abbr_de, abbr_en, desc_de, desc_en, armor, …)
const professions = load("gw1_professions.sql").map((t) => ({
  id: num(t[0]),
  name: str(t[2]),
  nameDe: str(t[1]),
  abbr: str(t[4]),
}));

// --- attributes -----------------------------------------------------------
// (id, name_de, name_en, desc_de, desc_en, abbr, primary, max, profession)
const attributes = load("gw1_attributes.sql").map((t) => ({
  id: num(t[0]),
  name: str(t[2]),
  nameDe: str(t[1]),
  abbr: str(t[5]),
  isPrimary: num(t[6]) === 1,
  professionId: num(t[8]),
}));

// --- skill types ----------------------------------------------------------
const skillTypes = load("gw1_skilltypes.sql").map((t) => ({
  id: num(t[0]),
  name: str(t[2]),
}));

// --- skills ---------------------------------------------------------------
// gw1_skilldata: (id, campaign, profession, attribute, elite, rp, player, split,
//   pve_type, pve_upkeep, pve_energy, pve_activation, pve_recharge,
//   pve_adrenaline, pve_sacrifice, pve_overcast, pvp_* x8)
// gw1_skilldesc_en: (id, pve_name, pve_desc, pve_concise, pvp_name, pvp_desc, pvp_concise)
const descriptions = new Map(
  load("gw1_skilldesc_en.sql").map((t) => [
    num(t[0]),
    { name: str(t[1]), description: str(t[3]) || str(t[2]) },
  ]),
);

const skills = load("gw1_skilldata.sql")
  .map((t) => {
    const id = num(t[0]);
    const desc = descriptions.get(id);
    return {
      id,
      name: desc?.name ?? "",
      description: desc?.description ?? "",
      campaignId: num(t[1]),
      professionId: num(t[2]),
      attributeId: num(t[3]),
      elite: num(t[4]) === 1,
      playerUsable: num(t[6]) === 1,
      pvpSplit: num(t[7]) === 1,
      typeId: num(t[8]),
      upkeep: num(t[9]),
      energy: num(t[10]),
      activation: num(t[11]),
      recharge: num(t[12]),
      adrenaline: num(t[13]),
      sacrifice: num(t[14]),
      overcast: num(t[15]),
    };
  })
  .filter((s) => s.name !== "");

// --- write ------------------------------------------------------------------
const write = (name: string, data: unknown, count: number) => {
  writeFileSync(join(outDir, name), JSON.stringify(data, null, 1) + "\n");
  console.log(`${name}: ${count} records`);
};
write("campaigns.json", campaigns, campaigns.length);
write("professions.json", professions, professions.length);
write("attributes.json", attributes, attributes.length);
write("skill-types.json", skillTypes, skillTypes.length);
write("skills.json", skills, skills.length);
