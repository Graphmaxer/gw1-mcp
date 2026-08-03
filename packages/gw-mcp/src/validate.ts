import {
  MAX_TEMPLATE_ATTRIBUTE_ID,
  NO_ATTRIBUTE_ID,
  getAttributeById,
  getProfessionById,
  getSkillById,
  type Skill,
} from "@gw1-mcp/gw-data";
import type { SkillTemplate } from "@gw1-mcp/gw-template";

interface ValidationIssue {
  code: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

/**
 * Validates a build against Guild Wars 1 rules.
 * Errors mean the template cannot legally exist; warnings mean it is
 * encodable but suspicious (e.g. PvE-only skills on a hero bar).
 */
/** Cumulative attribute point cost to reach rank r (index = rank). */
const RANK_COST = [0, 1, 3, 6, 10, 15, 21, 28, 37, 48, 61, 77, 97] as const;
/** Max attribute points at level 20 including the two +15 point quests. */
const MAX_ATTRIBUTE_POINTS = 200;

export function validateBuild(
  template: SkillTemplate,
  options: { forHero?: boolean; forPvp?: boolean; unlockedSkillIds?: number[] } = {},
): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  // Attribute point budget: level 20 grants at most 200 points (170 base
  // + 30 from quests). The in-game panel physically prevents exceeding it,
  // so a build over budget cannot exist. Ranks 13-15 fit in the template's
  // 4-bit field but not in-game: the per-attribute check below reports them
  // as RANK_OUT_OF_RANGE, so here they cost 0 and the budget error is
  // suppressed — never sum to Infinity, never double-flag the same cause.
  // Only templatable attributes consume the budget. Title tracks and the
  // no-attribute sentinel (ids > MAX_TEMPLATE_ATTRIBUTE_ID) come from account
  // progress, so a title track at rank 9 used to add 48 phantom points and made
  // this message state a false total — ATTRIBUTE_NOT_TEMPLATABLE already reports
  // the real problem below.
  const budgeted = template.attributes.filter(
    ({ attributeId }) => attributeId <= MAX_TEMPLATE_ATTRIBUTE_ID,
  );
  const hasOutOfRangeRank = budgeted.some(({ rank }) => RANK_COST[rank] === undefined);
  const spentPoints = budgeted.reduce((total, { rank }) => total + (RANK_COST[rank] ?? 0), 0);
  if (!hasOutOfRangeRank && spentPoints > MAX_ATTRIBUTE_POINTS) {
    errors.push({
      code: "ATTRIBUTE_POINTS_EXCEEDED",
      // The cost table goes IN the message. It is non-linear and lived only in
      // this file, so a model overspending had no way to compute a fix and would
      // guess again. ATTRIBUTE_POINTS_EXCEEDED is the most frequent validation
      // failure in production for exactly that reason.
      message: `This attribute spread costs ${spentPoints} points; a level 20 character has at most ${MAX_ATTRIBUTE_POINTS} (170 base + 30 from quests). Cumulative cost per rank is non-linear: ${RANK_COST.map((c, r) => `${r}=${c}`).join(", ")}. Lower some ranks so the total fits.`,
    });
  }

  const primary = getProfessionById(template.primary);
  const secondary = getProfessionById(template.secondary);
  if (!primary) {
    errors.push({
      code: "UNKNOWN_PRIMARY",
      message: `Unknown primary profession id ${template.primary}`,
    });
  }
  if (!secondary) {
    errors.push({
      code: "UNKNOWN_SECONDARY",
      message: `Unknown secondary profession id ${template.secondary}`,
    });
  }
  if (template.primary === 0) {
    errors.push({
      code: "NO_PRIMARY",
      message: "A build must have a primary profession",
    });
  }
  // Secondary must differ from primary. Sourced by arithmetic rather than a
  // sentence, which is stronger: the wiki counts "30 possible core-profession
  // combinations, 56 if you own Factions or Nightfall, and 90 if you own both"
  // (guildwars.fandom.com/wiki/Profession). Six professions give 30 = 6x5, eight
  // give 56 = 8x7, ten give 90 = 10x9 — counts that hold only if the two differ;
  // otherwise they would be 36, 64 and 100.
  if (template.primary !== 0 && template.primary === template.secondary) {
    errors.push({
      code: "SAME_PROFESSIONS",
      message: "Primary and secondary professions must differ",
    });
  }

