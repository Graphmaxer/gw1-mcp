/**
 * Tests written from a mutation pass (2026-11-26, 261 hand-made mutants): each
 * one kills a small semantic change to the source that the suite let through
 * while reporting full line coverage. They assert exact values against the data
 * on purpose; a looser assertion is how each of these mutants survived.
 */
import { describe, expect, it } from "vitest";
import { valuesToChars } from "../src/base64.js";
import { BitReader, BitWriter } from "../src/bitstream.js";
import { decodeTemplate, encodeTemplate } from "../src/codec.js";

describe("codec edges", () => {
  it("refuses a type-14 template whose version is not 0", () => {
    const writer = new BitWriter();
    writer.write(14, 4);
    writer.write(1, 4); // version 1
    writer.write(0, 2 + 4 + 4 + 4 + 4 + 4); // professions, no attributes, 8-bit skills
    for (let i = 0; i < 8; i++) writer.write(0, 8);
    writer.write(0, 1);
    const code = valuesToChars(writer.toValues());
    expect(() => decodeTemplate(code)).toThrow(/Unsupported skill template version: 1/);
  });

  it("names the profession, not an internal field, for an 11- or 12-bit profession id", () => {
    for (const primary of [1024, 4095]) {
      expect(() =>
        encodeTemplate({ primary, secondary: 0, attributes: [], skills: [0, 0, 0, 0, 0, 0, 0, 0] }),
      ).toThrow(`Profession id ${primary} exceeds what a skill template can encode`);
    }
  });

  it("refuses a fractional or NaN field width", () => {
    expect(() => new BitReader([0, 0]).read(1.5)).toThrow(/Field width/);
    expect(() => new BitReader([0, 0]).read(Number.NaN)).toThrow(/Field width/);
    expect(() => new BitWriter().write(0, Number.NaN)).toThrow(/Field width/);
  });
});

describe("base64 value guard", () => {
  it("maps the two ends of the alphabet and refuses a value that is not 6 bits", () => {
    expect(valuesToChars([0, 63])).toBe("A/");
    expect(() => valuesToChars([64])).toThrow(/out of range: 64/);
    expect(() => valuesToChars([-1])).toThrow(/out of range: -1/);
  });
});
