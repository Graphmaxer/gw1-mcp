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

  it("does not charge title-track ranks to the 200-point budget", () => {
    // A PvE title track at rank 9 used to add 48 phantom points, making the
    // budget message state a total the build never spent. It is not templatable
    // at all — ATTRIBUTE_NOT_TEMPLATABLE is the honest report.
    const report = validateBuild(
      {
        primary: 10,
        secondary: 0,
        attributes: [
          { attributeId: 41, rank: 12 }, // Scythe (97)
          { attributeId: 44, rank: 12 }, // Mysticism (97) -> 194, within budget
          { attributeId: 102, rank: 9 }, // Sunspear title track: 48 phantom points
        ],
        skills: [1518, 0, 0, 0, 0, 0, 0, 0],
      },
      {},
    );
    expect(report.errors.map((e) => e.code)).not.toContain("ATTRIBUTE_POINTS_EXCEEDED");
    expect(report.errors.map((e) => e.code)).toContain("ATTRIBUTE_NOT_TEMPLATABLE");
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

  it("reports a decoded rank 13-15 once (RANK_OUT_OF_RANGE), never as an Infinity budget", () => {
    const report = validateBuild(
      {
        primary: 10,
        secondary: 0,
        attributes: [{ attributeId: 44, rank: 13 }],
        skills: [1518, 0, 0, 0, 0, 0, 0, 0],
      },
      {},
    );
    expect(report.valid).toBe(false);
    const codes = report.errors.map((e) => e.code);
    expect(codes).toContain("RANK_OUT_OF_RANGE");
    // single flag for a single cause: the budget error must stay silent
    expect(codes).not.toContain("ATTRIBUTE_POINTS_EXCEEDED");
    expect(report.errors.map((e) => e.message).join(" ")).not.toContain("Infinity");
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
    kind: "errors",
    // Asuran Scan (2415, Asura title track) on a hero bar — heroes cannot equip
    // PvE-only skills, so this is now a hard error (GW1-AUD-03 POC3).
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
  {
    rule: "UNUSED_ATTRIBUTE",
    kind: "warnings",
    // Mysticism funded at 12 (77 points) while the only skill on the bar,
    // Mystic Regeneration (1518), scales with Earth Prayers — the mirror of
    // UNALLOCATED_ATTRIBUTE, and the most common way a generated build burns
    // its budget.
    template: {
      ...base,
      attributes: [
        { attributeId: 43, rank: 12 },
        { attributeId: 44, rank: 12 },
      ],
      skills: [1518, 0, 0, 0, 0, 0, 0, 0],
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

describe("PvP/PvE split skills (audit I1)", () => {
  // Mind Wrack (PvP) id 2734 is the PvP version of a split skill; Fragility
  // id 19 is a Mesmer PvE skill that HAS a PvP version (id 2998).
  const mesmer = { primary: 5, secondary: 0, attributes: [] };

  it("raises PVP_VERSION_ON_PVE_BUILD", () => {
    // Previously: valid=true, no remark, and an encodable code that does not
    // produce the shown bar on a PvE character.
    const r = validateBuild(
      { ...mesmer, skills: [2734, 0, 0, 0, 0, 0, 0, 0] } as never,
      {} as never,
    );
    expect(r.errors.map((e) => e.code)).toContain("PVP_VERSION_ON_PVE_BUILD");
  });

  it("accepts the PvP version once the caller says it is a PvP bar", () => {
    const r = validateBuild(
      { ...mesmer, skills: [2734, 0, 0, 0, 0, 0, 0, 0] } as never,
      { forPvp: true } as never,
    );
    expect(r.errors.map((e) => e.code)).not.toContain("PVP_VERSION_ON_PVE_BUILD");
  });

  it("raises PVE_VERSION_ON_PVP_BUILD", () => {
    const r = validateBuild(
      { ...mesmer, skills: [19, 0, 0, 0, 0, 0, 0, 0] } as never,
      { forPvp: true } as never,
    );
    expect(r.errors.map((e) => e.code)).toContain("PVE_VERSION_ON_PVP_BUILD");
  });

  it("leaves unsplit skills alone on a PvP bar", () => {
    // Symmetry must not overreach: a skill with no PvP version is the same
    // skill in both formats.
    const r = validateBuild(
      { primary: 10, secondary: 0, attributes: [], skills: [1518, 0, 0, 0, 0, 0, 0, 0] } as never,
      { forPvp: true } as never,
    );
    expect(r.errors.map((e) => e.code)).not.toContain("PVE_VERSION_ON_PVP_BUILD");
  });
});

describe("Signet of Capture on a hero bar", () => {
  it("reports PVE_ONLY_ON_HERO once, listing every slot", () => {
    // Three copies used to emit the same code three times, reading as three
    // separate problems; DUPLICATE_SKILL already reports once by convention.
    const report = validateBuild(
      {
        primary: 10,
        secondary: 0,
        attributes: [],
        skills: [3, 3, 3, 1518, 0, 0, 0, 0],
      },
      { forHero: true },
    );
    const captureErrors = report.errors.filter((e) => e.code === "PVE_ONLY_ON_HERO");
    expect(captureErrors).toHaveLength(1);
    expect(captureErrors[0]?.message).toContain("1, 2, 3");
  });
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

  it("allows Signet of Capture up to 3 times (the documented exception)", () => {
    // id 3 = Signet of Capture; three copies is legal in-game.
    const r = validateBuild(
      { primary: 10, secondary: 0, attributes: [], skills: [3, 3, 3, 1518, 0, 0, 0, 0] },
      {},
    );
    expect(r.errors.map((e) => e.code)).not.toContain("DUPLICATE_SKILL");
  });

  it("rejects a 4th Signet of Capture", () => {
    const r = validateBuild(
      { primary: 10, secondary: 0, attributes: [], skills: [3, 3, 3, 3, 0, 0, 0, 0] },
      {},
    );
    expect(r.errors.map((e) => e.code)).toContain("DUPLICATE_SKILL");
  });

  it("forbids Signet of Capture on a hero bar", () => {
    const r = validateBuild(
      { primary: 10, secondary: 0, attributes: [], skills: [3, 1518, 0, 0, 0, 0, 0, 0] },
      { forHero: true },
    );
    expect(r.errors.map((e) => e.code)).toContain("PVE_ONLY_ON_HERO");
  });

  it("raises TOO_MANY_PVE_SKILLS when a player bar holds more than 3", () => {
    // Four PvE-only skills (prof-agnostic): Lightbringer's Gaze 1814,
    // Lightbringer Signet 1815, Sunspear Rebirth Signet 1816, Asuran Scan 2415.
    const r = validateBuild(
      { primary: 10, secondary: 0, attributes: [], skills: [1814, 1815, 1816, 2415, 0, 0, 0, 0] },
      {},
    );
    expect(r.errors.map((e) => e.code)).toContain("TOO_MANY_PVE_SKILLS");
  });

  it("allows exactly 3 PvE-only skills on a player bar", () => {
    const r = validateBuild(
      { primary: 10, secondary: 0, attributes: [], skills: [1814, 1815, 1816, 1518, 0, 0, 0, 0] },
      {},
    );
    expect(r.errors.map((e) => e.code)).not.toContain("TOO_MANY_PVE_SKILLS");
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
