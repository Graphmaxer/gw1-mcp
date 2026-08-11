import { describe, expect, it } from "vitest";
import { BitReader, BitWriter, bitLength } from "../src/index.js";

describe("bitstream", () => {
  it("reads numbers lowest-bit-first across 6-bit boundaries", () => {
    const writer = new BitWriter();
    writer.write(14, 4);
    writer.write(0, 4);
    writer.write(2, 2);
    writer.write(1337, 11);
    const reader = new BitReader(writer.toValues());
    expect(reader.read(4)).toBe(14);
    expect(reader.read(4)).toBe(0);
    expect(reader.read(2)).toBe(2);
    expect(reader.read(11)).toBe(1337);
  });

  it("computes bit lengths", () => {
    expect(bitLength(0)).toBe(1);
    expect(bitLength(1)).toBe(1);
    expect(bitLength(15)).toBe(4);
    expect(bitLength(16)).toBe(5);
    expect(bitLength(3431)).toBe(12);
  });

  it("rejects values that do not fit", () => {
    const writer = new BitWriter();
    expect(() => writer.write(16, 4)).toThrow();
  });

  it("refuses field widths past 31 bits instead of returning wrong numbers", () => {
    // Both classes use JS bitwise operators, which coerce to 32-bit signed
    // integers: read(40) used to return a silently wrong value and write(v, 40)
    // packed the wrong bits, with no error either way. Unreachable through the
    // codec (23 bits is the format's widest field) but these are exported.
    const writer = new BitWriter();
    expect(() => writer.write(1, 40)).toThrow(/handles 0 to 31 bits/);
    expect(() => writer.write(1, -1)).toThrow(/handles 0 to 31 bits/);
    writer.write(1, 31);
    const reader = new BitReader(writer.toValues());
    expect(() => reader.read(32)).toThrow(/handles 0 to 31 bits/);
    expect(reader.read(31)).toBe(1);
  });
});
