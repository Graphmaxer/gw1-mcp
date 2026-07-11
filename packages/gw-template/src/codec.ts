import { charsToValues, valuesToChars } from "./base64.js";
import { BitReader, BitWriter, bitLength } from "./bitstream.js";
import { TemplateError, type SkillTemplate } from "./types.js";

/**
 * Skill template codec, implementing the format documented at
 * https://wiki.guildwars.com/wiki/Skill_template_format
 *
 * Layout (all numbers lowest-bit-first):
 *   header:      4 bits template type (14) + 4 bits version (0)
 *                (pre-2007 templates: only 4 bits version (0))
 *   professions: 2 bits code (bits per profession id = code * 2 + 4),
 *                primary, secondary
 *   attributes:  4 bits count, 4 bits code (bits per attribute id = code + 4),
 *                then per attribute: id, 4 bits rank
 *   skills:      4 bits code (bits per skill id = code + 8), then 8 skill ids
 *   tail:        1 zero bit, then zero padding to a 6-bit boundary
 */

const TEMPLATE_TYPE_SKILL = 14;

export function decodeTemplate(code: string): SkillTemplate {
  const reader = new BitReader(charsToValues(code));

  // Header: modern templates start with type 14; legacy (pre April 2007)
  // templates start directly with a 4-bit version of 0.
  const first = reader.read(4);
  if (first === TEMPLATE_TYPE_SKILL) {
    const version = reader.read(4);
    if (version !== 0) {
      throw new TemplateError("INVALID_HEADER", `Unsupported skill template version: ${version}`);
    }
  } else if (first !== 0) {
    throw new TemplateError(
      "INVALID_HEADER",
      `Not a skill template (type ${first}, expected ${TEMPLATE_TYPE_SKILL})`,
    );
  }

  const professionBits = reader.read(2) * 2 + 4;
  const primary = reader.read(professionBits);
  const secondary = reader.read(professionBits);

  const attributeCount = reader.read(4);
  const attributeBits = reader.read(4) + 4;
  const attributes: SkillTemplate["attributes"] = [];
  for (let i = 0; i < attributeCount; i++) {
    const attributeId = reader.read(attributeBits);
    const rank = reader.read(4);
    attributes.push({ attributeId, rank });
  }

  const skillBits = reader.read(4) + 8;
  const skills: number[] = [];
  for (let i = 0; i < 8; i++) {
    skills.push(reader.read(skillBits));
  }

  return { primary, secondary, attributes, skills };
}

export function encodeTemplate(template: SkillTemplate): string {
  if (template.skills.length !== 8) {
    throw new TemplateError(
      "INVALID_SKILL_COUNT",
      `A skill template has exactly 8 skill slots, got ${template.skills.length}`,
    );
  }

  // The in-game encoder uses the smallest bit widths that fit the content;
  // matching that choice is what makes encode(decode(code)) === code.
  const maxProfession = Math.max(template.primary, template.secondary);
  const professionCode = Math.max(0, Math.ceil((bitLength(maxProfession) - 4) / 2));
  const professionBits = professionCode * 2 + 4;

  const maxAttribute = template.attributes.reduce((m, a) => Math.max(m, a.attributeId), 0);
  const attributeBits = Math.max(4, bitLength(maxAttribute));
  const attributeCode = attributeBits - 4;

  const maxSkill = template.skills.reduce((m, s) => Math.max(m, s), 0);
  const skillBits = Math.max(8, bitLength(maxSkill));
  const skillCode = skillBits - 8;

  const writer = new BitWriter();
  writer.write(TEMPLATE_TYPE_SKILL, 4);
  writer.write(0, 4); // version
  writer.write(professionCode, 2);
  writer.write(template.primary, professionBits);
  writer.write(template.secondary, professionBits);
  writer.write(template.attributes.length, 4);
  writer.write(attributeCode, 4);
  // Canonical form: attributes sorted by ascending id. All known in-game and
  // third-party codes use this order (attribute order is semantically
  // meaningless), and it makes encoding deterministic for equal builds.
  const sortedAttributes = [...template.attributes].sort((a, b) => a.attributeId - b.attributeId);
  for (const { attributeId, rank } of sortedAttributes) {
    writer.write(attributeId, attributeBits);
    writer.write(rank, 4);
  }
  writer.write(skillCode, 4);
  for (const skill of template.skills) {
    writer.write(skill, skillBits);
  }
  writer.write(0, 1); // tail

  return valuesToChars(writer.toValues());
}
