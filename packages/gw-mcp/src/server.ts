import type { ToolName } from "./tool-names.js";
import { type CreateServerOptions, deriveEvent } from "./events.js";
import {
  MAX_PWND_BLOB_LEN,
  MAX_PWND_SLOTS,
  MAX_TEMPLATE_CODE_LEN,
  READ_ONLY,
  decodedBuildShapeObject,
  encodeInputObject,
  encodeResultSchemaObject,
  fullHeroSchema,
  fullSkillShapeObject,
  getHeroInputObject,
  getSkillInputObject,
  listHeroesInputObject,
  listHeroesOutputObject,
  pwndOutputObject,
  searchSkillsOutputObject,
  skillSummarySchema,
  validateInputObject,
  validateResultSchemaObject,
} from "./schemas.js";
import type { DecodedBuild } from "./build-io.js";
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
  getAttributeById,
  getCampaignById,
  getProfessionById,
  searchSkills,
  suggestSkillNames,
  getCampaignByName,
} from "@gw1-mcp/gw-data";
import { decodeTemplate, encodeTemplate, TemplateError } from "@gw1-mcp/gw-template";
import { PwndTemplate } from "@buildwars/gw-templates";
import dataMeta from "@gw1-mcp/gw-data/data/_meta.json" with { type: "json" };
import { describeTemplate, resolveNamedBuild } from "./build-io.js";
import { validateBuild } from "./validate.js";
import { fullHero, fullSkill, jsonError, jsonStructured } from "./results.js";

/**
 * A domain event about one tool call. Deliberately transport-agnostic: this
 * package knows nothing about Analytics Engine, blobs or dashboards, and the
 * consumer decides what to do with it. That boundary is the point — gw-mcp stays
 * usable over stdio, in tests, and anywhere else.
 *
 * Every field is either a fixed enum or a value derived from THIS project's own
 * data after resolution — never caller input. That is what makes it safe for a
 * consumer to record somewhere public, and it is the same rule the worker
 * already applies to tool names.
 */

