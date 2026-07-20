/** A decoded Guild Wars 1 skill template. */
export interface SkillTemplate {
  /** Profession id of the primary profession (0 = None, 1 = Warrior ... 10 = Dervish). */
  primary: number;
  /** Profession id of the secondary profession (0 = None). */
  secondary: number;
  /** Attribute allocations, in template order. Ranks are base ranks (0-12, before runes). */
  attributes: Array<{ attributeId: number; rank: number }>;
  /** Exactly 8 skill ids; 0 = empty slot. */
  skills: number[];
}

export class TemplateError extends Error {
  constructor(
    public readonly code:
      | "INVALID_CHARACTER"
      | "INVALID_HEADER"
      | "TRUNCATED"
      | "NON_ZERO_TAIL"
      | "INVALID_SKILL_COUNT"
      | "VALUE_OUT_OF_RANGE",
    message: string,
  ) {
    super(message);
    this.name = "TemplateError";
  }
}
