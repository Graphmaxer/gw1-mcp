import type { ToolName } from "./tool-names.js";
import { type CreateServerOptions, deriveEvent } from "./events.js";
import {
  MAX_PWND_SLOTS,
  READ_ONLY,
  decodePwndInputObject,
  decodeTemplateInputObject,
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
  searchSkillsInputObject,
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
  suggestProfessionNames,
  getHeroById,
  getHeroByName,
  getProfessionByName,
  getSkillByName,
  attributes,
  campaigns,
  heroes,
  professions,
  skillTypes,
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
import { fullHero, fullSkill, jsonError, jsonStructured, pwndSlotLabel } from "./results.js";

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
        "Search the full GW1 skill database by profession, attribute, campaign, elite flag or name fragment (valid values are documented per parameter). Returns compact records, at most `limit` of them alongside a `total` count of every match — a full page is not the whole result, page with offset. Use get_skill for full details.",
      annotations: READ_ONLY,
      outputSchema: searchSkillsOutputObject,
      inputSchema: searchSkillsInputObject,
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
              { suggestions: suggestProfessionNames(professionName) },
            );
          filters.professionId = profession.id;
        }
      }
      if (attributeName !== undefined) {
        const attribute = getAttributeByName(attributeName);
        if (!attribute)
          return jsonError(
            "UNKNOWN_ATTRIBUTE",
            // Suggestions go in the FIELD issueSchema documents, not inside the
            // prose — get_skill has always used the field, and one idea in two
            // shapes makes a caller parse text to recover data it was handed.
            `Unknown attribute ${JSON.stringify(attributeName)}. Title tracks and each profession's attribute lines are listed in the gw1://meta resource.`,
            { suggestions: suggestAttributeNames(attributeName) },
          );
        filters.attributeId = attribute.id;
      }
      if (campaignName !== undefined) {
        const campaign = getCampaignByName(campaignName);
        if (!campaign)
          return jsonError("UNKNOWN_CAMPAIGN", `Unknown campaign ${JSON.stringify(campaignName)}`, {
            suggestions: campaigns.map((c) => c.name),
          });
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
      inputSchema: decodeTemplateInputObject,
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
      inputSchema: decodePwndInputObject,
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
          // Both upstream shapes handled in one pure helper; see pwndSlotLabel.
          const { label, notes } = pwndSlotLabel(
            // Cast because the shipped TYPES lag the implementation: 1.1.1 returns
            // templatename at runtime but declares only skills, equipment, weaponsets,
            // player, description and flags. Reported upstream; remove when they catch up.
            (entry as { templatename?: string }).templatename,
            entry.description,
          );
          return {
            slot: index + 1,
            label,
            notes,
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
        "Check a build (professions, attributes, 8 skills by exact English name) against Guild Wars 1 rules: one elite max, profession/attribute ownership, primary attributes, duplicates, rank ranges. Returns { valid, errors, warnings } without encoding — use encode_template instead when you also want the template code, since it runs these same rules and refuses on any error.",
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
        "Look up a GW1 hero by name or by id (GWCA HeroID, matching the AccountExport plugin output). Returns profession, campaign and how the hero is unlocked. Remember: heroes can equip any skill unlocked at ACCOUNT level, but NO PvE-only skill at all — including Signet of Capture. validate_build with forHero=true reports each one as an error, not a warning. Use this for one known hero; to browse or filter the roster, use list_heroes instead.",
      annotations: READ_ONLY,
      outputSchema: fullHeroSchema.shape,
      inputSchema: getHeroInputObject,
    },
    async ({ name, id }) => {
      // Both branches mirror get_skill: "exactly one" means neither is a bad
      // REQUEST, not a lookup that missed. Without the second branch the call
      // answered NOT_FOUND: "No hero matching undefined" — the wrong taxonomy
      // code (NOT_FOUND is for a direct lookup that missed) and a message that
      // told the caller nothing about what to send instead (audit L6).
      if (name !== undefined && id !== undefined) {
        return jsonError("BAD_REQUEST", "Provide exactly one of name or id, not both");
      }
      if (name === undefined && id === undefined) {
        return jsonError("BAD_REQUEST", "Provide exactly one of name or id");
      }
      const hero =
        name !== undefined ? getHeroByName(name) : id !== undefined ? getHeroById(id) : undefined;
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
            { suggestions: suggestProfessionNames(professionName) },
          );
        results = results.filter((h) => h.professionId === profession.id);
      }
      if (campaignName !== undefined) {
        const campaign = getCampaignByName(campaignName);
        if (!campaign)
          return jsonError("UNKNOWN_CAMPAIGN", `Unknown campaign ${JSON.stringify(campaignName)}`, {
            suggestions: campaigns.map((c) => c.name),
          });
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
   ANY PvE-only skill, Signet of Capture included, and each one is a blocking
   error rather than a warning).
6. **Encode** with encode_template only once validation passes, and give the
   player the code(s) to paste in-game.

Data freshness: skill stats follow the CURRENT Reforged balance patch (the
data source tracks official updates). Check gw1://meta for the import date;
only cross-check the wiki if that date looks stale.
`;
