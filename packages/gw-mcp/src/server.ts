import type { ToolName } from "./tool-names.js";
import { type DecodedBuild, decodedBuildShape } from "./build-io.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  getAttributeByName,
  suggestAttributeNames,
  getHeroById,
  getHeroByName,
  getProfessionByName,
  getSkillByName,
  heroes,
  getSkillById,
  getAttributeById,
  getCampaignById,
  getProfessionById,
  getSkillType,
  searchSkills,
  suggestSkillNames,
  type Hero,
  getCampaignByName,
} from "@gw1-mcp/gw-data";
import { decodeTemplate, encodeTemplate, TemplateError } from "@gw1-mcp/gw-template";
import { PwndTemplate } from "@buildwars/gw-templates";
import dataMeta from "@gw1-mcp/gw-data/data/_meta.json" with { type: "json" };
import { describeTemplate, resolveNamedBuild } from "./build-io.js";
import { validateBuild } from "./validate.js";

const namedBuildSchema = {
  primary: z.string().describe('Primary profession, e.g. "Dervish"'),
  secondary: z
    .string()
    .optional()
    .describe('Secondary profession, e.g. "Monk". Omit or "None" for none.'),
  attributes: z
    .array(
      z.object({
        attribute: z.string().describe('Exact attribute name, e.g. "Mysticism"'),
        rank: z.number().int().min(0).max(12).describe("Base rank 0-12 (before runes)"),
      }),
    )
    .describe("Attribute point allocations"),
  skills: z
    .array(z.string().nullable())
    .length(8)
    .describe(
      "Exactly 8 skill names in bar order. Use null for an empty slot. Names must be exact English skill names.",
    ),
};

/** Every tool here is a pure, read-only computation over bundled game data. */
const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

