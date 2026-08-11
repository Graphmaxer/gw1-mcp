import {
  getAttributeById,
  getCampaignById,
  getProfessionById,
  getSkillById,
  getSkillType,
  type Hero,
} from "@gw1-mcp/gw-data";
import type { FullHeroOut, FullSkillOut } from "./schemas.js";

/**
 * Shaping tool results: the MCP content envelope, the error envelope, and the two
 * enriched views that resolve ids to names.
 *
 * The `fullSkill` comment about never spreading is load-bearing — a `...skill`
 * there leaked six internal join keys into a strict output schema and broke
 * get_skill for every client that primes its validators.
 */

/**
 * The bare content envelope. Local on purpose: only `jsonStructured` and
 * `jsonError` below build on it, and every tool goes through one of those. It was
 * briefly exported when this file was split out of server.ts, and knip caught the
 * dead export as soon as the last caller there was removed.
 */
function json(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}
export function jsonStructured(data: object) {
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
export function jsonError(code: string, message: string, extra?: Record<string, unknown>) {
  return { ...json({ error: { code, message, ...extra } }), isError: true };
}

/**
 * Enrich a hero with resolved profession/campaign names (single source).
 *
 * Every field listed explicitly, for the same reason as fullSkill below: this was
 * `...hero`, and the five keys happened to line up exactly — but heroes.json is
 * REGENERATED every week from the GWCA enum plus the curated overlay, so one new
 * overlay field would have leaked into a strict schema. TypeScript cannot catch
 * that (excess-property checks do not apply to spreads), which is precisely how
 * get_skill shipped broken. Audit L5, 2026-08-08.
 */
export function fullHero(hero: Hero): FullHeroOut {
  return {
    id: hero.id,
    name: hero.name,
    professionId: hero.professionId,
    campaignId: hero.campaignId,
    unlock: hero.unlock,
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
export function fullSkill(id: number): FullSkillOut | null {
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
 * Slot label and notes for one paw-ned2 entry, across both upstream shapes.
 *
 * @buildwars/gw-templates 1.1.x supplies the paw-ned2 `templatename` field and leaves
 * `description` to the notes. 1.0.x had no templatename and packed "label\nnotes" into
 * description. Verified on the 3 Hero Discordway fixture: 1.0.1 gives templatename
 * undefined with description "Player\nhttps://...", 1.1.1 gives "Player" and
 * "https://...".
 *
 * Extracted as a pure function so both shapes are actually exercised. The first version
 * of this lived inline and its test re-implemented the logic instead of calling it,
 * which left the 1.0.x branch uncovered — the coverage gate caught the duplication, not
 * a missing test.
 */
export function pwndSlotLabel(
  templatename: string | undefined,
  description: string,
): { label: string; notes: string | null } {
  const fromName = (templatename ?? "").trim();
  const lines = description.split("\n");
  if (fromName) {
    return { label: fromName, notes: lines.join("\n").trim() || null };
  }
  const [fromDescription = "", ...rest] = lines;
  return { label: fromDescription, notes: rest.join("\n").trim() || null };
}
