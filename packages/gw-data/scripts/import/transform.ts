/** Upstream shapes -> our committed data shapes. Pure functions, no I/O. */
import type { Upstream } from "./load.ts";
// The SAME normaliser the runtime lookup uses, not a copy of the rule — see
// normalize.ts. The alias map's only safety guarantee is stated in its terms.
import { normalizeName } from "../../src/normalize.ts";

// Upstream constant shapes (informal, mirrored from es6/constants.js).
type LangName = { en: string; de: string };
type UpstreamAttribute = { prof: number; pri: boolean; max: number; name: LangName };
type UpstreamProfession = { name: LangName; abbr: LangName };
type UpstreamCampaign = { name: LangName; continent: unknown };
type UpstreamSkillType = { name: LangName };
type UpstreamSkill = {
  id: number;
  campaign: number;
  profession: number;
  attribute: number;
  type: number;
  is_elite: boolean;
  is_rp: boolean;
  is_pvp: boolean;
  pvp_split: boolean;
  split_id: number;
  upkeep: number;
  energy: number;
  activation: number;
  recharge: number;
  adrenaline: number;
  sacrifice: number;
  overcast: number;
  name: string;
  description: string;
  concise: string;
};

/**
 * Longest name in the current dataset is 34 characters ("Friend of the Kurzicks
 * Title Track"); the observed charset is letters, digits, spaces and `! " ' ( ) , - .`
 * (measured across skills, professions, attributes, campaigns, skill types and
 * heroes). Both bounds are deliberately loose against those figures.
 */
