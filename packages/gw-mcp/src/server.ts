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
  primary: z.string().max(64).describe('Primary profession, e.g. "Dervish"'),
  secondary: z
    .string()
    .max(64)
    .optional()
    .describe('Secondary profession, e.g. "Monk". Omit or "None" for none.'),
  attributes: z
    .array(
      z.object({
        attribute: z.string().max(64).describe('Exact attribute name, e.g. "Mysticism"'),
        rank: z.number().int().min(0).max(12).describe("Base rank 0-12 (before runes)"),
      }),
    )
    // The template format's attribute count is a 4-bit field (0-15); anything
    // beyond that can't be legal or even encodable. Unbounded here let a
    // compact request (e.g. 1000 repeated attributes) blow up validation into
    // ~1000 DUPLICATE_ATTRIBUTE errors — response-size amplification, not just
    // CPU (GW1-RESTE-01).
    .max(15)
    .describe("Attribute point allocations (template format caps this at 15 entries)"),
  skills: z
    .array(z.string().max(64).nullable())
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

const issueSchema = z.object({
  code: z.string(),
  message: z.string(),
  suggestions: z.array(z.string()).optional().describe("Closest-match names, on resolution errors"),
});
/**
 * encode_template output. Three shapes occur at runtime, all declared here
 * (GW1-RESTE-03 — a prior comment claimed only two, which was itself
 * inaccurate): { code, warnings? } on success; { valid: false, errors,
 * warnings } when the build resolves but is illegal; { errors } alone when
 * name resolution fails before validation even runs (no valid/warnings key).
 * MCP outputSchema has no discriminated-union/XOR support, so fields stay
 * individually optional — the exclusivity is a handler+test invariant, not
 * expressible in the schema.
 */
const encodeResultSchema = {
  code: z.string().optional().describe("Official in-game template code (present on success)"),
  valid: z
    .boolean()
    .optional()
    .describe("false when the build resolved but is illegal; absent on the other two shapes"),
  errors: z
    .array(issueSchema)
    .optional()
    .describe("Present (non-empty) when resolution failed or the build is invalid"),
  warnings: z.array(issueSchema).optional().describe("Advisories accompanying a successful code"),
};
/**
 * validate_build output: always a report with a boolean verdict and both
 * issue arrays present (possibly empty), never a code. Required fields stop
 * the empty-object and missing-verdict shapes the shared schema allowed.
 */
