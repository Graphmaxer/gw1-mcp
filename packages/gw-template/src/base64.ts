import { TemplateError } from "./types.js";

/**
 * GW1 templates use the standard RFC 3548 base64 alphabet (with + and /),
 * but the 6-bit groups are interpreted lowest-bit-first (see
 * https://wiki.guildwars.com/wiki/Skill_template_format).
 */
const CHARSET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

const CHAR_TO_VALUE = new Map<string, number>([...CHARSET].map((c, i) => [c, i] as const));

/** Convert a template string into an array of 6-bit values. */
export function charsToValues(template: string): number[] {
  const trimmed = template.trim();
  if (trimmed.length === 0) {
    throw new TemplateError("TRUNCATED", "Empty template string");
  }
  return [...trimmed].map((c) => {
    const v = CHAR_TO_VALUE.get(c);
    if (v === undefined) {
      throw new TemplateError(
        "INVALID_CHARACTER",
        `Invalid base64 character: ${JSON.stringify(c)}`,
      );
    }
    return v;
  });
}

/** Convert an array of 6-bit values back into a template string. */
export function valuesToChars(values: number[]): string {
  return values
    .map((v) => {
      const c = CHARSET[v];
      if (c === undefined) {
        throw new TemplateError("VALUE_OUT_OF_RANGE", `6-bit value out of range: ${v}`);
      }
      return c;
    })
    .join("");
}