export function createServer(options: CreateServerOptions = {}): McpServer {
  const server = new McpServer(
    {
      name: "gw1-mcp",
      version: "1.0.0", // x-release-please-version
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

  // Single choke point: every tool is registered through this, so instrumentation
  // cannot be forgotten on a new tool, and the 8 call sites keep their exact
  // types. The event is derived from the RESULT, so the entity name and codes come
  // from our own resolution rather than from what the caller asked for.
  const registerTool: typeof server.registerTool = (name, config, cb) =>
    server.registerTool(name, config, (async (...args: unknown[]) => {
      const result = (await (cb as (...a: unknown[]) => unknown)(...args)) as {
        isError?: boolean;
        structuredContent?: Record<string, unknown>;
        content?: { text?: string }[];
      };
      try {
        options.onToolCall?.(deriveEvent(name as ToolName, args[0], result));
      } catch {
        // An observer must never break a tool call.
      }
      return result;
    }) as never);

  registerTool(
    "get_skill" satisfies ToolName,
    {
      title: "Get a Guild Wars 1 skill",
      description:
        "Look up a single GW1 skill by exact English name or by template skill id. Returns full stats (energy, activation, recharge, adrenaline, sacrifice), profession, attribute, campaign, elite flag and description. If the name is not found, returns the closest matches so you can correct spelling. Use this when you already know the exact skill; to discover skills by profession, attribute or name fragment, use search_skills instead.",
      annotations: READ_ONLY,
      outputSchema: fullSkillShapeObject,
      inputSchema: getSkillInputObject,
    },
    async ({ name, id }) => {
      // Exactly one of name/id — accepting both and silently letting id win
      // (GW1-09) hides a caller mistake where the name means something else.
      if (name !== undefined && id !== undefined) {
        return jsonError("BAD_REQUEST", "Provide exactly one of name or id, not both");
      }
      if (id !== undefined) {
        const skill = fullSkill(id);
        return skill ? jsonStructured(skill) : jsonError("NOT_FOUND", `No skill with id ${id}`);
      }
      if (name !== undefined) {
        const skill = getSkillByName(name);
        if (!skill) {
          return jsonError("NOT_FOUND", `No skill named ${JSON.stringify(name)}`, {
            suggestions: suggestSkillNames(name),
          });
        }
        // Unreachable today (a name hit implies an id hit), but an empty object
        // would violate fullSkillShape, whose fields are all required — emit an
        // error instead of shipping structuredContent that fails its own schema.
        const full = fullSkill(skill.id);
        return full ? jsonStructured(full) : jsonError("NOT_FOUND", `No skill with id ${skill.id}`);
      }
      return jsonError("BAD_REQUEST", "Provide name or id");
    },
  );

  registerTool(
    "search_skills" satisfies ToolName,
    {
      title: "Search Guild Wars 1 skills",
      description:
        "Search the full GW1 skill database by profession, attribute, campaign, elite flag or name fragment (valid values are documented per parameter). Returns compact records; use get_skill for full details.",
      annotations: READ_ONLY,
      outputSchema: searchSkillsOutputObject,
      inputSchema: {
        professionName: z
          .string()
          .max(64)
          .optional()
          .describe(
            "Filter by profession: Warrior, Ranger, Monk, Necromancer, Mesmer, Elementalist, Assassin, Ritualist, Paragon, Dervish, or None (common / PvE-only skills that belong to no profession).",
          ),
        attributeName: z
          .string()
          .max(64)
          .optional()
          .describe(
            'Filter by attribute line, exact English name, e.g. "Blood Magic", "Swordsmanship", "Divine Favor".',
          ),
        campaignName: z
          .string()
          .max(64)
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
          .max(64)
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
        offset: z
          .number()
          .int()
          .min(0)
          .default(0)
          .describe("Number of records to skip, for paging through results beyond the limit."),
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
      offset,
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
        skills: results.slice(offset, offset + limit).map(
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

  registerTool(
    "decode_template" satisfies ToolName,
    {
      title: "Decode a skill template code",
      description:
        'Decode an in-game GW1 skill template code (e.g. "OwpiMypMBg1cxcBAMBdmtIKAA") into professions, attribute allocations and the 8 skills with their stats and descriptions. This decodes a SINGLE build code; for a multi-hero paw-ned2 team blob, use decode_pawned_team instead.',
      annotations: READ_ONLY,
      outputSchema: decodedBuildShapeObject,
      inputSchema: {
        code: z
          .string()
          .max(MAX_TEMPLATE_CODE_LEN, "Template code too long")
          .describe("The template code string"),
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

  registerTool(
    "decode_pawned_team" satisfies ToolName,
    {
      title: "Decode a paw-ned2 team template",
      description:
        "Decode a paw-ned2 team build blob (the 'pwnd0001...>...<' format shared on PvXwiki team pages and by the paw-ned2 tool) into its individual builds: player/hero label, description, and each skill bar fully decoded. Whitespace and line wraps in the pasted blob are tolerated. For a single (non-team) build code, use decode_template instead.",
      annotations: READ_ONLY,
      outputSchema: pwndOutputObject,
      inputSchema: {
        pwnd: z
          .string()
          .max(MAX_PWND_BLOB_LEN, "pwnd blob too large")
          .describe("The full pwnd blob, starting with 'pwnd000'"),
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
      if (entries.length > MAX_PWND_SLOTS) {
        return jsonError(
          "TOO_MANY_SLOTS",
          `Blob declares ${entries.length} slots; a paw-ned2 team holds at most 8 (limit ${MAX_PWND_SLOTS}). This is not a team blob.`,
        );
      }

      return jsonStructured({
        builds: entries.map((entry, index) => {
          let build: DecodedBuild | undefined;
          let buildError: { code: string; message: string } | undefined;
          // No per-slot length bound here, and none is possible to need: the pwnd
          // format encodes each field's length in a SINGLE base64 character, so a
          // slot's code cannot exceed 63 characters. Both sides enforce it —
          // encode writes `base64_chr(str.length)`, decode reads
          // `read(base64_ord(read(1)))`. A 128-character guard was added here and
          // removed the same day: Codecov flagged it as uncovered, and it was
          // uncovered because it is unreachable, not because a test was missing.
          try {
            build = describeTemplate(decodeTemplate(entry.skills));
          } catch (error) {
            buildError = {
              code: error instanceof TemplateError ? error.code : "DECODE_FAILED",
              message: error instanceof Error ? error.message : String(error),
            };
          }
          // The slot label lives in `templatename` — the paw-ned2 field for it —
          // with `description` carrying only the notes. That is @buildwars/gw-templates
          // 1.1.x; 1.0.x had no templatename and packed "label\nnotes" into
          // description, which is why the fallback below exists. Reading both keeps
          // this working across the bump either way, and the fallback is cheap.
          //
          // Verified against the 3 Hero Discordway fixture on both versions: 1.0.1
          // gives templatename undefined and description "Player\nhttps://...", 1.1.1
          // gives templatename "Player" and description "https://...".
          // Cast because the shipped TYPES lag the implementation: 1.1.1 returns
          // templatename at runtime — verified on the fixture — but its declaration
          // still lists only skills, equipment, weaponsets, player, description and
          // flags. Reported upstream; remove the cast once the types catch up.
          const fromName = ((entry as { templatename?: string }).templatename ?? "").trim();
          const [fromDescription = "", ...rest] = entry.description.split("\n");
          const label = fromName || fromDescription;
          const notes = fromName ? entry.description.split("\n") : rest;
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

  registerTool(
    "encode_template" satisfies ToolName,
    {
      title: "Encode a build into a template code",
      description:
        "Compile a build (professions, attributes, 8 skills by exact English name) into an official in-game template code. The build is validated first; on rule violations the errors are returned instead of a code. Unknown skill names return closest-match suggestions. IMPORTANT: template codes MUST come from this tool — never write or guess a code by hand, hand-written codes are invalid in-game. If unsure, verify any code with decode_template.",
      annotations: READ_ONLY,
      outputSchema: encodeResultSchemaObject,
      inputSchema: encodeInputObject,
    },
    async ({ forHero, forPvp, unlockedSkillIds, ...build }) => {
      const resolution = resolveNamedBuild(build);
      if (!resolution.template) return jsonStructured({ errors: resolution.errors });

      const validation = validateBuild(resolution.template, {
        forHero,
        forPvp,
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

  registerTool(
    "validate_build" satisfies ToolName,
    {
      title: "Validate a build against GW1 rules",
      description:
        "Check a build (professions, attributes, 8 skills by exact English name) against Guild Wars 1 rules: one elite max, profession/attribute ownership, primary attributes, duplicates, rank ranges. Returns { valid, errors, warnings } without encoding.",
      annotations: READ_ONLY,
      outputSchema: validateResultSchemaObject,
      inputSchema: validateInputObject,
    },
    async ({ forHero, forPvp, unlockedSkillIds, ...build }) => {
      const resolution = resolveNamedBuild(build);
      if (!resolution.template) {
        return jsonStructured({ valid: false, errors: resolution.errors, warnings: [] });
      }
      return jsonStructured(
        validateBuild(resolution.template, {
          forHero,
          forPvp,
          ...(unlockedSkillIds !== undefined ? { unlockedSkillIds } : {}),
        }),
      );
    },
  );

  registerTool(
    "get_hero" satisfies ToolName,
    {
      title: "Get a Guild Wars 1 hero",
      description:
        "Look up a GW1 hero by name or by id (GWCA HeroID, matching the AccountExport plugin output). Returns profession, campaign and how the hero is unlocked. Remember: heroes can equip any skill unlocked at ACCOUNT level, but not most PvE-only skills. Use this for one known hero; to browse or filter the roster, use list_heroes instead.",
      annotations: READ_ONLY,
      outputSchema: fullHeroSchema.shape,
      inputSchema: getHeroInputObject,
    },
    async ({ name, id }) => {
      if (name !== undefined && id !== undefined) {
        return jsonError("BAD_REQUEST", "Provide exactly one of name or id, not both");
      }
      const hero =
        id !== undefined ? getHeroById(id) : name !== undefined ? getHeroByName(name) : undefined;
      if (!hero) {
        return jsonError("NOT_FOUND", `No hero matching ${JSON.stringify(name ?? id)}`);
      }
      return jsonStructured(fullHero(hero));
    },
  );

  registerTool(
    "list_heroes" satisfies ToolName,
    {
      title: "List Guild Wars 1 heroes",
      description:
        "List all GW1 heroes, optionally filtered by profession or campaign name. Useful for team-building: shows which professions are coverable by heroes and how each hero is unlocked.",
      annotations: READ_ONLY,
      outputSchema: listHeroesOutputObject,
      inputSchema: listHeroesInputObject,
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
