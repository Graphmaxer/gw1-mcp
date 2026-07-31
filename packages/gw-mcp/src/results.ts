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

export function json(data: unknown) {
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

/** Enrich a hero with resolved profession/campaign names (single source). */
export function fullHero(hero: Hero): FullHeroOut {
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
