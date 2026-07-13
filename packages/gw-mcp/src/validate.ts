import { getAttribute, getProfession, getSkillById, type Skill } from "@gw1-mcp/gw-data";
import type { SkillTemplate } from "@gw1-mcp/gw-template";

export interface ValidationIssue {
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
  options: { forHero?: boolean; unlockedSkillIds?: number[] } = {},
): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  // Attribute point budget: level 20 grants at most 200 points (170 base
  // + 30 from quests). The in-game panel physically prevents exceeding it,
  // so a build over budget cannot exist. Ranks 13-15 fit in the template's
  // 4-bit field but not in-game: the per-attribute check below reports them
  // as RANK_OUT_OF_RANGE, so here they cost 0 and the budget error is
  // suppressed — never sum to Infinity, never double-flag the same cause.
  const hasOutOfRangeRank = template.attributes.some(({ rank }) => RANK_COST[rank] === undefined);
  const spentPoints = template.attributes.reduce(
    (total, { rank }) => total + (RANK_COST[rank] ?? 0),
    0,
  );
  if (!hasOutOfRangeRank && spentPoints > MAX_ATTRIBUTE_POINTS) {
    errors.push({
      code: "ATTRIBUTE_POINTS_EXCEEDED",
      message: `This attribute spread costs ${spentPoints} points; a level 20 character has at most ${MAX_ATTRIBUTE_POINTS} (170 base + 30 from quests). Lower some ranks.`,
    });
  }

  const primary = getProfession(template.primary);
  const secondary = getProfession(template.secondary);
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

  const seen = new Map<number, number>();
  for (const { slot, skill } of resolved) {
    const firstSlot = seen.get(skill.id);
    if (firstSlot !== undefined) {
      errors.push({
        code: "DUPLICATE_SKILL",
        message: `"${skill.name}" appears in slots ${firstSlot + 1} and ${slot + 1}`,
      });
    } else {
      seen.set(skill.id, slot);
    }
  }

  const elites = resolved.filter(({ skill }) => skill.elite);
  if (elites.length > 1) {
    errors.push({
      code: "MULTIPLE_ELITES",
      message: `At most one elite skill per bar, found ${elites.length}: ${elites
        .map((e) => e.skill.name)
        .join(", ")}`,
    });
  }

  for (const { slot, skill } of resolved) {
    // Profession constraint: skill must belong to primary, secondary, or none.
    if (
      skill.professionId !== 0 &&
      skill.professionId !== template.primary &&
      skill.professionId !== template.secondary
    ) {
      const prof = getProfession(skill.professionId);
      errors.push({
        code: "PROFESSION_MISMATCH",
        message: `Slot ${slot + 1}: "${skill.name}" is a ${prof?.name ?? "?"} skill, not available to ${primary?.abbr ?? "?"}/${secondary?.abbr ?? "?"}`,
      });
    }

    // Availability against a GWToolbox account export (/exportaccount).
    if (options.unlockedSkillIds !== undefined && !options.unlockedSkillIds.includes(skill.id)) {
      warnings.push({
        code: "SKILL_NOT_UNLOCKED",
        message: `Slot ${slot + 1}: "${skill.name}" is not in the provided unlocked skill list`,
      });
    }

    // PvE-only skills (title-track attributes) on hero bars.
    if (options.forHero && skill.attributeId >= 102) {
      warnings.push({
        code: "PVE_ONLY_ON_HERO",
        message: `Slot ${slot + 1}: "${skill.name}" is a PvE-only skill; heroes cannot equip it`,
      });
    }
  }

  // --- attributes -----------------------------------------------------------
  const seenAttributes = new Set<number>();
  for (const { attributeId, rank } of template.attributes) {
    const attribute = getAttribute(attributeId);
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

    if (attributeId > 44) {
      errors.push({
        code: "ATTRIBUTE_NOT_TEMPLATABLE",
        message: `"${attribute.name}" is a ${attributeId === 101 ? "non-attribute" : "PvE title track"}; title ranks come from account progress and cannot be allocated in a skill template`,
      });
      continue;
    }

    if (rank < 0 || rank > 12) {
      errors.push({
        code: "RANK_OUT_OF_RANGE",
        message: `"${attribute.name}" rank ${rank} out of range (base ranks are 0-12)`,
      });
    }

    if (attributeId <= 44) {
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
          message: `"${attribute.name}" is a primary attribute of ${getProfession(attribute.professionId)?.name ?? "?"} and requires it as primary profession`,
        });
      }
    }
  }

  // Skills whose attribute has no allocation: legal, but worth flagging.
  for (const { slot, skill } of resolved) {
    if (skill.attributeId <= 44 && !seenAttributes.has(skill.attributeId)) {
      const attribute = getAttribute(skill.attributeId);
      warnings.push({
        code: "UNALLOCATED_ATTRIBUTE",
        message: `Slot ${slot + 1}: "${skill.name}" scales with ${attribute?.name ?? "?"}, which has no points allocated`,
      });
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}