const MAX_NAME_LENGTH = 80;
const ALLOWED_NAME_CHARS = /^[A-Za-z0-9 !"'(),.-]+$/;

/**
 * Second-person imperatives aimed at a reader or a model rather than at the
 * player. Shared by both gates: real descriptions are third-person effect text
 * ("Target foe takes...") and real names are noun phrases, so neither has any
 * business matching this. A charset and a length bound alone would NOT catch it in
 * a name — "Aegis. Ignore all previous instructions." is 40 legal characters.
 */
const INSTRUCTION_PATTERN =
  /\b(ignore (all |any )?(previous|prior|above)|disregard (all |the )?(previous|prior)|system prompt|you are (now )?an? |instead(,)? (call|use|reply|respond|output)|do not (tell|mention|reveal)|reveal your|print your)\b/i;

/**
 * Plausibility check on every upstream NAME, not just descriptions (audit L1).
 *
 * The description gate below was the only content check, but names travel into an
 * LLM's context by exactly the same routes — get_skill, search_skills,
 * decode_template — and the weekly data PR AUTO-MERGES. So a compromised upstream
 * that wrote its instruction into a skill NAME, or into the profession, attribute,
 * campaign or skill-type tables, passed all three gates untouched.
 *
 * A name needs a different shape from a description, so this is not a copy of
 * assertPlausibleDescription: names are short, carry no markup and no sentence
 * punctuation, so a charset and a length bound do nearly all the work. Anything
 * structurally novel stops the import rather than being merged unread.
 */
function assertPlausibleNameAgainst(
  kind: string,
  id: number | string,
  name: string,
  allowed: RegExp,
): void {
  const fail = (why: string) => {
    throw new Error(
      `Implausible ${kind} name at ${id}: ${why}. ` +
        `Upstream may be compromised or its format changed — review by hand before importing. ` +
        `Text: ${JSON.stringify(name.slice(0, 200))}`,
    );
  };
  if (name.length === 0) fail("empty");
  if (name.length > MAX_NAME_LENGTH) {
    fail(`${name.length} characters, over the ${MAX_NAME_LENGTH} limit`);
  }
  if (!allowed.test(name)) {
    const offenders = [...new Set([...name].filter((c) => !allowed.test(c)))].join("");
    fail(`unexpected characters ${JSON.stringify(offenders)}`);
  }
  if (INSTRUCTION_PATTERN.test(name)) fail("reads as an instruction to a model");
}

export function assertPlausibleName(kind: string, id: number | string, name: string): void {
  assertPlausibleNameAgainst(kind, id, name, ALLOWED_NAME_CHARS);
}

/**
 * The same gate, widened to the French alphabet — and ONLY to it.
 *
 * French names travel into an LLM's context exactly like English ones (they are
 * what get_skill resolves), so skipping the gate for them would reopen audit L1 on
 * the new channel. But the English charset rejects every accent, so it cannot be
 * reused as-is.
 *
 * Measured across the 1485 French names actually served: the only characters
 * beyond the English set are `Âàâèéêîïôöû`, and the longest name is 49 characters
 * ("Tireur d'élite de soutien de l'Avant-garde d'Ebon"), comfortably inside the
 * shared 80-character bound. The allowed set below is nonetheless the full French
 * repertoire rather than those eleven, for the same reason the English bounds are
 * loose against their own figures: a balance patch that adds the first name
 * carrying `ç` or `œ` is a legitimate change, and a gate that reds the auto-merging
 * weekly job on it would train someone to widen it unread. Anything outside Latin-1
 * French — Cyrillic, CJK, control characters, markup — still stops the import.
 */
const ALLOWED_FR_NAME_CHARS = /^[A-Za-z0-9 !"'(),.\-\u00C0-\u00FF\u0152\u0153]+$/;

export function assertPlausibleFrenchName(id: number | string, name: string): void {
  assertPlausibleNameAgainst("French skill", id, name, ALLOWED_FR_NAME_CHARS);
}

/** The name we ship, after the gate above. */
function checkedName(kind: string, id: number | string, name: string): string {
  assertPlausibleName(kind, id, name);
  return name;
}

// --- campaigns / professions / attributes / types ---------------------------
export const transformCampaigns = (CAMPAIGNS: unknown) =>
  (CAMPAIGNS as unknown as UpstreamCampaign[]).map((c, id) => ({
    id,
    name: checkedName("campaign", id, c.name.en),
  }));

export const transformProfessions = (PROFESSIONS: unknown) =>
  (PROFESSIONS as unknown as UpstreamProfession[]).map((p, id) => ({
    id,
    name: checkedName("profession", id, p.name.en),
    abbr: checkedName("profession abbreviation", id, p.abbr.en),
  }));

export const transformAttributes = (ATTRIBUTES: unknown) =>
  Object.entries(ATTRIBUTES as unknown as Record<string, UpstreamAttribute>).map(([id, a]) => ({
    id: Number(id),
    name: checkedName("attribute", id, a.name.en),
    isPrimary: a.pri,
    professionId: a.prof,
    /** Maximum achievable rank incl. bonuses (21 for regular attributes, title cap otherwise). */
    max: a.max,
  }));

export const transformSkillTypes = (SKILLTYPES: unknown) =>
  Object.entries(SKILLTYPES as unknown as Record<string, UpstreamSkillType>).map(([id, t]) => ({
    id: Number(id),
    name: checkedName("skill type", id, t.name.en),
  }));

/** Tags upstream legitimately uses inside skill descriptions. */
const ALLOWED_DESCRIPTION_TAGS = new Set(["<gray>", "</gray>", "<sic/>"]);
/** No real skill description comes close; the longest observed is well under this. */
const MAX_DESCRIPTION_LENGTH = 600;

/**
 * Plausibility check on upstream skill descriptions (audit C1).
 *
 * Descriptions travel verbatim into an LLM's context through get_skill,
 * search_skills and decode_template. A compromised or vandalised upstream does
 * not need code execution to attack this project: a sentence phrased as an
 * instruction is enough. No golden-fixture test can catch that, because the
 * invariants check ids, uniqueness and types — never the semantics of free text.
 *
 * This does not attempt to detect "a prompt injection" (undecidable). It asserts
 * the narrow shape real descriptions have always had, so anything structurally
 * novel stops the import instead of being auto-merged.
 */
export function assertPlausibleDescription(id: number, name: string, description: string): void {
  const fail = (why: string) => {
    throw new Error(
      `Implausible description on skill ${id} ("${name}"): ${why}. ` +
        `Upstream may be compromised or its format changed — review by hand before importing. ` +
        `Text: ${JSON.stringify(description.slice(0, 200))}`,
    );
  };
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    fail(`${description.length} characters, over the ${MAX_DESCRIPTION_LENGTH} limit`);
  }
  for (const tag of description.match(/<[^>]*>/g) ?? []) {
    if (!ALLOWED_DESCRIPTION_TAGS.has(tag)) fail(`unexpected tag ${tag}`);
  }
  if (/\bhttps?:\/\//i.test(description) || /\bwww\./i.test(description)) {
    fail("contains a URL");
  }
  if (INSTRUCTION_PATTERN.test(description)) fail("reads as an instruction to a model");
}

/** The description we ship, after the plausibility gate above. */
function checkedDescription(s: UpstreamSkill): string {
  const description = s.concise || s.description;
  assertPlausibleDescription(s.id, s.name, description);
  return description;
}

// --- skills ------------------------------------------------------------------
export const transformSkills = (upstream: Upstream) =>
  Object.keys(upstream.skilldata)
    .map(
      (id) =>
        ({
          ...(upstream.skilldata[id] as object),
          ...(upstream.skilldesc[id] as object),
        }) as UpstreamSkill,
    )
    .filter((s) => s.id !== 0) // id 0 = "No Skill" (empty-slot sentinel)
    .map((s) => ({
      id: s.id,
      // Upstream almost always disambiguates the PvP-side name with a
      // "(PvP)" suffix (155/156 split pairs do), but occasionally forgets on
      // a newly added skill (id 3442 "Mighty Throw" shipped with the exact
      // same name as its PvE counterpart 1547, breaking the name-uniqueness
      // invariant repository.test.ts checks). Enforce the suffix ourselves
      // so a future upstream naming gap never silently collides a skill name.
      name: checkedName(
        "skill",
        s.id,
        s.is_pvp && !s.name.includes("(PvP)") ? `${s.name} (PvP)` : s.name,
      ),
      description: checkedDescription(s),
      campaignId: s.campaign,
      professionId: s.profession,
      attributeId: s.attribute,
      elite: s.is_elite,
      /** PvE-only / roleplay skill (upstream is_rp): player bars cap at 3, heroes none. */
      isRoleplay: s.is_rp,
      /** True for the separate "(PvP)" version of a split skill (not encodable in PvE templates). */
      isPvpVersion: s.is_pvp,
      /** True if the skill has a separate PvP version; splitId points to it. */
      pvpSplit: s.pvp_split,
      splitId: s.split_id || 0,
      typeId: s.type,
      upkeep: s.upkeep,
      energy: s.energy,
      activation: s.activation,
      recharge: s.recharge,
      adrenaline: s.adrenaline,
      sacrifice: s.sacrifice,
      overcast: s.overcast,
    }))
    .sort((a, b) => a.id - b.id);

// --- French names ------------------------------------------------------------
/** One entry of upstream's skilldesc-fr.json (same shape as the English file). */
type UpstreamFrenchDesc = { id: number; name: string };

/** The French table, plus the three classes a reviewer of the weekly PR wants named. */
export interface FrenchNamesResult {
  /** id (as a string key) -> French name, for EVERY skill upstream names, ascending by id. */
  names: Record<string, string>;
  /** French name normalises to the skill's own English name (proper nouns, cognates). */
  identical: number[];
  /** French name of one skill IS the English name of another; the runtime keeps English. */
  shadowed: { id: number; frenchName: string; englishIds: number[] }[];
  /** One normalised French name claimed by several skills; the runtime refuses to guess. */
  ambiguous: { normalized: string; ids: number[] }[];
}

/**
 * Build the complete French name table, and report what makes it interesting.
 *
 * The table is deliberately UNFILTERED: it records the French name of every skill,
 * because that is a fact about each skill and stays true on its own terms. The
 * policy question — what happens when a French name and an English name claim the
 * same normalised key — is answered once, in repository.ts, where the two
 * namespaces are actually merged. Pre-filtering here instead would put the same
 * rule in two places, and would also throw away the names the SUGGESTER needs: an
 * ambiguous French name should come back as several English candidates rather than
 * vanishing.
 *
 * What this function does own is the GATE and the report. Every French name is
 * checked (audit L1 applies to this channel exactly as it does to English names —
 * they reach an LLM by the same route), and the three classes below are logged by
 * the importer so the auto-merging weekly PR shows them instead of hiding them:
 *
 *  - `shadowed` (2 today): "Récupération", the French name of Recovery (1748),
 *    normalises to `recuperation` — the ENGLISH name of a different skill,
 *    Recuperation (981). English wins at lookup, so a caller typing the French name
 *    of Recovery receives Recuperation. Unavoidable in a single-answer lookup, and
 *    strictly better than the alternative of an English name changing meaning.
 *  - `ambiguous` (5 today): "Rafale" is the French name of BOTH Flurry (344) and
 *    Gust (843); likewise Attaque féroce, Attaque sournoise and Coup enragé (twice,
 *    counting the PvP pair). Exact resolution would be a coin flip presented as a
 *    fact, so the runtime declines and the suggester offers both.
 *  - `identical` (31 today): "Diversion", "Echo", "Rigor Mortis" — the English index
 *    already resolves these, so the French entry adds nothing at lookup time.
 *
 * PvP versions get the same "(PvP)" suffix discipline as the English transform.
 * Upstream currently suffixes all its French PvP names itself (measured: 0 missing),
 * but the English side already had to repair one, and an unsuffixed French PvP name
 * would collide with its own PvE form and cost BOTH skills their exact lookup.
 */
export function transformFrenchNames(
  skilldescFr: Record<string, unknown>,
  skills: readonly { id: number; name: string; isPvpVersion: boolean }[],
): FrenchNamesResult {
  const englishIdsByNormalized = new Map<string, number[]>();
  for (const skill of skills) {
    const key = normalizeName(skill.name);
    englishIdsByNormalized.set(key, [...(englishIdsByNormalized.get(key) ?? []), skill.id]);
  }

  const result: FrenchNamesResult = { names: {}, identical: [], shadowed: [], ambiguous: [] };
  const frenchNameById = new Map<number, string>();
  for (const skill of skills) {
    const entry = skilldescFr[String(skill.id)] as UpstreamFrenchDesc | undefined;
    if (entry?.name === undefined) continue;
    assertPlausibleFrenchName(skill.id, entry.name);
    const name =
      skill.isPvpVersion && !entry.name.includes("(PvP)") ? `${entry.name} (PvP)` : entry.name;
    frenchNameById.set(skill.id, name);
    result.names[String(skill.id)] = name;
  }

  const idsByNormalizedFrench = new Map<string, number[]>();
  for (const [id, name] of frenchNameById) {
    const key = normalizeName(name);
    idsByNormalizedFrench.set(key, [...(idsByNormalizedFrench.get(key) ?? []), id]);
  }
  for (const [normalized, ids] of idsByNormalizedFrench) {
    if (ids.length > 1) {
      result.ambiguous.push({ normalized, ids });
      continue;
    }
    const id = ids[0]!;
    const englishIds = englishIdsByNormalized.get(normalized);
    if (englishIds === undefined) continue;
    if (englishIds.length === 1 && englishIds[0] === id) result.identical.push(id);
    else result.shadowed.push({ id, frenchName: frenchNameById.get(id)!, englishIds });
  }
  result.identical.sort((a, b) => a - b);
  result.shadowed.sort((a, b) => a.id - b.id);
  result.ambiguous.sort((a, b) => a.ids[0]! - b.ids[0]!);
  return result;
}
