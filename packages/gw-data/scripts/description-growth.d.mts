/**
 * Types for description-growth.mjs. The implementation is deliberately plain
 * .mjs with zero dependencies so the privileged open-pr job can run it with bare
 * `node` (no pnpm install in a job holding contents:write); this file keeps it
 * type-checked and the vitest suite type-safe all the same.
 */
export declare const MAX_DESCRIPTION_GROWTH: number;

export interface SkillDescription {
  id: number;
  name: string;
  description: string;
}

export interface GrowthFinding {
  id: number;
  name: string;
  growth: number;
  before: string;
  after: string;
}

export declare function findDescriptionGrowth(
  before: readonly SkillDescription[],
  after: readonly SkillDescription[],
  threshold?: number,
): GrowthFinding[];