  if (template.skills.length !== 8) {
    errors.push({
      code: "INVALID_SKILL_COUNT",
      message: `A skill bar has exactly 8 slots, got ${template.skills.length}`,
    });
  }

  // --- skills -------------------------------------------------------------
  const resolved: Array<{ slot: number; skill: Skill }> = [];
  template.skills.forEach((id, slot) => {
    if (id === 0) return; // empty slot is legal
    const skill = getSkillById(id);
    if (!skill) {
      errors.push({
        code: "UNKNOWN_SKILL",
        message: `Slot ${slot + 1}: unknown skill id ${id}`,
      });
      return;
    }
    resolved.push({ slot, skill });
  });

  const seen = new Map<number, number[]>();
  for (const { slot, skill } of resolved) {
    const slots = seen.get(skill.id);
    if (slots) {
      slots.push(slot);
    } else {
      seen.set(skill.id, [slot]);
    }
  }
  // Signet of Capture is the one skill that may appear up to 3 times on a bar;
  // every other skill is unique. (GW1-AUD-03 POC2.)
  const SIGNET_OF_CAPTURE = "Signet of Capture";
  for (const { slot, skill } of resolved) {
    const slots = seen.get(skill.id);
    if (!slots || slots[0] !== slot) continue; // report once, at first occurrence
    const limit = skill.name === SIGNET_OF_CAPTURE ? 3 : 1;
    if (slots.length > limit) {
      // Verified in game 2026-08-01, same silent failure as MULTIPLE_ELITES: the client
      // ACCEPTS a duplicate template — dialog shows all eight skills, Load enabled — and
      // on load the extra copies vanish, leaving empty slots. So the bar does not match
      // the code and nothing says so. No source states the rule (neither we nor a second
      // model found a sentence; the only hint was GWW Talk:Skill_template_format saying
      // such a template "does load", which is true and misleading). Observation settled
      // it, and the message says the consequence rather than only the rule.
      errors.push({
        code: "DUPLICATE_SKILL",
        message:
          limit === 1
            ? `"${skill.name}" appears in slots ${slots.map((s) => s + 1).join(", ")}. The game will load this template and silently empty the extra slots, so the bar in game will not match this code.`
            : `"${skill.name}" may appear at most ${limit} times, found ${slots.length}. Copies beyond the limit are silently dropped on load.`,
      });
    }
  }

  // Verified in game 2026-08-01, and the failure mode is the dangerous one. The client
  // does NOT refuse a two-elite template: the load dialog shows all eight skills with
  // the button enabled, and pressing Charger loads the bar with the SECOND ELITE
  // SILENTLY DROPPED, leaving an empty slot. So the user gets a different bar from the
  // one encoded and is told nothing.
  //
  // That is worse than a refusal and is why this is an error rather than a warning: a
  // refusal is visible, a silent substitution is not. The message says what will
  // happen, since "at most one elite" alone does not tell the caller it will lose a
  // skill without notice.
  //
  // (GWW Skill states the equipping rule — "to a maximum of 8 skills (including at
  // most one elite skill) at a time" — but says nothing about template loading, which
  // is why this needed testing rather than citing.)
  const elites = resolved.filter(({ skill }) => skill.elite);
  if (elites.length > 1) {
    errors.push({
      code: "MULTIPLE_ELITES",
      message: `At most one elite skill per bar, found ${elites.length}: ${elites
        .map((e) => e.skill.name)
        .join(
          ", ",
        )}. The game will load this template anyway and silently drop the later elite, leaving an empty slot — so the bar in game will not match this code. Keep one elite and fill the slot with something else.`,
    });
  }

