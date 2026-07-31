import { z } from "zod";
import { decodedBuildShape } from "./build-io.js";

/**
 * Every zod shape, inferred type, tool input/output schema and pre-built schema
 * object the tools declare, plus the input bounds that are schema constraints.
 *
 * Split out of server.ts (1001 lines) on 2026-07-31 because the seam is real: this
 * is immutable data with no dependency on the server. Contrast validate.ts, which
 * was deliberately NOT split — its rules share mutable intermediate state and
 * interact by order, so separating them would have hidden those interactions behind
 * a nine-field context object.
 *
 * Only what another file consumes is exported. The intermediate shapes
 * (namedBuildSchema, issueSchema, the per-tool inputs and outputs) stay local: they
 * exist to build the `*Object` schemas below, and exporting them defensively is how
 * the first version of this split failed knip — thirteen unused exports, which is
 * dead public surface rather than an oversight.
 */

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
export const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

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

export const skillSummarySchema = z.object({
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

export type FullSkillOut = z.infer<z.ZodObject<typeof fullSkillShape>>;

export const fullHeroSchema = z.object({
  id: z.number().int().describe("GWCA HeroID"),
  name: z.string(),
  professionId: z.number().int(),
  campaignId: z.number().int(),
  unlock: z.string().describe("How the hero is recruited"),
  profession: z.string().nullable(),
  campaign: z.string().nullable(),
});

export type FullHeroOut = z.infer<typeof fullHeroSchema>;

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
export const MAX_TEMPLATE_CODE_LEN = 128;

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
export const MAX_PWND_SLOTS = 12;

/**
 * Longest accepted pwnd blob. The previous 256 KiB was 817x larger than needed:
 * a real 4-slot PvX team blob, notes and source URL included, measures 321
 * characters. 16 KiB leaves room for eight slots with long notes and still keeps
 * the container parse — which runs BEFORE the slot cap can apply — cheap.
 *
 * Both bounds matter. The slot cap stops the handler doing 29 112 decodes; this
 * one stops the upstream container parse being handed 256 KiB in the first place.
 */
export const MAX_PWND_BLOB_LEN = 16384;

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

/**
 * Pre-built `z.object` wrappers for every schema handed to `registerTool`.
 *
 * The SDK converts a raw shape with `objectFromShape`, which calls
 * `z.object(shape)` — so it was rebuilding all sixteen of these on every request,
 * measured at 0.054 ms each, about 1.19 ms of the 2.70 ms spent inside
 * registerTool. Given an already-built schema it returns it untouched, so building
 * them once here removes that work.
 *
 * Verified equivalent rather than assumed: the published `tools/list` JSON Schema
 * is byte-identical, and strictness survives — a structured result with an extra
 * property is still rejected, which is the check that caught get_skill leaking six
 * internal ids. Both `zod/mini` (what the SDK uses internally) and full `zod`
 * produce identical output; full zod keeps the file uniform.
 */
export const fullSkillShapeObject = z.object(fullSkillShape);
export const getSkillInputObject = z.object(getSkillInput);
export const searchSkillsOutputObject = z.object(searchSkillsOutput);
export const decodedBuildShapeObject = z.object(decodedBuildShape);
export const pwndOutputObject = z.object(pwndOutput);
export const encodeResultSchemaObject = z.object(encodeResultSchema);
export const encodeInputObject = z.object(encodeInput);
export const validateResultSchemaObject = z.object(validateResultSchema);
export const validateInputObject = z.object(validateInput);
export const getHeroInputObject = z.object(getHeroInput);
export const listHeroesOutputObject = z.object(listHeroesOutput);
export const listHeroesInputObject = z.object(listHeroesInput);
