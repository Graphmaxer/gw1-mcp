import { describe, expect, it } from "vitest";
import { validateBuild } from "../src/validate.js";

describe("attribute point budget", () => {
  it("rejects spreads costing more than 200 points", () => {
    const report = validateBuild(
      {
        primary: 10,
        secondary: 0,
        attributes: [
          { attributeId: 41, rank: 12 }, // Scythe (97)
          { attributeId: 44, rank: 12 }, // Mysticism (97)
          { attributeId: 43, rank: 8 }, // Earth Prayers (37) -> 231 > 200
        ],
        skills: [1518, 0, 0, 0, 0, 0, 0, 0],
      },
      {},
    );
    expect(report.valid).toBe(false);
    expect(report.errors.map((e) => e.code)).toContain("ATTRIBUTE_POINTS_EXCEEDED");
  });

  it("accepts a standard 11/10/8 spread (175 points)", () => {
    const report = validateBuild(
      {
        primary: 10,
        secondary: 0,
        attributes: [
          { attributeId: 41, rank: 11 },
          { attributeId: 44, rank: 10 },
          { attributeId: 43, rank: 8 },
        ],
        skills: [1518, 0, 0, 0, 0, 0, 0, 0],
      },
      {},
    );
    expect(report.errors.map((e) => e.code)).not.toContain("ATTRIBUTE_POINTS_EXCEEDED");
  });
});

// Table-driven coverage of every remaining validator rule. Base bar: Dervish
// primary (10), Avatar of Balthazar (1518, elite, Mysticism).
const base = { primary: 10, secondary: 0, skills: [1518, 0, 0, 0, 0, 0, 0, 0] };
const cases: Array<{
  rule: string;
  kind: "errors" | "warnings";
  template: object;
  options?: object;
}> = [
  {
    rule: "UNKNOWN_ATTRIBUTE",
    kind: "errors",
    template: { ...base, attributes: [{ attributeId: 99, rank: 5 }] },
  },
  {
    rule: "DUPLICATE_ATTRIBUTE",
    kind: "errors",
    template: {
      ...base,
      attributes: [
        { attributeId: 44, rank: 5 },
        { attributeId: 44, rank: 6 },
      ],
    },
  },
  {
    rule: "RANK_OUT_OF_RANGE",
    kind: "errors",
    template: { ...base, attributes: [{ attributeId: 44, rank: 13 }] },
  },
  {
    rule: "ATTRIBUTE_PROFESSION_MISMATCH",
    kind: "errors",
    // Strength (17, Warrior) on a D/any bar.
    template: { ...base, attributes: [{ attributeId: 17, rank: 5 }] },
  },
  {
    rule: "PRIMARY_ATTRIBUTE_ON_SECONDARY",
    kind: "errors",
    // D/W bar allocating Strength (17, Warrior's primary attribute).
    template: { ...base, secondary: 1, attributes: [{ attributeId: 17, rank: 5 }] },
  },
  {
    rule: "PVE_ONLY_ON_HERO",
    kind: "warnings",
    // Asuran Scan (2415, Asura title track) on a hero bar.
    template: { ...base, attributes: [], skills: [1518, 2415, 0, 0, 0, 0, 0, 0] },
    options: { forHero: true },
  },
  {
    rule: "UNALLOCATED_ATTRIBUTE",
    kind: "warnings",
    // Staggering Force (1519? use Wearying Strike scythe) — Twin Moon Sweep 1489 scales with Scythe (41), unallocated.
    template: {
      ...base,
      attributes: [{ attributeId: 44, rank: 12 }],
      skills: [1518, 1489, 0, 0, 0, 0, 0, 0],
    },
  },
];
describe("validator rule table", () => {
  for (const c of cases) {
    it(`raises ${c.rule}`, () => {
      const report = validateBuild(c.template as never, (c.options ?? {}) as never);
      expect(report[c.kind].map((i) => i.code)).toContain(c.rule);
    });
  }
});

describe("structural validator rules", () => {
  it("raises SAME_PROFESSIONS", () => {
    const r = validateBuild(
      { primary: 10, secondary: 10, attributes: [], skills: [1518, 0, 0, 0, 0, 0, 0, 0] },
      {},
    );
    expect(r.errors.map((e) => e.code)).toContain("SAME_PROFESSIONS");
  });
  it("raises INVALID_SKILL_COUNT", () => {
    const r = validateBuild(
      { primary: 10, secondary: 0, attributes: [], skills: [1518, 0, 0] },
      {},
    );
    expect(r.errors.map((e) => e.code)).toContain("INVALID_SKILL_COUNT");
  });
  it("raises UNKNOWN_SKILL", () => {
    const r = validateBuild(
      { primary: 10, secondary: 0, attributes: [], skills: [64321, 0, 0, 0, 0, 0, 0, 0] },
      {},
    );
    expect(r.errors.map((e) => e.code)).toContain("UNKNOWN_SKILL");
  });
  it("raises DUPLICATE_SKILL", () => {
    const r = validateBuild(
      { primary: 10, secondary: 0, attributes: [], skills: [1518, 1489, 1489, 0, 0, 0, 0, 0] },
      {},
    );
    expect(r.errors.map((e) => e.code)).toContain("DUPLICATE_SKILL");
  });
});

describe("profession header rules", () => {
  it("raises UNKNOWN_PRIMARY and UNKNOWN_SECONDARY", () => {
    const r = validateBuild(
      { primary: 77, secondary: 88, attributes: [], skills: [0, 0, 0, 0, 0, 0, 0, 0] },
      {},
    );
    const codes = r.errors.map((e) => e.code);
    expect(codes).toContain("UNKNOWN_PRIMARY");
    expect(codes).toContain("UNKNOWN_SECONDARY");
  });
  it("raises NO_PRIMARY on profession-less templates", () => {
    const r = validateBuild(
      { primary: 0, secondary: 0, attributes: [], skills: [0, 0, 0, 0, 0, 0, 0, 0] },
      {},
    );
    expect(r.errors.map((e) => e.code)).toContain("NO_PRIMARY");
  });
});
