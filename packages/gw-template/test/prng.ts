/**
 * mulberry32: overflow-safe seeded PRNG for reproducible fuzz tests (a naive
 * LCG in JS loses float precision above 2^53 and can get stuck on a fixed
 * point). Returns rand(n) -> integer in [0, n). Shared by the differential
 * fuzz and the round-trip fuzz so both stay reproducible from one seed.
 */
export function mulberry32(initialSeed: number): (n: number) => number {
  let seed = initialSeed >>> 0;
  return (n: number): number => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) % n;
  };
}
