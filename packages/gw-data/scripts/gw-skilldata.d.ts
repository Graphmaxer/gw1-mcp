// Minimal ambient declarations for @buildwars/gw-skilldata (no bundled types).
// Both upstream shapes are declared because loadUpstream accepts both: the flat
// tables of 1.x, and the id-keyed class statics 2.0.0 replaced them with. The Pages
// path fetches the bundle from a URL, so which one arrives is not decided by our
// lockfile — see normaliseConstantTables in scripts/import/load.ts.
declare module "@buildwars/gw-skilldata" {
  // 1.x
  export const ATTRIBUTES: unknown;
  export const CAMPAIGNS: unknown;
  export const PROFESSIONS: unknown;
  export const SKILLTYPES: unknown;
  // 2.x
  export const Attribute: unknown;
  export const Campaign: unknown;
  export const Profession: unknown;
  export const Type: unknown;
  export const Skill: unknown;
  export const Lang: unknown;
  // both
  export class SkillLangEnglish {}
  export class SkillLangGerman {}
}
