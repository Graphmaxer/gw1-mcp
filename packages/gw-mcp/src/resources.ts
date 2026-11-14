import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { attributes, campaigns, heroes, professions, skillTypes } from "@gw1-mcp/gw-data";
import dataMeta from "@gw1-mcp/gw-data/data/_meta.json" with { type: "json" };
import { fullHero } from "./results.js";

/** Serialised once: the roster is static data, and this was rebuilt on every read. */
const heroesResourceJson = JSON.stringify(heroes.map(fullHero), null, 2);

/**
 * The gw1://meta payload, serialized once at module scope (a resource read must
 * not rebuild it, same rule as the tool schema literals).
 *
 * It carries the reference tables, not just provenance: an UNKNOWN_ATTRIBUTE
 * error points a caller here to enumerate title tracks and each profession's
 * attribute lines, and that pointer was a dead end while this served
 * _meta.json alone.
 */
const metaResourceJson = JSON.stringify(
  {
    provenance: dataMeta,
    professions,
    // Includes the non-templatable ids on purpose: a caller needs to see that
    // "Sunspear Title Track" exists before learning it cannot go in a template.
    attributeIdRanges:
      "0-44 are templatable attribute lines; 101 is No Attribute; 102-109 are PvE title tracks, which skills use but templates cannot encode.",
    attributes,
    campaigns,
    skillTypes,
  },
  null,
  2,
);

const BUILD_WORKFLOW_GUIDE = `# Composing a GW1 build with gw1-mcp

1. **Understand the context**: mission/area, party size, player profession,
   hero slots, and — if provided — the AccountExport JSON (/exportaccount in
   GWToolbox) with unlocked heroes and skills.
2. **Pick roles first**: damage, healing/protection, energy management,
   interrupts/shutdown, party support. In Nightfall-era PvE a typical 3-hero
   core covers healing (Mo or Rt), support/curses (N), and damage.
3. **Choose the 8 skills yourself** using search_skills / get_skill for exact
   data — never invent names or numbers. One elite maximum; check energy cost,
   recharge and attribute lines for coherence.
4. **Allocate attributes**: base ranks 0-12 only; the primary attribute of a
   profession is only available when that profession is primary. Title tracks
   (Sunspear, Lightbringer…) are NOT template attributes.
5. **Validate** with validate_build (pass unlockedSkillIds from the account
   export when available; set forHero=true for hero bars — heroes cannot use
   ANY PvE-only skill, Signet of Capture included, and each one is a blocking
   error rather than a warning).
6. **Encode** with encode_template only once validation passes, and give the
   player the code(s) to paste in-game.

Data freshness: skill stats follow the CURRENT Reforged balance patch (the
data source tracks official updates). Check gw1://meta for the import date;
only cross-check the wiki if that date looks stale.
`;

/** The three read-only resources. Their payloads are built once, above. */
export function registerResources(server: McpServer): void {
  server.registerResource(
    "build-workflow",
    "gw1://guide/build-workflow",
    {
      title: "GW1 build-making workflow",
      description: "Recommended workflow for an LLM composing GW1 builds with this server",
      mimeType: "text/markdown",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          text: BUILD_WORKFLOW_GUIDE,
        },
      ],
    }),
  );

  server.registerResource(
    "data-provenance",
    "gw1://meta",
    {
      title: "Reference tables and data provenance",
      description:
        "Professions, attribute lines (including PvE title tracks), campaigns and skill types — plus where the data comes from and how fresh it is relative to Guild Wars Reforged balance updates",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [{ uri: uri.href, text: metaResourceJson }],
    }),
  );

  server.registerResource(
    "heroes",
    "gw1://heroes",
    {
      title: "All GW1 heroes",
      description: "Heroes with professions, campaigns and unlock notes",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          text: heroesResourceJson,
        },
      ],
    }),
  );
}
