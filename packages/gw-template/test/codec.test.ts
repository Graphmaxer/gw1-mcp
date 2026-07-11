import { describe, expect, it } from "vitest";
import { decodeTemplate, encodeTemplate, TemplateError } from "../src/index.js";
import fixtureFile from "./fixtures/templates.json";

describe("golden fixtures", () => {
  for (const fixture of fixtureFile.fixtures) {
    it(`decodes ${fixture.name}`, () => {
      expect(decodeTemplate(fixture.code)).toEqual(fixture.expect);
    });

    if (fixture.roundtrip) {
      it(`round-trips ${fixture.name} character-exact`, () => {
        expect(encodeTemplate(decodeTemplate(fixture.code))).toBe(fixture.code);
      });
    } else {
      it(`re-encodes ${fixture.name} to a semantically equal modern template`, () => {
        const decoded = decodeTemplate(fixture.code);
        expect(decodeTemplate(encodeTemplate(decoded))).toEqual(decoded);
      });
    }
  }
});

describe("encode/decode symmetry", () => {
  it("survives a build with an empty bar and no attributes", () => {
    const template = {
      primary: 10,
      secondary: 0,
      attributes: [],
      skills: [0, 0, 0, 0, 0, 0, 0, 0],
    };
    expect(decodeTemplate(encodeTemplate(template))).toEqual(template);
  });

  it("survives large skill ids (wider skill field)", () => {
    const template = {
      primary: 3,
      secondary: 5,
      attributes: [{ attributeId: 16, rank: 12 }],
      skills: [2, 3191, 1, 0, 0, 0, 0, 0],
    };
    expect(decodeTemplate(encodeTemplate(template))).toEqual(template);
  });
});

describe("errors", () => {
  it("rejects invalid characters", () => {
    expect(() => decodeTemplate("Ow!!invalid")).toThrowError(TemplateError);
  });

  it("rejects non-skill templates", () => {
    // First 6-bit char 'P' = 15 -> type 15, neither skill (14) nor legacy (0)
    expect(() => decodeTemplate("PkpkAqq99999")).toThrowError(TemplateError);
  });

  it("rejects truncated streams", () => {
    expect(() => decodeTemplate("Owpi")).toThrowError(TemplateError);
  });

  it("rejects bars without exactly 8 slots", () => {
    expect(() =>
      encodeTemplate({ primary: 1, secondary: 0, attributes: [], skills: [0] }),
    ).toThrowError(TemplateError);
  });
});
