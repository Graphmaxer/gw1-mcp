import campaignsJson from "../data/campaigns.json";
import professionsJson from "../data/professions.json";
import attributesJson from "../data/attributes.json";
import skillTypesJson from "../data/skill-types.json";
import skillsJson from "../data/skills.json";
import heroesJson from "../data/heroes.json";
import type { Attribute, Campaign, Hero, Profession, Skill, SkillType } from "./types.js";

export const campaigns: Campaign[] = campaignsJson;
export const professions: Profession[] = professionsJson;
export const attributes: Attribute[] = attributesJson;
export const skillTypes: SkillType[] = skillTypesJson;
export const skills: Skill[] = skillsJson;
export const heroes: Hero[] = heroesJson;

const skillById = new Map(skills.map((s) => [s.id, s]));
const professionById = new Map(professions.map((p) => [p.id, p]));
const attributeById = new Map(attributes.map((a) => [a.id, a]));
const campaignById = new Map(campaigns.map((c) => [c.id, c]));
const skillTypeById = new Map(skillTypes.map((t) => [t.id, t]));

/** Lowercase, strip diacritics and punctuation — tolerant name matching. */
export function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const heroByNormalizedName = new Map(heroes.map((h) => [normalizeName(h.name), h]));
const heroById = new Map(heroes.map((h) => [h.id, h]));

const skillByNormalizedName = new Map(skills.map((s) => [normalizeName(s.name), s]));
const professionByNormalizedName = new Map(professions.map((p) => [normalizeName(p.name), p]));
const campaignByNormalizedName = new Map(campaigns.map((c) => [normalizeName(c.name), c]));
const attributeByNormalizedName = new Map(attributes.map((a) => [normalizeName(a.name), a]));

export const getSkillById = (id: number): Skill | undefined => skillById.get(id);
export const getSkillByName = (name: string): Skill | undefined =>
  skillByNormalizedName.get(normalizeName(name));
export const getProfessionById = (id: number): Profession | undefined => professionById.get(id);
export const getProfessionByName = (name: string): Profession | undefined =>
  professionByNormalizedName.get(normalizeName(name));
export const getCampaignByName = (name: string): Campaign | undefined =>
  campaignByNormalizedName.get(normalizeName(name));
export const getAttributeById = (id: number): Attribute | undefined => attributeById.get(id);
export const getAttributeByName = (name: string): Attribute | undefined =>
  attributeByNormalizedName.get(normalizeName(name));
export const getCampaignById = (id: number): Campaign | undefined => campaignById.get(id);
export const getSkillType = (id: number): SkillType | undefined => skillTypeById.get(id);
export const getHeroById = (id: number): Hero | undefined => heroById.get(id);
export const getHeroByName = (name: string): Hero | undefined =>
  heroByNormalizedName.get(normalizeName(name));

export interface SkillSearchFilters {
  professionId?: number;
  attributeId?: number;
  campaignId?: number;
  elite?: boolean;
  nameContains?: string;
  /** Include the separate "(PvP)" skill versions (excluded by default). */
  includePvpVersions?: boolean;
}

export function searchSkills(filters: SkillSearchFilters): Skill[] {
  const needle =
    filters.nameContains !== undefined ? normalizeName(filters.nameContains) : undefined;
  return skills.filter(
    (s) =>
      (filters.includePvpVersions === true || !s.isPvpVersion) &&
      (filters.professionId === undefined || s.professionId === filters.professionId) &&
      (filters.attributeId === undefined || s.attributeId === filters.attributeId) &&
      (filters.campaignId === undefined || s.campaignId === filters.campaignId) &&
      (filters.elite === undefined || s.elite === filters.elite) &&
      (needle === undefined || normalizeName(s.name).includes(needle)),
  );
}

/** Longest query we will run fuzzy matching on — beyond this, skip suggestions
 *  entirely. Guards against the O(n*m) suggestion path being a CPU DoS vector
 *  (GW1-AUD-01): a real skill name is well under this. */
const MAX_SUGGEST_LEN = 64;

/** Beyond this edit distance a "suggestion" is noise, not a typo correction.
 *  A distance cap is what bounds the adversarial cost: capping the input LENGTH
 *  (MAX_SUGGEST_LEN) bounded the
 *  input but not the WORK, so a 64-char query still ran a full O(n*m) matrix
 *  against all 1485 names (~109 ms CPU for a ~300-byte request — the very
 *  amplification GW1-AUD-01 set out to close). Returning nothing is also the
 *  better answer for the caller: an LLM handed no suggestion asks, whereas an
 *  LLM handed a confidently wrong one (e.g. "Signet of Creation" for the French
 *  "Signet de guérison") encodes a valid-but-wrong template.
 *
 *  5 is calibrated on measured distances against the real 1485 names, not picked
 *  round: genuine misspellings land at d<=2 ("mystik regenaration" -> 2,
 *  "Vow of Revoltion" -> 1), French names land at 7-11 ("Signet de guérison" ->
 *  7 from the wrong "Signet of Creation"), and padding attacks at d>=7 with a
 *  distance/length ratio above 0.85. 5 is the widest cap that still drops the
 *  French noise while keeping the one French form that resolves CORRECTLY by
 *  cognate ("Vœu de piété" -> "Vow of Piety", d=5). */
