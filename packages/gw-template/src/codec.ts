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
 *
 * TWO EMISSION DIALECTS exist in the wild (settled 2026-07-16 with codes
 * copied from a live client): web tools (wiki, PvXwiki, gw1builds) emit the
 * minimal form above; the GAME CLIENT pads with zero chars to an EVEN number
 * of characters (9/9 live samples: odd-minimal codes gain one 'A', even-
 * minimal codes are emitted byte-identical to our minimal form — including
 * the degenerate empty bar, which also settles the zero-attribute filler:
 * the client writes it exactly as we do). Both directions are field-proven interoperable:
 * the game loads our minimal codes, and decodeTemplate tolerates arbitrary
 * trailing zero chars (golden-locked). encodeTemplate deliberately emits the
 * minimal web-canonical form — we will not imitate a client rule we cannot
 * pin down from two same-length samples.
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

  // Everything after the payload must be zero (terminal bit + padding, plus
  // the client's pad-to-even zero char). Non-zero trailing bits are malformed,
  // not a padding dialect — see the codec dialect note above. (GW1-02)
  reader.assertZeroTail();

  return { primary, secondary, attributes, skills };
}

export function encodeTemplate(template: SkillTemplate): string {
  if (template.skills.length !== 8) {
    throw new TemplateError(
      "INVALID_SKILL_COUNT",
      `A skill template has exactly 8 skill slots, got ${template.skills.length}`,
    );
  }

  // Reject non-integers instead of silently truncating them: `1.5 >> 0` is 1, so
  // a fractional skill id used to encode as a different, valid skill. Legality
  // (unknown ids, duplicate attributes) stays the validator's job — this only
  // guarantees the input is the kind of number the bit writer can represent.
  //
  // Each field also carries its structural CEILING, derived from the width code
  // that describes it in the bitstream: the skill and attribute width codes are
  // 4 bits each, so widths top out at 8+15 and 4+15 bits respectively, and rank
  // and the attribute count are 4-bit fields. Without these the error was the
  // bit writer's own "Value 16 does not fit in 4 bits" — a controlled failure
  // with the right code but a diagnostic naming an internal field instead of the
  // caller's mistake, which is exactly what the profession guard below was added
  // to avoid (audit L10). Widths, layout and ordering are untouched.
  const MAX_SKILL_ID = (1 << (8 + 15)) - 1;
  const MAX_ATTRIBUTE_ID = (1 << (4 + 15)) - 1;
  const MAX_FOUR_BIT = 15;
  for (const [label, values, max] of [
    ["skill id", template.skills, MAX_SKILL_ID],
    // No ceiling here: the profession width is chosen from a 2-bit code, so it
    // gets its own dedicated check below with a message about the 10-bit limit.
    ["profession id", [template.primary, template.secondary], Number.MAX_SAFE_INTEGER],
    ["attribute id", template.attributes.map((a) => a.attributeId), MAX_ATTRIBUTE_ID],
    ["attribute rank", template.attributes.map((a) => a.rank), MAX_FOUR_BIT],
    ["attribute count", [template.attributes.length], MAX_FOUR_BIT],
  ] as const) {
    for (const value of values) {
      if (!Number.isInteger(value) || value < 0) {
        throw new TemplateError(
          "VALUE_OUT_OF_RANGE",
          `Invalid ${label} ${value}: expected a non-negative integer`,
        );
      }
      if (value > max) {
        throw new TemplateError(
          "VALUE_OUT_OF_RANGE",
          `Invalid ${label} ${value}: a skill template can encode at most ${max}`,
        );
      }
    }
  }

  // The in-game encoder uses the smallest bit widths that fit the content;
  // matching that choice is what makes encode(decode(code)) === code.
  const maxProfession = Math.max(template.primary, template.secondary);
  const professionCode = Math.max(0, Math.ceil((bitLength(maxProfession) - 4) / 2));
  const professionBits = professionCode * 2 + 4;
  // professionCode occupies 2 bits, so the format tops out at 10-bit profession
  // ids. Without this the failure surfaced as "Value 4 does not fit in 2 bits",
  // which names an internal field rather than the caller's actual mistake.
  if (professionCode > 3) {
    throw new TemplateError(
      "VALUE_OUT_OF_RANGE",
      `Profession id ${maxProfession} exceeds what a skill template can encode (max 10 bits)`,
    );
  }

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
