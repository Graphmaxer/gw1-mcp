import { describe, expect, it } from "vitest";
import { getSkillByName } from "@gw1-mcp/gw-data";
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

describe("UNUSED_ATTRIBUTE never fires on a primary attribute", () => {
  // Regression: the first version of this warning flagged primary attributes,
  // so 4 of 5 canonical bars told the model to remove points from the best
  // investment on the bar. Primary effects are passive — no skill from the line
  // is needed for them to work.
  const canonical: [string, number, number, number, number][] = [
    ["Dervish Mysticism", 10, 3, 44, 12],
    ["Monk Divine Favor", 3, 5, 16, 10],
    ["Necromancer Soul Reaping", 4, 3, 6, 10],
    ["Elementalist Energy Storage", 6, 3, 12, 12],
    ["Ranger Expertise", 2, 3, 23, 12],
  ];
  for (const [label, primary, secondary, attributeId, rank] of canonical) {
    it(`stays silent on ${label}`, () => {
      const r = validateBuild(
        {
          primary,
          secondary,
          attributes: [{ attributeId, rank }],
          // Irresistible Sweep scales with Scythe Mastery, so the primary line
          // genuinely has no skill of its own on the bar.
          skills: [1489, 0, 0, 0, 0, 0, 0, 0],
        } as never,
        {} as never,
      );
      expect(r.warnings.map((w) => w.code)).not.toContain("UNUSED_ATTRIBUTE");
    });
  }

  it("still flags a non-primary line funded for nothing", () => {
    // The warning must keep working where it was actually useful.
    const r = validateBuild(
      {
        primary: 10,
        secondary: 3,
        attributes: [{ attributeId: 43, rank: 12 }], // Earth Prayers, unused
        skills: [1489, 0, 0, 0, 0, 0, 0, 0],
      } as never,
      {} as never,
    );
    expect(r.warnings.map((w) => w.code)).toContain("UNUSED_ATTRIBUTE");
  });
});

