import { describe, expect, it } from "vitest";
import { SkillTemplate } from "@buildwars/gw-templates";
import { decodeTemplate, encodeTemplate } from "../src/index.js";
import fixtureFile from "./fixtures/templates.json";

/**
 * Differential tests: our zero-dependency codec vs @buildwars/gw-templates,
 * an independently written implementation battle-tested in production
 * (gw1builds.com). Divergence on any input = a bug in one of the two.
 */
const theirs = new SkillTemplate();

function toOurShape(decoded: ReturnType<SkillTemplate["decode"]>) {
  return {
    primary: decoded.prof_pri,
    secondary: decoded.prof_sec,
    // their attributes come back as an object (insertion-ordered int keys)
    attributes: Object.entries(decoded.attributes).map(([id, rank]) => ({
      attributeId: Number(id),
      rank,
    })),
    skills: decoded.skills,
  };
}

const sortAttributes = <T extends { attributes: Array<{ attributeId: number }> }>(t: T): T => ({
  ...t,
  attributes: [...t.attributes].sort((a, b) => a.attributeId - b.attributeId),
});

describe("differential: fixtures", () => {
  for (const fixture of fixtureFile.fixtures) {
    it(`both codecs agree on ${fixture.name}`, () => {
      // Order-insensitive on attributes: their decode returns an object whose
      // integer keys iterate ascending regardless of the code's actual order.
      expect(sortAttributes(decodeTemplate(fixture.code))).toEqual(
        sortAttributes(toOurShape(theirs.decode(fixture.code))),
      );
    });
  }
});

// Immutable game data: attribute ids per profession (primary attribute first).
// Used to generate fully LEGAL builds: @buildwars/gw-templates bakes gameplay
// validation into encode() and silently drops attributes that don't belong to
// the build's professions (and normalizes secondary === primary to 0), while
// our codec encodes faithfully and leaves legality to the validator layer.
// The differential comparison is only meaningful on legal inputs.
const PROFESSION_ATTRIBUTES: Record<number, number[]> = {
  1: [17, 18, 19, 20, 21], // Warrior (Strength primary)
  2: [23, 22, 24, 25], // Ranger (Expertise primary)
  3: [16, 13, 14, 15], // Monk (Divine Favor primary)
  4: [6, 4, 5, 7], // Necromancer (Soul Reaping primary)
  5: [0, 1, 2, 3], // Mesmer (Fast Casting primary)
  6: [12, 8, 9, 10, 11], // Elementalist (Energy Storage primary)
  7: [35, 29, 30, 31], // Assassin (Critical Strikes primary)
  8: [36, 32, 33, 34], // Ritualist (Spawning Power primary)
  9: [40, 37, 38, 39], // Paragon (Leadership primary)
  10: [44, 41, 42, 43], // Dervish (Mysticism primary)
};

describe("upstream bug sentinel", () => {
  it("documents an upstream encode bug: lone high skill ids are truncated", () => {
    // https://github.com/build-wars/gw-templates — getPadSize() increments the
    // bit width at most once per element, so [188, 3142, ...] yields an
    // 11-bit skill field although 3142 needs 12 bits: the id is written
    // truncated (3142 - 2048 = 1094) and the whole bar decodes corrupted.
    // Affects any build whose only high id is an EotN/Reforged skill
    // (Cure Hex 2112, Ebon Vanguard Assassin Support 2235, Vow of
    // Revolution 3430, ...). If this test ever FAILS, upstream fixed the
    // bug: tighten the fuzz comparison above and drop this sentinel.
    const skills = [188, 3142, 243, 0, 949, 1321, 882, 443];
    const code = theirs.encode(3, 2, { 16: 11 }, skills);
    expect(theirs.decode(code).skills).not.toEqual(skills); // corrupted
    expect(theirs.decode(code).skills[1]).toBe(3142 - 2048); // truncated bit

    // Ours encodes it correctly, and their decoder agrees with ours:
    const ourCode = encodeTemplate({
      primary: 3,
      secondary: 2,
      attributes: [{ attributeId: 16, rank: 11 }],
      skills,
    });
    expect(decodeTemplate(ourCode).skills).toEqual(skills);
    expect(theirs.decode(ourCode).skills).toEqual(skills);
  });
});

