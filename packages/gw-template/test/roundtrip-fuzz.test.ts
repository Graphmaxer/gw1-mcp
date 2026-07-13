import { describe, expect, it } from "vitest";
import { decodeTemplate, encodeTemplate, type SkillTemplate } from "../src/index.js";
import { mulberry32 } from "./prng.js";

/**
 * Pure round-trip fuzz: decode(encode(x)) must equal canonical(x) for
 * ARBITRARY builds — deliberately unconstrained, unlike the differential
 * fuzz (which must stay legal because the upstream codec normalizes illegal
 * inputs). This is where bit-width-selection bugs would hide, so the
 * generator crosses every width class on purpose:
 *   - professions 0-1023 (width codes 0-3), including secondary === primary
 *   - 0-15 attributes (the count field is 4 bits), ids 0-1023, DUPLICATE ids
 *     allowed (canonical sort is stable, so order among equals is preserved)
 *   - ranks 0-15, including 13-15 (encodable, impossible in-game — legality
 *     is the validator layer's job, not the codec's)
 *   - skill ids 0-65535 (width codes 0-15)
 * Canonical form: the encoder sorts attributes by ascending id, so the
 * expectation applies the same stable sort to the input before comparing.
 */
describe("round-trip fuzz", () => {
  it("decode(encode(x)) === canonical(x) for 2000 random unconstrained builds", () => {
    const rand = mulberry32(1337);

    for (let i = 0; i < 2000; i++) {
      const attributeCount = rand(16);
      const build: SkillTemplate = {
        primary: rand(1024),
        secondary: rand(1024),
        attributes: Array.from({ length: attributeCount }, () => ({
          attributeId: rand(1024),
          rank: rand(16),
        })),
        skills: Array.from({ length: 8 }, () => rand(65536)),
      };
      const canonical: SkillTemplate = {
        ...build,
        attributes: [...build.attributes].sort((a, b) => a.attributeId - b.attributeId),
      };
      expect(decodeTemplate(encodeTemplate(build)), `build #${i}`).toEqual(canonical);
    }
  });
});
