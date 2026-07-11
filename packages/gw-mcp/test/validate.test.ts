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