function json(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

const issueSchema = z.object({ code: z.string(), message: z.string() });
/**
 * Shared output contract for encode_template and validate_build. Exactly one
 * of the shapes is populated: { code, warnings } on successful encode,
 * { valid, errors, warnings } as a validation report, or { errors } alone
 * when name resolution fails before validation.
 */
const buildResultSchema = {
  code: z.string().optional().describe("Official in-game template code (successful encode only)"),
  valid: z.boolean().optional(),
  errors: z.array(issueSchema).optional(),
  warnings: z.array(issueSchema).optional(),
};

// ---- Output schemas for the read tools (structuredContent contracts). ----
// Shared blocks: one decoded-skill shape serves decode_template AND
// decode_pawned_team; one enriched-hero shape serves get_hero AND
// list_heroes. Zod objects tolerate extra keys, so data-pipeline additions
// don't break validation; removals/renames fail the golden tests.

const fullSkillShape = {
  id: z.number().int(),
  name: z.string(),
  elite: z.boolean(),
  energy: z.number(),
  activation: z.number(),
  recharge: z.number(),
  adrenaline: z.number(),
  sacrifice: z.number(),
  overcast: z.number(),
  upkeep: z.number(),
  description: z.string(),
  isPvpVersion: z.boolean(),
  profession: z.string().nullable(),
  attribute: z.string().nullable(),
  campaign: z.string().nullable(),
  type: z.string().nullable().describe("Skill type, e.g. Enchantment Spell"),
};

const skillSummarySchema = z.object({
  id: z.number().int(),
  name: z.string(),
  elite: z.boolean(),
  profession: z.string().nullable(),
  attribute: z.string().nullable(),
  campaign: z.string().nullable(),
  energy: z.number(),
  activation: z.number(),
  recharge: z.number(),
});

type FullSkillOut = z.infer<z.ZodObject<typeof fullSkillShape>>;

const fullHeroSchema = z.object({
  id: z.number().int().describe("GWCA HeroID"),
  name: z.string(),
  professionId: z.number().int(),
  campaignId: z.number().int(),
  unlock: z.string().describe("How the hero is recruited"),
  profession: z.string().nullable(),
  campaign: z.string().nullable(),
});

type FullHeroOut = z.infer<typeof fullHeroSchema>;

const pwndEntrySchema = z.object({
  slot: z.number().int(),
  label: z.string().describe("Slot name shown in paw-ned2 (Player, Hero 1, ...)"),
  notes: z.string().nullable(),
  inGamePlayerName: z.string().nullable(),
  skillsCode: z.string().describe("This entry's individual template code"),
  equipmentCode: z.string().nullable(),
  build: z.object(decodedBuildShape).optional().describe("Decoded bar (absent if decoding failed)"),
  error: z.object({ code: z.string(), message: z.string() }).optional(),
});

/** Structured result: machine-parseable structuredContent plus the usual JSON text. */
function jsonStructured(data: object) {
  return { ...json(data), structuredContent: data as Record<string, unknown> };
}

/** Tool-level failure: same JSON body, plus the MCP isError flag so clients can react. */
/**
 * Total-call failure (MCP isError). Policy: use for failures where nothing
 * usable was produced — bad request, unparseable input, requested entity not
 * found. Per-item errors inside a larger result (e.g. one hero of a decoded
 * team) and requested reports (validate_build, encode rule violations) are
 * normal content WITHOUT isError. extra carries e.g. suggestions.
 */
function jsonError(code: string, message: string, extra?: Record<string, unknown>) {
  return { ...json({ error: { code, message, ...extra } }), isError: true };
}

/** Enrich a hero with resolved profession/campaign names (single source). */
function fullHero(hero: Hero): FullHeroOut {
  return {
    ...hero,
    profession: getProfessionById(hero.professionId)?.name ?? null,
    campaign: getCampaignById(hero.campaignId)?.name ?? null,
  };
}

function fullSkill(id: number): FullSkillOut | null {
  const skill = getSkillById(id);
  if (!skill) return null;
  return {
    ...skill,
    profession: getProfessionById(skill.professionId)?.name ?? null,
    attribute: getAttributeById(skill.attributeId)?.name ?? null,
    campaign: getCampaignById(skill.campaignId)?.name ?? null,
    type: getSkillType(skill.typeId)?.name ?? null,
  };
}

export function createServer(): McpServer {
  const server = new McpServer(
    {
      name: "gw1-mcp",
      version: "0.6.0", // x-release-please-version
    },
    {
      // Imported by clients (including the ChatGPT plugin scan) as server-level
      // guidance — the protocol-level counterpart of the bundled skill.
      instructions: [
        "Guild Wars 1 build compiler over live Reforged game data.",
        "Template codes MUST come from encode_template; never hand-write or guess a code, and verify every produced code with decode_template before presenting it.",
        "Trust this server's skill data over model memory: stats and descriptions follow the current balance patch.",
        "Error responses include closest-match suggestions for misspelled names — use them and retry.",
        "When exploring an attribute line with search_skills, do not filter by campaign.",
      ].join(" "),
    },
  );

  server.registerTool(
    "get_skill" satisfies ToolName,
    {
      title: "Get a Guild Wars 1 skill",
      description:
        "Look up a single GW1 skill by exact English name or by template skill id. Returns full stats (energy, activation, recharge, adrenaline, sacrifice), profession, attribute, campaign, elite flag and description. If the name is not found, returns the closest matches so you can correct spelling. Use this when you already know the exact skill; to discover skills by profession, attribute or name fragment, use search_skills instead.",
      annotations: READ_ONLY,
      outputSchema: fullSkillShape,
      inputSchema: {
        name: z
          .string()
          .optional()
          .describe('Exact English skill name, e.g. "Mystic Regeneration"'),
        id: z.number().int().min(0).max(65535).optional().describe("Template skill id"),
      },
    },
    async ({ name, id }) => {
      if (id !== undefined) {
        const skill = fullSkill(id);
        return skill ? jsonStructured(skill) : jsonError("NOT_FOUND", `No skill with id ${id}`);
      }
      if (name !== undefined) {
        const skill = getSkillByName(name);
        return skill
          ? jsonStructured(fullSkill(skill.id) ?? {})
          : jsonError("NOT_FOUND", `No skill named ${JSON.stringify(name)}`, {
              suggestions: suggestSkillNames(name),
            });
      }
      return jsonError("BAD_REQUEST", "Provide name or id");
    },
  );

  server.registerTool(
    "search_skills" satisfies ToolName,
    {
      title: "Search Guild Wars 1 skills",
      description:
        "Search the full GW1 skill database by profession, attribute, campaign, elite flag or name fragment (valid values are documented per parameter). Returns compact records; use get_skill for full details.",
      annotations: READ_ONLY,
      outputSchema: {
        total: z.number().int().describe("Total matches BEFORE limit is applied"),
        skills: z
          .array(skillSummarySchema)
          .describe("Compact records; use get_skill for full details"),
      },
      inputSchema: {
        professionName: z
          .string()
          .optional()
          .describe(
            "Filter by profession: Warrior, Ranger, Monk, Necromancer, Mesmer, Elementalist, Assassin, Ritualist, Paragon, Dervish, or None (common / PvE-only skills that belong to no profession).",
          ),
        attributeName: z
          .string()
          .optional()
          .describe(
            'Filter by attribute line, exact English name, e.g. "Blood Magic", "Swordsmanship", "Divine Favor".',
          ),
        campaignName: z
          .string()
          .optional()
          .describe(
            "Filter by campaign: Core, Prophecies, Factions, Nightfall, or Eye of the North.",
          ),
        elite: z
          .boolean()
          .optional()
          .describe("If true, return only elite skills; if false, only non-elite; omit for both."),
        nameContains: z
          .string()
          .optional()
          .describe(
            "Case-insensitive substring match on the skill name, e.g. \"heal\" matches every skill with 'heal' in its name.",
          ),
        includePvpVersions: z
          .boolean()
          .default(false)
          .describe(
            "Include separate '(PvP)' skill versions. Default false — most builds want the PvE version only.",
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .max(200)
          .default(50)
          .describe(
            "Maximum number of records to return (1–200, default 50). Narrow filters if you hit it.",
          ),
      },
    },
    async ({
      professionName,
      attributeName,
      campaignName,
      elite,
      nameContains,
      includePvpVersions,
      limit,
    }) => {
      const filters: Parameters<typeof searchSkills>[0] = { includePvpVersions };
      if (professionName !== undefined) {
        if (/^none$/i.test(professionName)) filters.professionId = 0;
        else {
          const profession = getProfessionByName(professionName);
          if (!profession)
            return jsonError(
              "UNKNOWN_PROFESSION",
              `Unknown profession ${JSON.stringify(professionName)}`,
            );
          filters.professionId = profession.id;
        }
      }
      if (attributeName !== undefined) {
        const attribute = getAttributeByName(attributeName);
        if (!attribute)
          return jsonError(
            "UNKNOWN_ATTRIBUTE",
            `Unknown attribute ${JSON.stringify(attributeName)}. Closest valid attribute names: ${suggestAttributeNames(attributeName).join(", ")}. Note: title tracks and each profession's attribute lines are listed in the gw1://meta resource.`,
          );
        filters.attributeId = attribute.id;
      }
      if (campaignName !== undefined) {
        const campaign = getCampaignByName(campaignName);
        if (!campaign)
          return jsonError("UNKNOWN_CAMPAIGN", `Unknown campaign ${JSON.stringify(campaignName)}`);
        filters.campaignId = campaign.id;
      }
      if (elite !== undefined) filters.elite = elite;
      if (nameContains !== undefined) filters.nameContains = nameContains;

      const results = searchSkills(filters);
      return jsonStructured({
        total: results.length,
        skills: results.slice(0, limit).map(
          (s) =>
            ({
              id: s.id,
              name: s.name,
              elite: s.elite,
              profession: getProfessionById(s.professionId)?.name ?? null,
              attribute: getAttributeById(s.attributeId)?.name ?? null,
              campaign: getCampaignById(s.campaignId)?.name ?? null,
              energy: s.energy,
              activation: s.activation,
              recharge: s.recharge,
            }) satisfies z.infer<typeof skillSummarySchema>,
        ),
      });
    },
  );

  server.registerTool(
    "decode_template" satisfies ToolName,
    {
      title: "Decode a skill template code",
      description:
        'Decode an in-game GW1 skill template code (e.g. "OwpiMypMBg1cxcBAMBdmtIKAA") into professions, attribute allocations and the 8 skills with their stats and descriptions. This decodes a SINGLE build code; for a multi-hero paw-ned2 team blob, use decode_pawned_team instead.',
      annotations: READ_ONLY,
      outputSchema: decodedBuildShape,
      inputSchema: {
        code: z.string().describe("The template code string"),
      },
    },
    async ({ code }) => {
      try {
        return jsonStructured(describeTemplate(decodeTemplate(code)));
      } catch (error) {
        if (error instanceof TemplateError) {
          return jsonError(error.code, error.message);
        }
        throw error;
      }
    },
  );

  server.registerTool(
    "decode_pawned_team" satisfies ToolName,
    {
      title: "Decode a paw-ned2 team template",
      description:
        "Decode a paw-ned2 team build blob (the 'pwnd0001...>...<' format shared on PvXwiki team pages and by the paw-ned2 tool) into its individual builds: player/hero label, description, and each skill bar fully decoded. Whitespace and line wraps in the pasted blob are tolerated. For a single (non-team) build code, use decode_template instead.",
      annotations: READ_ONLY,
      outputSchema: {
        builds: z.array(pwndEntrySchema).describe("One entry per team slot, in blob order"),
      },
      inputSchema: {
        pwnd: z.string().describe("The full pwnd blob, starting with 'pwnd000'"),
      },
    },
    async ({ pwnd }) => {
      // Re-join line-wrapped payloads: strip all whitespace inside the
      // base64 section between '>' and '<' (pasted blobs often wrap).
      const cleaned = pwnd.replace(
        />([^<]*)</s,
        (_, payload: string) => `>${payload.replace(/\s+/g, "")}<`,
      );
      let entries;
      try {
        entries = new PwndTemplate().decode(cleaned);
      } catch (error) {
        return jsonError("INVALID_PWND", error instanceof Error ? error.message : String(error));
      }
      return jsonStructured({
        builds: entries.map((entry, index) => {
          let build: DecodedBuild | undefined;
          let buildError: { code: string; message: string } | undefined;
          try {
            build = describeTemplate(decodeTemplate(entry.skills));
          } catch (error) {
            buildError = {
              code: error instanceof TemplateError ? error.code : "DECODE_FAILED",
              message: error instanceof Error ? error.message : String(error),
            };
          }
          // The description field holds "label\nnotes"; label is the slot
          // name shown in paw-ned2 ("Player", "Hero 1", ...).
          const [label = "", ...notes] = entry.description.split("\n");
          return {
            slot: index + 1,
            label,
            notes: notes.join("\n").trim() || null,
            inGamePlayerName: entry.player || null,
            skillsCode: entry.skills,
            equipmentCode: entry.equipment || null,
            ...(build !== undefined ? { build } : { error: buildError }),
          };
        }),
      });
    },
  );

  server.registerTool(
    "encode_template" satisfies ToolName,
    {
      title: "Encode a build into a template code",
      description:
        "Compile a build (professions, attributes, 8 skills by exact English name) into an official in-game template code. The build is validated first; on rule violations the errors are returned instead of a code. Unknown skill names return closest-match suggestions. IMPORTANT: template codes MUST come from this tool — never write or guess a code by hand, hand-written codes are invalid in-game. If unsure, verify any code with decode_template.",
      annotations: READ_ONLY,
      outputSchema: buildResultSchema,
      inputSchema: {
        ...namedBuildSchema,
        forHero: z
          .boolean()
          .default(false)
          .describe("Set true if this bar is for a hero (PvE-only skills are flagged)"),
        unlockedSkillIds: z
          .array(z.number().int().min(0).max(65535))
          .optional()
          .describe(
            "Optional: unlocked skill ids from a GWToolbox account export (/exportaccount). Skills outside this list are flagged as warnings.",
          ),
      },
    },
    async ({ forHero, unlockedSkillIds, ...build }) => {
      const resolution = resolveNamedBuild(build);
      if (!resolution.template) return jsonStructured({ errors: resolution.errors });

      const validation = validateBuild(resolution.template, {
        forHero,
        ...(unlockedSkillIds !== undefined ? { unlockedSkillIds } : {}),
      });
      if (!validation.valid) return jsonStructured(validation);

      try {
        return jsonStructured({
          code: encodeTemplate(resolution.template),
          warnings: validation.warnings,
        });
      } catch (error) {
        if (error instanceof TemplateError) {
          return jsonError(error.code, error.message);
        }
        throw error;
      }
    },
  );

  server.registerTool(
    "validate_build" satisfies ToolName,
    {
      title: "Validate a build against GW1 rules",
      description:
        "Check a build (professions, attributes, 8 skills by exact English name) against Guild Wars 1 rules: one elite max, profession/attribute ownership, primary attributes, duplicates, rank ranges. Returns { valid, errors, warnings } without encoding.",
      annotations: READ_ONLY,
      outputSchema: buildResultSchema,
      inputSchema: {
        ...namedBuildSchema,
        forHero: z.boolean().default(false),
        unlockedSkillIds: z
          .array(z.number().int().min(0).max(65535))
          .optional()
          .describe(
            "Optional: unlocked skill ids from a GWToolbox account export (/exportaccount). Skills outside this list are flagged as warnings.",
          ),
      },
    },
    async ({ forHero, unlockedSkillIds, ...build }) => {
      const resolution = resolveNamedBuild(build);
      if (!resolution.template) {
        return jsonStructured({ valid: false, errors: resolution.errors, warnings: [] });
      }
      return jsonStructured(
        validateBuild(resolution.template, {
          forHero,
          ...(unlockedSkillIds !== undefined ? { unlockedSkillIds } : {}),
        }),
      );
    },
  );

  server.registerTool(
    "get_hero" satisfies ToolName,
    {
      title: "Get a Guild Wars 1 hero",
      description:
        "Look up a GW1 hero by name or by id (GWCA HeroID, matching the AccountExport plugin output). Returns profession, campaign and how the hero is unlocked. Remember: heroes can equip any skill unlocked at ACCOUNT level, but not most PvE-only skills. Use this for one known hero; to browse or filter the roster, use list_heroes instead.",
      annotations: READ_ONLY,
      outputSchema: fullHeroSchema.shape,
      inputSchema: {
        name: z.string().optional().describe('Hero name, e.g. "Master of Whispers"'),
        id: z.number().int().min(0).max(255).optional().describe("GWCA HeroID value"),
      },
    },
    async ({ name, id }) => {
      const hero =
        id !== undefined ? getHeroById(id) : name !== undefined ? getHeroByName(name) : undefined;
      if (!hero) {
        return jsonError("NOT_FOUND", `No hero matching ${JSON.stringify(name ?? id)}`);
      }
      return jsonStructured(fullHero(hero));
    },
  );

  server.registerTool(
    "list_heroes" satisfies ToolName,
    {
      title: "List Guild Wars 1 heroes",
      description:
        "List all GW1 heroes, optionally filtered by profession or campaign name. Useful for team-building: shows which professions are coverable by heroes and how each hero is unlocked.",
      annotations: READ_ONLY,
      outputSchema: {
        total: z.number().int(),
        heroes: z.array(fullHeroSchema),
      },
      inputSchema: {
        professionName: z.string().optional(),
        campaignName: z.string().optional(),
      },
    },
    async ({ professionName, campaignName }) => {
      let results = heroes;
      if (professionName !== undefined) {
        const profession = getProfessionByName(professionName);
        if (!profession)
          return jsonError(
            "UNKNOWN_PROFESSION",
            `Unknown profession ${JSON.stringify(professionName)}`,
          );
        results = results.filter((h) => h.professionId === profession.id);
      }
      if (campaignName !== undefined) {
        const campaign = getCampaignByName(campaignName);
        if (!campaign)
          return jsonError("UNKNOWN_CAMPAIGN", `Unknown campaign ${JSON.stringify(campaignName)}`);
        results = results.filter((h) => h.campaignId === campaign.id);
      }
      return jsonStructured({
        total: results.length,
        heroes: results.map(fullHero),
      });
    },
  );

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
      title: "Data provenance and freshness",
      description:
        "Where the skill data comes from and how fresh it is relative to Guild Wars Reforged balance updates",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [{ uri: uri.href, text: JSON.stringify(dataMeta, null, 2) }],
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
          text: JSON.stringify(heroes.map(fullHero), null, 2),
        },
      ],
    }),
  );

  return server;
}

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
   most PvE-only skills).
6. **Encode** with encode_template only once validation passes, and give the
   player the code(s) to paste in-game.

Data freshness: skill stats follow the CURRENT Reforged balance patch (the
data source tracks official updates). Check gw1://meta for the import date;
only cross-check the wiki if that date looks stale.
`;