const MAX_SUGGEST_DISTANCE = 5;

/** Levenshtein restricted to a diagonal band of width `max`, abandoning a row
 *  as soon as every cell in it exceeds `max`. Returns undefined when the true
 *  distance is > max — callers drop those candidates. Distances <= max are
 *  exact, so ranking among real typos is unchanged. */
function boundedLevenshtein(a: string, b: string, max: number): number | undefined {
  const m = a.length;
  const n = b.length;
  // A length gap alone already exceeds the budget: no alignment can recover.
  if (Math.abs(m - n) > max) return undefined;
  const prev = Array.from<number>({ length: n + 1 }).fill(0);
  const curr = Array.from<number>({ length: n + 1 }).fill(0);
  for (let j = 0; j <= n; j++) prev[j] = j <= max ? j : max + 1;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    const lo = Math.max(1, i - max);
    const hi = Math.min(n, i + max);
    if (lo > 1) curr[lo - 1] = max + 1;
    let rowMin = i <= max ? i : max + 1;
    for (let j = lo; j <= hi; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(
        (prev[j] ?? max + 1) + 1,
        (curr[j - 1] ?? max + 1) + 1,
        (prev[j - 1] ?? max + 1) + cost,
      );
      curr[j] = value;
      if (value < rowMin) rowMin = value;
    }
    for (let j = hi + 1; j <= n; j++) curr[j] = max + 1;
    if (rowMin > max) return undefined;
    for (let j = 0; j <= n; j++) prev[j] = curr[j] ?? max + 1;
  }
  const distance = prev[n] ?? max + 1;
  return distance <= max ? distance : undefined;
}

/**
 * Does every whitespace-separated token of the query prefix the candidate's token
 * at the same position? ("mystic regen" -> "Mystic Regeneration", "heal sig" ->
 * "Healing Signet".)
 *
 * Abbreviations are not typos, and edit distance handles them badly: "Mystic
 * Regen" sits 6 edits from "Mystic Regeneration" — past the cap — so the right
 * answer was dropped while shorter, wrong names won ("Mystic Sweep"), and
 * "Vow of Rev" resolved to "Vow of Piety". Wrong-but-plausible is the failure
 * mode that makes a model encode a valid, wrong template, so this is checked
 * first and ranked above any distance match.
 */
function tokenPrefixMatch(needle: string, candidate: string): boolean {
  const needleTokens = needle.split(" ").filter((t) => t.length > 0);
  const candidateTokens = candidate.split(" ").filter((t) => t.length > 0);
  if (needleTokens.length === 0 || needleTokens.length > candidateTokens.length) return false;
  return needleTokens.every((token, i) => candidateTokens[i]?.startsWith(token) === true);
}

/** Rank candidates by token-prefix match first, then by bounded edit distance. */
function closest<T>(
  candidates: readonly T[],
  needle: string,
  nameOf: (item: T) => string,
  count: number,
): T[] {
  const prefixed: { item: T; length: number }[] = [];
  const scored: { item: T; d: number }[] = [];
  for (const item of candidates) {
    const name = normalizeName(nameOf(item));
    if (tokenPrefixMatch(needle, name)) {
      // Shortest first: the least-padded name is the most specific completion.
      prefixed.push({ item, length: name.length });
      continue;
    }
    const d = boundedLevenshtein(needle, name, MAX_SUGGEST_DISTANCE);
    if (d !== undefined) scored.push({ item, d });
  }
  const ranked = [
    ...prefixed.sort((x, y) => x.length - y.length).map(({ item }) => item),
    ...scored.sort((x, y) => x.d - y.d).map(({ item }) => item),
  ];
  return ranked.slice(0, count);
}

/** Closest skill names to a (possibly misspelled) query — for LLM self-correction. */
export function suggestAttributeNames(name: string, count = 3): string[] {
  if (name.length > MAX_SUGGEST_LEN) return [];
  return closest(attributes, normalizeName(name), (a) => a.name, count).map((a) => a.name);
}

export function suggestSkillNames(name: string, count = 3): string[] {
  if (name.length > MAX_SUGGEST_LEN) return [];
  return closest(skills, normalizeName(name), (s) => s.name, count).map((s) => s.name);
}
