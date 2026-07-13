import { TemplateError } from "./types.js";

/**
 * Reads unsigned integers from a stream of 6-bit base64 values, where every
 * binary number is stored lowest-bit-first (bit i contributes 2^i, numbers
 * spanning 6-bit groups continue in the same order).
 */
export class BitReader {
  private readonly bits: number[] = [];
  private pos = 0;

  constructor(values6bit: number[]) {
    for (const v of values6bit) {
      for (let i = 0; i < 6; i++) this.bits.push((v >> i) & 1);
    }
  }

  get remaining(): number {
    return this.bits.length - this.pos;
  }

  read(n: number): number {
    if (this.remaining < n) {
      throw new TemplateError(
        "TRUNCATED",
        `Template ended unexpectedly (needed ${n} bits, ${this.remaining} left)`,
      );
    }
    let value = 0;
    for (let i = 0; i < n; i++) {
      value |= (this.bits[this.pos + i] ?? 0) << i;
    }
    this.pos += n;
    return value >>> 0;
  }

  /** Read n bits without consuming them. */
}

/** Writes unsigned integers lowest-bit-first and packs them into 6-bit values. */
export class BitWriter {
  private readonly bits: number[] = [];

  write(value: number, n: number): void {
    if (value < 0 || value >= 2 ** n) {
      throw new TemplateError("VALUE_OUT_OF_RANGE", `Value ${value} does not fit in ${n} bits`);
    }
    for (let i = 0; i < n; i++) this.bits.push((value >> i) & 1);
  }

  /** Pad with zero bits to a 6-bit boundary and return the 6-bit values. */
  toValues(): number[] {
    const bits = [...this.bits];
    while (bits.length % 6 !== 0) bits.push(0);
    const values: number[] = [];
    for (let g = 0; g < bits.length; g += 6) {
      let v = 0;
      for (let i = 0; i < 6; i++) v |= (bits[g + i] ?? 0) << i;
      values.push(v);
    }
    return values;
  }
}

/** Number of bits needed to represent value (minimum 1). */
export function bitLength(value: number): number {
  let n = 1;
  while (2 ** n <= value) n++;
  return n;
}