describe("differential: fuzz", () => {
  it("agrees with @buildwars/gw-templates on 500 random legal builds", () => {
    // mulberry32: overflow-safe seeded PRNG (naive LCG in JS loses float
    // precision above 2^53 and can get stuck on a fixed point).
    let seed = 1337 >>> 0;
    const rand = (n: number): number => {
      seed = (seed + 0x6d2b79f5) >>> 0;
      let t = seed;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) % n;
    };

    for (let i = 0; i < 500; i++) {
      const primary = 1 + rand(10);
      let secondary = rand(11);
      if (secondary === primary) secondary = 0;

      // Allowed attributes: all of primary's, secondary's minus its primary attribute.
      const pool = [
        ...PROFESSION_ATTRIBUTES[primary]!,
        ...(secondary === 0 ? [] : PROFESSION_ATTRIBUTES[secondary]!.slice(1)),
      ];
      const count = rand(pool.length + 1);
      const attributeIds = new Set<number>();
      while (attributeIds.size < count) attributeIds.add(pool[rand(pool.length)]!);

      const template = {
        primary,
        secondary,
        attributes: [...attributeIds].map((attributeId) => ({ attributeId, rank: rand(13) })),
        skills: Array.from({ length: 8 }, () => rand(3432)),
      };

      const ourCode = encodeTemplate(template);
      const theirCode = theirs.encode(
        primary,
        secondary,
        Object.fromEntries(template.attributes.map((a) => [a.attributeId, a.rank])),
        template.skills,
      );
      // Known cosmetic differences, both settled in our favor by the golden
      // fixtures (game-generated codes reproduce OUR output exactly):
      // 1. The lib pads the bitstream to a multiple of 24 bits (a PHP
      //    base64_decode compatibility quirk, commented as a "nasty fix"
      //    upstream); the game pads to 6 (fixture "Critical Scythe" is 25
      //    chars = 150 bits, not a multiple of 24). Trailing 'A' chars are
      //    six zero bits and are ignored by every decoder.
      // 2. With zero attributes, the unused attribute bit-length field gets
      //    a different filler value.
      // Upstream encode bug (see "documents an upstream encode bug" below):
      // getPadSize only increments once per element, so a lone skill id
      // >= 2^(10+k) among smaller ids gets truncated. Skip strict comparison
      // when their simulated pad is insufficient — their code is corrupt.
      let theirSkillPad = 10;
      for (const id of template.skills) {
        if (id >= 2 ** theirSkillPad) theirSkillPad++;
      }
      const theirCodeIsCorrupt = 2 ** theirSkillPad <= Math.max(...template.skills);

      // The lib deviates from the wiki spec with conservative width floors:
      // attribute ids are never written on fewer than 5 bits and skill ids
      // never on fewer than 10 (getPadSize minimums), while the spec and the
      // game use true minimal widths (the legacy wiki fixture, generated by
      // the game, encodes its skills on 9 bits). Trailing 'A' chars are
      // zero-bit padding, ignored by every decoder.
      // => strict string equality only where the floors cannot differ;
      //    semantic equality (cross-decode) always.
      const maxAttribute = template.attributes.reduce((m, a) => Math.max(m, a.attributeId), 0);
      const maxSkill = Math.max(...template.skills);
      const floorsAgree = template.attributes.length > 0 && maxAttribute >= 16 && maxSkill >= 512;
      if (floorsAgree && !theirCodeIsCorrupt) {
        expect(ourCode.replace(/A+$/u, "")).toBe(theirCode.replace(/A+$/u, ""));
        expect(decodeTemplate(theirCode)).toEqual(decodeTemplate(ourCode));
      }
      // Their decoder on OUR code must always reproduce the input — this is
      // the strongest cross-validation and holds on every legal build.
      expect(toOurShape(theirs.decode(ourCode))).toEqual({
        ...template,
        attributes: [...template.attributes].sort((a, b) => a.attributeId - b.attributeId),
      });
    }
  });
});
