/**
 * Generator for data/heroes.json — the mechanical part (ids and names) is
 * DERIVED from the canonical upstream at run time, never copied by hand:
 * the GWCA `HeroID` enum, vendored inside GWToolboxpp. That vendored copy
 * is not a fallback — it is the LIVING source: the standalone gwdevhub/GWCA
 * repository 404s (deleted or made private) as of July 2026, and GWToolbox's
 * own cmake consumes Dependencies/GWCA directly. It gains new Reforged
 * heroes within days (Devona and GhostOfAlthea appeared with the April 2026
 * patches). Do not "fix" ENUM_URL to point at a standalone GWCA repo.
 *
 *   pnpm --filter @gw1-mcp/gw-data import:heroes
 *
 * The only human knowledge lives in data/heroes-meta.json (professionId,
 * campaignId, unlock note — none of which exists in any machine-readable
 * source; the enum does not carry them and the wiki is fragile wikitext).
 * When the enum gains a hero the overlay lacks, this script exits 1 listing
 * the identifiers to curate — the weekly workflow turns that into a red run
 * instead of silent staleness. Orphan overlay keys are warnings.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ENUM_URL =
  "https://raw.githubusercontent.com/gwdevhub/GWToolboxpp/master/Dependencies/GWCA/include/GWCA/Constants/Constants.h";

/** Enum entries that are not playable, recruitable heroes. */
const NON_HEROES = new Set(["NoHero", "Count"]);
const MERC_PATTERN = /^Merc[1-8]$/;

/** CamelCase enum identifier -> display name, with the irregular cases pinned. */
const NAME_OVERRIDES: Record<string, string> = {
  MOX: "M.O.X.",
  MasterOfWhispers: "Master of Whispers",
  MargridTheSly: "Margrid the Sly",
  ZhedShadowhoof: "Zhed Shadowhoof",
  PyreFierceshot: "Pyre Fierceshot",
  GhostOfAlthea: "Ghost of Althea",
  ZeiRi: "Zei Ri",
  Ogden: "Ogden Stonehealer",
};

export interface HeroMeta {
  professionId: number;
  campaignId: number;
  unlock: string;
}

export interface HeroRecord extends HeroMeta {
  id: number;
  name: string;
}

export function identifierToName(identifier: string): string {
  const override = NAME_OVERRIDES[identifier];
  if (override) return override;
  return identifier.replace(/(?<=[a-z])(?=[A-Z])/g, " ");
}

/** id -> enum identifier for every playable hero, in enum order. */
export function parseHeroEnum(header: string): Map<number, string> {
  const match = header.match(/enum HeroID : uint32_t \{([\s\S]*?)\};/);
  if (!match?.[1]) throw new Error("HeroID enum not found in upstream header — format changed?");
  const entries = match[1]
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token.length > 0 && !token.startsWith("//"));
  const heroes = new Map<number, string>();
  entries.forEach((identifier, id) => {
    if (NON_HEROES.has(identifier) || MERC_PATTERN.test(identifier)) return;
    if (!/^[A-Za-z0-9]+$/.test(identifier)) {
      throw new Error(
        `Unexpected enum entry ${JSON.stringify(identifier)} — explicit values? Update the parser.`,
      );
    }
    heroes.set(id, identifier);
  });
  return heroes;
}

/** Merge the upstream enum with the curated overlay into full hero records. */
export function generateHeroes(header: string, overlay: Record<string, HeroMeta>): HeroRecord[] {
  const upstream = parseHeroEnum(header);
  const missing = [...upstream.values()].filter((identifier) => !(identifier in overlay));
  if (missing.length > 0) {
    throw new Error(
      `data/heroes-meta.json lacks ${missing.length} hero(es) from the GWCA enum: ${missing.join(", ")} — curate professionId/campaignId/unlock (from GWW) to unblock`,
    );
  }
  const known = new Set(upstream.values());
  for (const key of Object.keys(overlay)) {
    if (!known.has(key))
      console.warn(`WARN overlay key "${key}" no longer exists in the GWCA enum`);
  }
  return [...upstream]
    .sort(([a], [b]) => a - b)
    .map(([id, identifier]) => {
      const meta = overlay[identifier] as HeroMeta;
      return {
        id,
        name: identifierToName(identifier),
        professionId: meta.professionId,
        campaignId: meta.campaignId,
        unlock: meta.unlock,
      };
    });
}

async function main(): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  const dataDir = join(here, "..", "data");
  const overlay = JSON.parse(readFileSync(join(dataDir, "heroes-meta.json"), "utf8")) as Record<
    string,
    HeroMeta
  >;

  const response = await fetch(ENUM_URL);
  if (!response.ok) {
    throw new Error(
      `Fetching GWCA constants failed: ${response.status} — if GWToolboxpp moved the vendored Dependencies/GWCA folder, locate the new path in their tree`,
    );
  }
  const heroes = generateHeroes(await response.text(), overlay);
  writeFileSync(join(dataDir, "heroes.json"), `${JSON.stringify(heroes, null, 1)}\n`);
  console.log(
    `data/heroes.json generated: ${heroes.length} heroes from the GWCA enum + curated overlay.`,
  );
}

const isDirectRun =
  process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isDirectRun) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
