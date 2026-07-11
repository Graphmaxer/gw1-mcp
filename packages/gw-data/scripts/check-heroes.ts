/**
 * Drift detection for data/heroes.json against the canonical upstream:
 * the GWCA `HeroID` enum, as vendored inside GWToolboxpp (this is the copy
 * the Toolbox actually ships, and it gains new Reforged heroes within days
 * — Devona and GhostOfAlthea appeared there with the April 2026 patches).
 *
 *   pnpm --filter @gw1-mcp/gw-data check:heroes
 *
 * Exit 1 when the upstream enum contains a playable hero that heroes.json
 * lacks (professions/campaign/unlock notes still need a human — the enum
 * only carries ids and names). Name mismatches and local-only heroes are
 * warnings. The weekly update-data workflow runs this after the skill
 * import, so a new hero shows up as a failed run instead of silent staleness.
 */
import { readFileSync } from "node:fs";
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

export function identifierToName(identifier: string): string {
  const override = NAME_OVERRIDES[identifier];
  if (override) return override;
  return identifier.replace(/(?<=[a-z])(?=[A-Z])/g, " ");
}

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
    heroes.set(id, identifierToName(identifier));
  });
  return heroes;
}

async function main(): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  const local = JSON.parse(readFileSync(join(here, "..", "data", "heroes.json"), "utf8")) as Array<{
    id: number;
    name: string;
  }>;
  const localById = new Map(local.map((hero) => [hero.id, hero.name]));

  const response = await fetch(ENUM_URL);
  if (!response.ok) throw new Error(`Fetching GWCA constants failed: ${response.status}`);
  const upstream = parseHeroEnum(await response.text());

  const missing = [...upstream].filter(([id]) => !localById.has(id));
  const localOnly = [...localById].filter(([id]) => !upstream.has(id));
  const renamed = [...upstream].filter(
    ([id, name]) => localById.has(id) && localById.get(id) !== name,
  );

  for (const [id, name] of renamed) {
    console.warn(
      `WARN name mismatch for id ${id}: upstream "${name}" vs local "${localById.get(id)}"`,
    );
  }
  for (const [id, name] of localOnly) {
    console.warn(`WARN hero ${id} "${name}" exists locally but not in the GWCA enum`);
  }
  if (missing.length > 0) {
    for (const [id, name] of missing) {
      console.error(
        `MISSING hero ${id} "${name}" — add it to data/heroes.json (professions/campaign/unlock from GWW)`,
      );
    }
    process.exit(1);
  }
  console.log(
    `heroes.json is in sync with the GWCA HeroID enum (${upstream.size} playable heroes).`,
  );
}

const isDirectRun =
  process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isDirectRun) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
