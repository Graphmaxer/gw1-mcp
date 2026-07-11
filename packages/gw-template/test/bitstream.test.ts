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
});