  for (const { slot, skill } of resolved) {
    // Profession constraint: skill must belong to primary, secondary, or none.
    if (
      skill.professionId !== 0 &&
      skill.professionId !== template.primary &&
      skill.professionId !== template.secondary
    ) {
      const prof = getProfessionById(skill.professionId);
      errors.push({
        code: "PROFESSION_MISMATCH",
        // Verified in game 2026-08-01: the client REFUSES the whole template — Load
        // greyed, header "...", eight empty slots — rather than emptying the slot. Same
        // group as a wrong-profession ATTRIBUTE, so skills and attributes behave alike.
        // Contrast the limit rules (MULTIPLE_ELITES, DUPLICATE_SKILL), which load and
        // trim silently. The pattern across every case tested: what is IMPOSSIBLE is
        // refused outright, what merely EXCEEDS a limit is trimmed without a word.
        message: `Slot ${slot + 1}: "${skill.name}" is a ${prof?.name ?? "?"} skill, not available to ${primary?.abbr ?? "?"}/${secondary?.abbr ?? "?"}. The game refuses to load a template containing it — the entire code, not just this slot.`,
      });
    }

    // Availability against a GWToolbox account export (/exportaccount).
    if (options.unlockedSkillIds !== undefined && !options.unlockedSkillIds.includes(skill.id)) {
      warnings.push({
        code: "SKILL_NOT_UNLOCKED",
        message: `Slot ${slot + 1}: "${skill.name}" is not in the provided unlocked skill list`,
      });
    }

    // PvE-only (roleplay) skills. Detected via the upstream is_rp flag, not
    // an attributeId heuristic that misses no-attribute PvE signets (GW1-AUD-03).
    // A PvP-only character cannot use PvE-only skills at all. Verified against the
    // official wiki rather than asserted from memory:
    //
    //   "PvE-only skills are only accessible to roleplaying characters and only
    //    usable in PvE areas ... cannot be unlocked for the account."
    //    — wiki.guildwars.com/wiki/List_of_PvE-only_skills
    //   "since PvE-only skills can only be learned by Roleplaying characters and
    //    cannot be unlocked, it is not possible for PvP characters to learn or use
    //    these skills."
    //    — wiki.guildwars.com/wiki/PvP_Access_Kit
    //
    // `forPvp` means a PvP CHARACTER's bar, which the split-version message above
    // already states ("only exists on PvP characters"), so a hard error is right.
    // The nuance if that ever changes: a ROLEPLAYING character may equip a
    // PvE-only skill and enter a PvP area, where it merely shows as locked and
    // unusable — that case would be a warning, not an error.
    //
    // This mirrors PVE_ONLY_ON_HERO and was missing: forPvp only checked the
    // PvE/PvP split VERSIONS of ordinary skills, a different rule, and 54
    // PvE-only skills carry no profession so they passed every other check.
    if (options.forPvp && skill.isRoleplay) {
      errors.push({
        code: "PVE_ONLY_ON_PVP_BUILD",
        message: `Slot ${slot + 1}: "${skill.name}" is a PvE-only skill and cannot be used on a PvP character. Remove it, or drop forPvp if this is a roleplay bar.`,
      });
    }

    if (options.forHero && skill.isRoleplay && skill.name !== SIGNET_OF_CAPTURE) {
      // Heroes cannot equip PvE-only skills at all — this is a hard error, the
      // message claimed impossibility while the code only warned (POC3).
      errors.push({
        code: "PVE_ONLY_ON_HERO",
        message: `Slot ${slot + 1}: "${skill.name}" is a PvE-only skill; heroes cannot equip it`,
      });
    }
  }

  // Signet of Capture cannot be equipped by heroes either (POC3).
  // Reported once with every offending slot, mirroring DUPLICATE_SKILL: three
  // copies of Signet of Capture used to emit the same code three times, which
  // reads to a model as three distinct problems to fix.
  if (options.forHero) {
    const captureSlots = resolved
      .filter(({ skill }) => skill.name === SIGNET_OF_CAPTURE)
      .map(({ slot }) => slot + 1);
    if (captureSlots.length > 0) {
      errors.push({
        code: "PVE_ONLY_ON_HERO",
        message: `Slot${captureSlots.length > 1 ? "s" : ""} ${captureSlots.join(", ")}: "${SIGNET_OF_CAPTURE}" cannot be equipped by heroes`,
      });
    }
  }

