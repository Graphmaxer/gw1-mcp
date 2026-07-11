import { describe, expect, it } from "vitest";
import { resolveNamedBuild } from "../src/build-io.js";

const base = { attributes: [], skills: ["Avatar of Balthazar"] };

describe("named build resolution errors", () => {
  it("rejects unknown primary professions", () => {
    const { template, errors } = resolveNamedBuild({ ...base, primary: "Bard" });
    expect(template).toBeNull();
    expect(errors.map((e) => e.code)).toContain("UNKNOWN_PROFESSION");
  });
  it("rejects unknown secondary professions", () => {
    const { template, errors } = resolveNamedBuild({
      ...base,
      primary: "Dervish",
      secondary: "Druid",
    });
    expect(template).toBeNull();
    expect(errors.map((e) => e.code)).toContain("UNKNOWN_PROFESSION");
  });
  it("rejects unknown attributes with the misspelling echoed", () => {
    const { errors } = resolveNamedBuild({
      primary: "Dervish",
      attributes: [{ attribute: "Sythe Mastry", rank: 12 }],
      skills: [],
    });
    expect(errors.map((e) => e.code)).toContain("UNKNOWN_ATTRIBUTE");
    expect(errors.find((e) => e.code === "UNKNOWN_ATTRIBUTE")?.message).toContain("Sythe Mastry");
  });
  it("rejects unknown skill names", () => {
    const { errors } = resolveNamedBuild({
      primary: "Dervish",
      attributes: [],
      skills: ["Totally Made Up Strike"],
    });
    expect(errors.map((e) => e.code)).toContain("UNKNOWN_SKILL");
  });
  it("accepts 'None' and empty string as no-secondary", () => {
    for (const secondary of ["None", "", undefined]) {
      const { template, errors } = resolveNamedBuild({ ...base, primary: "Dervish", secondary });
      expect(errors).toHaveLength(0);
      expect(template?.secondary).toBe(0);
    }
  });
});