describe("PvP/PvE split skills — proven in game 2026-08-01", () => {
  // The decisive evidence: a PvP-only Mesmer equipped Fragility and Empathy, both
  // split skills, saved a skill template, and the code OQBDAowjCXoyJEhyEaIA decodes
  // to [23, 42, 39, 68, 40, 19, 26, 2]. Ids 19 and 26 are the PvE versions; the PvP
  // ids 2998 and 3151 are absent. The client normalises when it writes a template,
  // which is what lets a PvP build load in PvE and back.
  const REAL_PVP_TEMPLATE = {
    primary: 5,
    secondary: 0,
    attributes: [
      { attributeId: 0, rank: 8 },
      { attributeId: 2, rank: 12 },
      { attributeId: 3, rank: 10 },
    ],
    skills: [23, 42, 39, 68, 40, 19, 26, 2],
  };

  it("accepts a real PvP character's own template", () => {
    // Until 2026-08-01 this produced two PVE_VERSION_ON_PVP_BUILD errors, telling the
    // player to use ids the game had deliberately not written. That rule is gone.
    const report = validateBuild(REAL_PVP_TEMPLATE as never, { forPvp: true } as never);
    expect(report.valid).toBe(true);
    expect(report.errors).toEqual([]);
  });

  it("warns on a PvP-version id, which the game never writes", () => {
    const report = validateBuild(
      { ...REAL_PVP_TEMPLATE, skills: [2998, 0, 0, 0, 0, 0, 0, 0] } as never,
      {} as never,
    );
    expect(report.warnings.map((w) => w.code)).toContain("PVP_VERSION_IN_TEMPLATE");
    // A warning, not an error: the id names a real skill.
    expect(report.errors.map((e) => e.code)).not.toContain("PVP_VERSION_IN_TEMPLATE");
  });

  it("warns regardless of forPvp, since forPvp cannot legitimise it", () => {
    const report = validateBuild(
      { ...REAL_PVP_TEMPLATE, skills: [2998, 0, 0, 0, 0, 0, 0, 0] } as never,
      { forPvp: true } as never,
    );
    expect(report.warnings.map((w) => w.code)).toContain("PVP_VERSION_IN_TEMPLATE");
  });

  it("leaves unsplit skills alone", () => {
    const report = validateBuild(
      { ...REAL_PVP_TEMPLATE, skills: [23, 0, 0, 0, 0, 0, 0, 0] } as never,
      { forPvp: true } as never,
    );
    expect(report.warnings.map((w) => w.code)).not.toContain("PVP_VERSION_IN_TEMPLATE");
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

describe("PvE-only skills on a PvP bar", () => {
  // A PvP character cannot use PvE-only skills at all: they do not exist outside
  // roleplay areas and a PvP-created character cannot acquire them. This rule was
  // missing — forPvp only checked the PvE/PvP split VERSIONS of ordinary skills,
  // which is a different rule — and 54 PvE-only skills carry no profession, so they
  // passed every other check. Found by walking the game's rules against the
  // validator rather than reading its code.
  const asuranScan = getSkillByName("Asuran Scan");
  const rebirthSignet = getSkillByName("Sunspear Rebirth Signet");

  it("rejects a PvE-only skill when forPvp is set", () => {
    const report = validateBuild(
      { primary: 10, secondary: 0, attributes: [], skills: [asuranScan!.id, 0, 0, 0, 0, 0, 0, 0] },
      { forPvp: true },
    );
    expect(report.errors.map((e) => e.code)).toContain("PVE_ONLY_ON_PVP_BUILD");
  });

  it("allows the same skill on a roleplay bar", () => {
    const report = validateBuild(
      { primary: 10, secondary: 0, attributes: [], skills: [asuranScan!.id, 0, 0, 0, 0, 0, 0, 0] },
      {},
    );
    expect(report.errors.map((e) => e.code)).not.toContain("PVE_ONLY_ON_PVP_BUILD");
  });

  it("reports every offending slot, not only the first", () => {
    const report = validateBuild(
      {
        primary: 10,
        secondary: 0,
        attributes: [],
        skills: [asuranScan!.id, rebirthSignet!.id, 0, 0, 0, 0, 0, 0],
      },
      { forPvp: true },
    );
    const hits = report.errors.map((e) => e.code).filter((c) => c === "PVE_ONLY_ON_PVP_BUILD");
    expect(hits).toHaveLength(2);
  });
});

describe("Signet of Capture counts toward the PvE-only cap", () => {
  // Previously excluded from the cap, which was wrong. Verified against sources:
  // "Signet of Capture is a PvE-only skill. Therefore it cannot be equipped by
  // heroes and is subject to the limit of 3 PvE-only skills at a time"
  // (guildwars.fandom.com/wiki/Signet_of_Capture), and a player report on
  // wiki.guildwars.com/wiki/Talk:Signet_of_Capture describing a fourth being
  // kicked off the bar. The August 23 2007 update introduced the cap.
  const soc = getSkillByName("Signet of Capture")!.id;
  const pve = ["Asuran Scan", "Sunspear Rebirth Signet", "Sneak Attack"].map(
    (n) => getSkillByName(n)!.id,
  );
  const bar = (ids: number[]) => ({
    primary: 10,
    secondary: 0,
    attributes: [],
    skills: [...ids, ...Array(8 - ids.length).fill(0)],
  });

  it("rejects three PvE-only skills plus a Signet of Capture (four in total)", () => {
    const report = validateBuild(bar([...pve, soc]), {});
    expect(report.errors.map((e) => e.code)).toContain("TOO_MANY_PVE_SKILLS");
  });

  it("accepts two PvE-only skills plus a Signet of Capture (three in total)", () => {
    const report = validateBuild(bar([...pve.slice(0, 2), soc]), {});
    expect(report.errors.map((e) => e.code)).not.toContain("TOO_MANY_PVE_SKILLS");
  });

  it("accepts three copies of the signet, which the game allows", () => {
    // "You can equip up to three copies of this signet on your skill bar"
    // — wiki.guildwars.com/wiki/Signet_of_Capture
    const report = validateBuild(bar([soc, soc, soc]), {});
    expect(report.errors.map((e) => e.code)).not.toContain("TOO_MANY_PVE_SKILLS");
  });
});