  // PvP/PvE split skills. The data has always carried isPvpVersion, searchSkills
  // hides those versions by default and fullSkillShape shows the flag to the
  // model — but the validator never read it, so a "(PvP)" skill encoded into a
  // PvE bar came back valid with no remark. In game the PvP versions exist only
  // on PvP characters, so that template does not produce the bar the player was
  // shown. Mirrors forHero: the caller states the context, the validator checks
  // it, in both directions.
  for (const { slot, skill } of resolved) {
    // A PvP-version id makes the WHOLE template unloadable. Both halves of this were
    // established in game on 2026-08-01, on a PvP-only Mesmer:
    //
    // 1. The client never WRITES a PvP id. Equipping Fragility and Empathy and saving
    //    produced `OQBDAowjCXoyJEhyEaIA` = skills [23,42,39,68,40,19,26,2] — ids 19
    //    and 26, the PvE versions, not 2998 and 3151.
    // 2. The client refuses to READ one. Three hand-built codes — both skills as PvP
    //    ids, then Fragility alone, then Empathy alone — all failed to load: eight
    //    empty slots, professions shown as "...", Load button greyed. Not slot by
    //    slot: the entire template is rejected, with no message.
    //
    // Isolated from a format problem rather than assumed: the same bar with a
    // legitimate high-id skill (Psychic Distraction, 1053) encodes to a 24-character
    // code with the same wide `bits_per_skill_id` field and loads perfectly. So the
    // width is fine and the ids are the cause.
    //
    // Hence an ERROR, and independent of forPvp — the original rule had the severity
    // right and the condition wrong. One such id costs the user the whole bar, which
    // is exactly the failure this project exists to prevent.
    if (skill.isPvpVersion) {
      errors.push({
        code: "PVP_VERSION_IN_TEMPLATE",
        message: `Slot ${slot + 1}: "${skill.name}" is a PvP-version skill id. The game never writes one — not even on a PvP character — and refuses to load any template containing one, silently and entirely. Use the PvE id ${skill.splitId ?? "of the unsplit version"}; the client switches to the PvP version by zone.`,
      });
    }

    // There is deliberately NO rule for "PvE version on a PvP bar". It was an error
    // here until 2026-08-01 and it rejected the NORMAL case: run against the very
    // template above, saved by a PvP character, it produced two errors telling the
    // player to use ids the game had deliberately not written. Every genuine PvP
    // template carries PvE ids for all 156 split skills, and the client swaps by zone
    // — "split versions for PvE and PvP ... update automatically when in each
    // respective zone" (wiki.guildwars.com/wiki/Skill).
  }

  // A player bar may hold at most 3 PvE-only skills (POC1), and Signet of Capture
  // COUNTS toward that cap. This previously excluded it, which was wrong —
  // verified against sources rather than reasoned:
  //
  //   "Signet of Capture is a PvE-only skill. Therefore it cannot be equipped by
  //    heroes and is subject to the limit of 3 PvE-only skills at a time."
  //    — guildwars.fandom.com/wiki/Signet_of_Capture
  //   "when I try to add more than three SoC's ... one gets kicked off because
  //    there is a maximum of three PvE only skills"
  //    — wiki.guildwars.com/wiki/Talk:Signet_of_Capture
  //   "the August 23, 2007 update that limited a skill bar to having only 3
  //    PvE-only skills" — wiki.guildwars.com/wiki/Elite_skill
  //
  // The case this used to accept and the game rejects: three PvE-only skills plus
  // a Signet of Capture, which is four. Contemporary player reports name exactly
  // that combination as the update's consequence.
  if (!options.forHero) {
    const pveOnly = resolved.filter(({ skill }) => skill.isRoleplay);
    if (pveOnly.length > 3) {
      errors.push({
        code: "TOO_MANY_PVE_SKILLS",
        message: `At most 3 PvE-only skills per bar, found ${pveOnly.length}: ${pveOnly
          .map((e) => e.skill.name)
          .join(", ")}`,
      });
    }
  }

