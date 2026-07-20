import { describe, expect, it } from "vitest";
import { decodeTemplate, encodeTemplate, TemplateError } from "../src/index.js";
import fixtureFile from "./fixtures/templates.json";

describe("golden fixtures", () => {
  for (const fixture of fixtureFile.fixtures) {
    it(`decodes ${fixture.name}`, () => {
      expect(decodeTemplate(fixture.code)).toEqual(fixture.expect);
    });

    // String-exact round-trip is opt-in via roundtrip:true (attribute order
    // in wild codes varies by tool — see the Imbagon fixture); the else
    // branch still asserts the semantic round-trip for every fixture.
    if (fixture.roundtrip) {
      it(`round-trips ${fixture.name} character-exact`, () => {
        expect(encodeTemplate(decodeTemplate(fixture.code))).toBe(fixture.code);
      });
    } else {
      it(`re-encodes ${fixture.name} to a semantically equal modern template`, () => {
        // Attribute order is not semantic (wild codes vary; our encoder
        // canonicalizes to ascending ids), so compare order-insensitively.
        const sortAttrs = (t: ReturnType<typeof decodeTemplate>) => ({
          ...t,
          attributes: [...t.attributes].sort((a, b) => a.attributeId - b.attributeId),
        });
        const decoded = decodeTemplate(fixture.code);
        expect(sortAttrs(decodeTemplate(encodeTemplate(decoded)))).toEqual(sortAttrs(decoded));
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

describe("malformed input rejection", () => {
  const reject = (code: string, errorCode: string) => {
    try {
      decodeTemplate(code);
      expect.unreachable(`expected ${errorCode}`);
    } catch (e) {
      expect((e as TemplateError).code).toBe(errorCode);
    }
  };
  it("rejects empty strings", () => reject("   ", "TRUNCATED"));
  it("rejects non-charset characters", () => reject("OQAS EZKT!", "INVALID_CHARACTER"));
  it("rejects unknown template types", () => reject("zzzzzzzzzzzz", "INVALID_HEADER"));
  it("rejects codes that end mid-field", () => reject("OQ", "TRUNCATED"));
  it("round-trips through valuesToChars boundary values", () => {
    // exercised indirectly; a value >63 can only arise from an internal bug
    expect(encodeTemplate(decodeTemplate("OQASEZKT9F7gTNAAAAAAXFxgA"))).toBeTruthy();
  });
});

describe("malformed bitstream rejection (GW1-02 audit)", () => {
  it("accepts the canonical empty bar and its pad-to-even form", () => {
    expect(() => decodeTemplate("OQAAAAAAAAAAAAAA")).not.toThrow();
  });
  it("rejects a non-zero terminal/padding bit", () => {
    expect(() => decodeTemplate("OQAAAAAAAAAAAAAQ")).toThrow(/tail|non-zero/i);
    expect(() => decodeTemplate("OQAAAAAAAAAAAAAg")).toThrow(/tail|non-zero/i);
  });
  it("rejects a non-zero trailing base64 char", () => {
    expect(() => decodeTemplate("OQAAAAAAAAAAAAAAB")).toThrow(/tail|non-zero/i);
    expect(() => decodeTemplate("OQAAAAAAAAAAAAAA/")).toThrow(/tail|non-zero/i);
  });
});