const validateResultSchema = {
  valid: z.boolean().describe("Whether the build is legal in-game"),
  errors: z.array(issueSchema).describe("Blocking problems; empty when valid"),
  warnings: z.array(issueSchema).describe("Non-blocking advisories"),
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
  isRoleplay: z.boolean().describe("PvE-only skill: max 3 per player bar, none on heroes"),
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
  // Passthrough rather than re-inlining decodedBuildShape (audit H1). Inlining it
  // made this one tool 2383 of the 19447 characters every conversation pays for
  // tools/list — for the least-called tool — and duplicated a contract that
  // decode_template already declares in full and the golden fixtures already
  // lock. Same shape at runtime, declared once.
  build: z
    .looseObject({})
    .optional()
    .describe("Decoded bar (absent if decoding failed). Same shape as decode_template's output."),
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

/**
 * Every field listed EXPLICITLY, never `...skill`.
 *
 * The spread leaked six internal fields the declared schema does not have —
 * attributeId, campaignId, professionId, typeId, pvpSplit, splitId — and
 * fullSkillShape is a strict object, so any client that primes its output
 * validators with tools/list (which every real client does) had get_skill fail
 * with "data must NOT have additional properties". TypeScript could not catch it:
 * excess-property checks do not apply to spreads, so the raw record widened
 * silently into the return type.
 *
 * The ids are deliberately not exposed here. `id` is, because it appears in
 * template codes; the rest are internal join keys, and callers get resolved names.
 */
function fullSkill(id: number): FullSkillOut | null {
  const skill = getSkillById(id);
  if (!skill) return null;
  return {
    id: skill.id,
    name: skill.name,
    elite: skill.elite,
    isRoleplay: skill.isRoleplay,
    energy: skill.energy,
    activation: skill.activation,
    recharge: skill.recharge,
    adrenaline: skill.adrenaline,
    sacrifice: skill.sacrifice,
    overcast: skill.overcast,
    upkeep: skill.upkeep,
    description: skill.description,
    isPvpVersion: skill.isPvpVersion,
    profession: getProfessionById(skill.professionId)?.name ?? null,
    attribute: getAttributeById(skill.attributeId)?.name ?? null,
    campaign: getCampaignById(skill.campaignId)?.name ?? null,
    type: getSkillType(skill.typeId)?.name ?? null,
  };
}

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
 * Turn a tool result into a domain event. Reads the RESULT rather than the
 * request on purpose: an entity name taken from structuredContent has been
 * resolved against our dataset, whereas the argument is whatever the caller
 * typed. Codes likewise come from our own enums.
 *
 * Deliberately NOT captured: the template code produced by encode_template. It
 * is derived from caller input and carries no aggregate meaning.
 */
function deriveEvent(
  tool: ToolName,
  args: unknown,
  result: {
    isError?: boolean;
    structuredContent?: Record<string, unknown>;
    content?: { text?: string }[];
  },
): ToolCallEvent {
  const ok = result.isError !== true;
  const structured = result.structuredContent;

  // Error code: jsonError puts it in the JSON body, since a failed call carries
  // no structuredContent.
  let code: string | undefined;
  if (!ok) {
    try {
      const body = JSON.parse(result.content?.[0]?.text ?? "{}") as {
        error?: { code?: string };
      };
      code = typeof body.error?.code === "string" ? body.error.code : undefined;
    } catch {
      code = undefined;
    }
  } else if (Array.isArray(structured?.["errors"])) {
    // A requested report (validate_build, encode_template rule violations) is a
    // successful call whose content says the build is illegal. The FIRST code is
    // the interesting one: it is what a caller would fix first.
    const first = (structured["errors"] as { code?: unknown }[])[0]?.code;
    code = typeof first === "string" ? first : undefined;
  }

  // Canonical entity, only where a single one was resolved.
  const entity =
    ok && (tool === "get_skill" || tool === "get_hero") && typeof structured?.["name"] === "string"
      ? (structured["name"] as string)
      : undefined;

  // Context flags: typed booleans from the schema, never free text.
  const flags: string[] = [];
  if (args && typeof args === "object") {
    const a = args as Record<string, unknown>;
    if (a["forHero"] === true) flags.push("forHero");
    if (a["forPvp"] === true) flags.push("forPvp");
    if (Array.isArray(a["unlockedSkillIds"])) flags.push("unlockedSkillIds");
  }

  return {
    tool,
    ok,
    ...(code !== undefined && { code }),
    ...(entity !== undefined && { entity }),
    ...(flags.length > 0 && { flags }),
  };
}

export interface ToolCallEvent {
  /** Which tool ran. Always one of TOOL_NAMES. */
  readonly tool: ToolName;
  /** false when the call itself failed (MCP isError), not when a report says invalid. */
  readonly ok: boolean;
  /** Our own error or validation code, e.g. NOT_FOUND, MULTIPLE_ELITES. */
  readonly code?: string;
  /** Canonical entity name resolved from our dataset, e.g. "Mystic Regeneration". */
  readonly entity?: string;
  /** Context flags the caller actually set, e.g. ["forHero"]. Booleans, not text. */
  readonly flags?: readonly string[];
}

export interface CreateServerOptions {
  /** Optional observer. Must never throw; failures are swallowed by design. */
  readonly onToolCall?: (event: ToolCallEvent) => void;
}

/**
 * Longest accepted template code on the `code` argument. A real in-game code is
 * around 25 characters, so this is generous; the point is that decode cost grows
 * with input length — 22.5 ms for 262 144 characters against a 10 ms per-request
 * CPU cap.
 *
 * Only this entry point needs it. Pwnd slots are bounded by the format itself: each
 * field's length is encoded in a single base64 character, so a slot code cannot
 * exceed 63 characters.
 */
const MAX_TEMPLATE_CODE_LEN = 128;

/**
 * Most slots a pwnd blob may declare. A paw-ned2 team is a player plus up to
 * seven heroes, so eight is the real maximum and twelve is deliberately generous.
 *
 * This is the load-bearing bound on this tool, and it was missing. The blob was
 * capped at 256 KiB, but the CONTAINER turns size into slot COUNT: a 262 000-byte
 * blob of filler parses into 29 112 slots, and the handler decodes and describes
 * every one. Measured end to end: 409.7 ms of CPU and a 12.9 MB response for one
 * request, against a 10 ms per-request CPU cap — 41x over, and repeatable 100
 * times a minute per address under the rate limiter.
 *
 * Rejecting is right rather than truncating: 29 112 slots is not a team, so there
 * is nothing useful to return from the first twelve of it.
 */
const MAX_PWND_SLOTS = 12;

/**
 * Longest accepted pwnd blob. The previous 256 KiB was 817x larger than needed:
 * a real 4-slot PvX team blob, notes and source URL included, measures 321
 * characters. 16 KiB leaves room for eight slots with long notes and still keeps
 * the container parse — which runs BEFORE the slot cap can apply — cheap.
 *
 * Both bounds matter. The slot cap stops the handler doing 29 112 decodes; this
 * one stops the upstream container parse being handed 256 KiB in the first place.
 */
const MAX_PWND_BLOB_LEN = 16384;

/**
 * Tool input schemas live at MODULE scope, not inline in `createServer`.
 *
 * `createServer` runs on EVERY /mcp request (the SDK refuses to reuse a server
 * across transports — "Already connected to a transport" — and `close()` is
 * unavailable here, see the B6 note in the worker). Measured, its 5.37 ms splits
 * into ~2.70 ms inside registerTool/registerResource, ~2.02 ms building these
 * argument literals, and ~0.65 ms in the constructor. The SDK's half is not
 * recoverable; this half is, and for free — zod schemas are immutable value
 * objects, so sharing them across server instances carries no concurrency risk.
 *
 * Anything reused by more than one tool already lives above (namedBuildSchema and
 * friends). These are the per-tool literals that were being rebuilt.
 */
const getSkillInput = {
  name: z
    .string()
    .max(64)
    .optional()
    .describe('Exact English skill name, e.g. "Mystic Regeneration"'),
  id: z.number().int().min(0).max(65535).optional().describe("Template skill id"),
};

const getHeroInput = {
  name: z.string().max(64).optional().describe('Hero name, e.g. "Master of Whispers"'),
  id: z.number().int().min(0).max(255).optional().describe("GWCA HeroID value"),
};

// Both filters REJECT unknown values (UNKNOWN_PROFESSION / UNKNOWN_CAMPAIGN), so
// the accepted spellings belong in the schema: without them a caller guesses
// "EotN" and burns a round-trip. The lists are the values that actually match a
// hero — every profession has heroes except None, and Core has none.
const listHeroesInput = {
  professionName: z
    .string()
    .max(64)
    .optional()
    .describe(
      "Filter by the hero's profession, exact English name: Warrior, Ranger, Monk, Necromancer, Mesmer, Elementalist, Assassin, Ritualist, Paragon or Dervish.",
    ),
  campaignName: z
    .string()
    .max(64)
    .optional()
    .describe(
      "Filter by the campaign the hero is recruited in, exact English name: Prophecies, Factions, Nightfall or Eye of the North.",
    ),
};

const encodeInput = {
  ...namedBuildSchema,
  forHero: z
    .boolean()
    .default(false)
    .describe("Set true if this bar is for a hero (PvE-only skills are flagged)"),
  forPvp: z
    .boolean()
    .default(false)
    .describe(
      "Set true for a PvP character's bar. PvP versions of split skills are only valid when this is true, and a PvP bar is expected to use them.",
    ),
  unlockedSkillIds: z
    .array(z.number().int().min(0).max(65535))
    .max(8192)
    .optional()
    .describe(
      "Optional: unlocked skill ids from a GWToolbox account export (/exportaccount). Skills outside this list are flagged as warnings.",
    ),
};

const validateInput = {
  ...namedBuildSchema,
  forHero: z
    .boolean()
    .default(false)
    .describe("Set true if this bar is for a hero (PvE-only skills are flagged)"),
  forPvp: z
    .boolean()
    .default(false)
    .describe(
      "Set true for a PvP character's bar (PvP versions of split skills are only valid then).",
    ),
  unlockedSkillIds: z
    .array(z.number().int().min(0).max(65535))
    .max(8192)
    .optional()
    .describe(
      "Optional: unlocked skill ids from a GWToolbox account export (/exportaccount). Skills outside this list are flagged as warnings.",
    ),
};

const searchSkillsOutput = {
  total: z.number().int().describe("Total matches before limit/offset are applied"),
  skills: z.array(skillSummarySchema).describe("Compact records; use get_skill for full details"),
};

const pwndOutput = {
  builds: z.array(pwndEntrySchema).describe("One entry per team slot, in blob order"),
};

const listHeroesOutput = {
  total: z.number().int(),
  heroes: z.array(fullHeroSchema),
};

export function createServer(options: CreateServerOptions = {}): McpServer {
  const server = new McpServer(
    {
      name: "gw1-mcp",
      version: "0.9.1", // x-release-please-version
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
      outputSchema: fullSkillShape,
      inputSchema: getSkillInput,
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
      outputSchema: searchSkillsOutput,
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
      outputSchema: decodedBuildShape,
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
      outputSchema: pwndOutput,
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

  registerTool(
    "encode_template" satisfies ToolName,
    {
      title: "Encode a build into a template code",
      description:
        "Compile a build (professions, attributes, 8 skills by exact English name) into an official in-game template code. The build is validated first; on rule violations the errors are returned instead of a code. Unknown skill names return closest-match suggestions. IMPORTANT: template codes MUST come from this tool — never write or guess a code by hand, hand-written codes are invalid in-game. If unsure, verify any code with decode_template.",
      annotations: READ_ONLY,
      outputSchema: encodeResultSchema,
      inputSchema: encodeInput,
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
      outputSchema: validateResultSchema,
      inputSchema: validateInput,
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
      inputSchema: getHeroInput,
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
      outputSchema: listHeroesOutput,
      inputSchema: listHeroesInput,
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