  // --- attributes -----------------------------------------------------------
  const seenAttributes = new Set<number>();
  for (const { attributeId, rank } of template.attributes) {
    const attribute = getAttributeById(attributeId);
    if (!attribute) {
      errors.push({
        code: "UNKNOWN_ATTRIBUTE",
        message: `Unknown attribute id ${attributeId}`,
      });
      continue;
    }
    if (seenAttributes.has(attributeId)) {
      errors.push({
        code: "DUPLICATE_ATTRIBUTE",
        message: `Attribute "${attribute.name}" allocated twice`,
      });
    }
    seenAttributes.add(attributeId);

    if (attributeId > MAX_TEMPLATE_ATTRIBUTE_ID) {
      errors.push({
        code: "ATTRIBUTE_NOT_TEMPLATABLE",
        message: `"${attribute.name}" is a ${attributeId === NO_ATTRIBUTE_ID ? "non-attribute" : "PvE title track"}; title ranks come from account progress and cannot be allocated in a skill template`,
      });
      continue;
    }

    if (rank < 0 || rank > 12) {
      errors.push({
        code: "RANK_OUT_OF_RANGE",
        message: `"${attribute.name}" rank ${rank} out of range (base ranks are 0-12)`,
      });
    }

    if (attributeId <= MAX_TEMPLATE_ATTRIBUTE_ID) {
      // Regular profession attribute: must belong to primary or secondary.
      if (
        attribute.professionId !== template.primary &&
        attribute.professionId !== template.secondary
      ) {
        errors.push({
          code: "ATTRIBUTE_PROFESSION_MISMATCH",
          message: `"${attribute.name}" does not belong to ${primary?.abbr ?? "?"}/${secondary?.abbr ?? "?"}`,
        });
      } else if (attribute.isPrimary && attribute.professionId !== template.primary) {
        errors.push({
          code: "PRIMARY_ATTRIBUTE_ON_SECONDARY",
          message: `"${attribute.name}" is a primary attribute of ${getProfessionById(attribute.professionId)?.name ?? "?"} and requires it as primary profession`,
        });
      }
    }
  }

  // Skills whose attribute has no allocation: legal, but worth flagging.
  for (const { slot, skill } of resolved) {
    if (skill.attributeId <= MAX_TEMPLATE_ATTRIBUTE_ID && !seenAttributes.has(skill.attributeId)) {
      const attribute = getAttributeById(skill.attributeId);
      warnings.push({
        code: "UNALLOCATED_ATTRIBUTE",
        message: `Slot ${slot + 1}: "${skill.name}" scales with ${attribute?.name ?? "?"}, which has no points allocated`,
      });
    }
  }

  // The mirror of UNALLOCATED_ATTRIBUTE: points spent on a line no skill on the
  // bar scales with. Legal, but it is the most common way a generated build
  // wastes its budget — a themed line allocated "for coherence" with nothing on
  // it. Reported so the self-correction loop can reclaim the points.
  const usedAttributeIds = new Set(resolved.map(({ skill }) => skill.attributeId));
  for (const { attributeId, rank } of budgeted) {
    const attribute = getAttributeById(attributeId);
    // A primary attribute is never wasted: its effect is passive and needs no
    // skill from its own line (Mysticism returns energy when an enchantment
    // ends, Divine Favor heals on every healing spell, Soul Reaping gives energy
    // on every death, Energy Storage raises the pool). Warning about it made the
    // model pull points out of the single best place it had put them — the
    // self-correction loop turned a good bar into a worse one, which is more
    // harmful than staying silent.
    if (rank > 0 && !attribute?.isPrimary && !usedAttributeIds.has(attributeId)) {
      warnings.push({
        code: "UNUSED_ATTRIBUTE",
        message: `"${attribute?.name ?? attributeId}" is at rank ${rank} (${RANK_COST[rank] ?? 0} points) but no skill on this bar scales with it`,
      });
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}
