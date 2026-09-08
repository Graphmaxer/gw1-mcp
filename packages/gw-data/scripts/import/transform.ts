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

/**
 * Whitespace as upstream sometimes ships it: "Aegis  (PvP)", two spaces (ids 2857,
 * 2869 and 3035, plus the French 3035, first seen 2026-09-07) — the wiki-side name
 * carries a trailing space and upstream appends its own " (PvP)". normalizeName
 * collapses runs, so LOOKUP never noticed; the shipped display name would have, and
 * so would every string compare downstream of it. Collapsed before anything else
 * reads the name, so the "(PvP)" check and the collision rule see one spelling.
 */
const tidyName = (name: string): string => name.replace(/\s+/g, " ").trim();

/**
 * Upstream almost always disambiguates the PvP-side name with a "(PvP)" suffix
 * (155/156 split pairs do), but occasionally forgets on a newly added skill (id
 * 3442 "Mighty Throw" shipped with the exact same name as its PvE counterpart
 * 1547, breaking the name-uniqueness invariant repository.test.ts checks). Enforce
 * the suffix ourselves so a future upstream naming gap never silently collides a
 * skill name. Shared by the English and the French transform.
 */
const pvpSuffixed = (name: string, isPvp: boolean): string =>
  isPvp && !name.includes("(PvP)") ? `${name} (PvP)` : name;

/**
 * The ten Luxon/Kurzick title-track pairs — Shadow Sanctuary, Ether Nightmare,
 * Signet of Corruption, Elemental Lord, Selfless Spirit, Triple Shot, "Save
 * Yourselves!", Aura of Holy Might, Spear of Fury, Summon Spirits — are DISTINCT
 * skills (ids 1948-1957 and 2051 against 2091-2100) that the game gives the SAME
 * name; only the title track they scale with tells them apart. Guild Wars Wiki
 * titles its pages "Shadow Sanctuary (Luxon)" / "Shadow Sanctuary (Kurzick)"
 * (https://wiki.guildwars.com/wiki/Shadow_Sanctuary_(Luxon)), and upstream shipped
 * exactly those names until 2026-09-07, when it switched to the in-game name and
 * twenty skills collapsed onto ten keys. English names are this repo's primary key
 * — get_skill, every name-level encode, the whole gw-mcp test corpus — so weekly
 * run #25 died on the bijectivity lock in repository.test.ts with "expected 2091 to
 * be 1948": the right failure, three steps after the cause and naming neither
 * skill.
 *
 * So the suffix is OURS now, like the "(PvP)" one: applied whenever two shipped
 * names collide and the faction tracks tell every member apart, and a no-op when
 * upstream disambiguates itself (a one-member group is never touched, so the rule
 * is idempotent by construction and the committed names did not move). Any OTHER
 * collision is refused by assertUniqueSkillNames below, at import time and naming
 * both skills — a suffix invented here for a shape nobody has seen would be a guess
 * presented as a name.
 *
 * Keyed by attribute ID, not attribute name: 104/105 are upstream's stable id
 * convention (CLAUDE.md, "Attribute id conventions"), every skill's attributeId is
 * a tested foreign key, and the labels are GWW's — not derivable from "Friend of the
 * Luxons Title Track" without string surgery that would be its own bug.
 */
const FACTION_TITLE_TRACK_LABEL: Readonly<Record<number, string>> = {
  104: "Luxon",
  105: "Kurzick",
};

interface NamedSkill {
  id: number;
  name: string;
  attributeId: number;
}

/**
 * id -> disambiguated name, for exactly the colliding faction pairs and nothing
 * else. Pure; the caller decides what an unresolved collision means (the English
 * transform refuses to ship it, the French one reports it as ambiguous).
 */
export function disambiguateFactionPairs(entries: readonly NamedSkill[]): Map<number, string> {
  const groups = new Map<string, NamedSkill[]>();
  for (const entry of entries) {
    const key = normalizeName(entry.name);
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  const renamed = new Map<number, string>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const labels = group.map((entry) => FACTION_TITLE_TRACK_LABEL[entry.attributeId]);
    const tellsApart =
      labels.every((label) => label !== undefined) && new Set(labels).size === labels.length;
    if (!tellsApart) continue;
    group.forEach((entry, i) => renamed.set(entry.id, `${entry.name} (${labels[i]})`));
  }
  return renamed;
}

/**
 * The import's own statement of the invariant repository.test.ts locks at runtime,
 * made HERE so the weekly job fails at "Import latest upstream data" with both
 * skills named, not at `pnpm -r test` with two ids and no explanation. The runtime
 * lock stays: it guards the committed bytes, this guards what is about to become
 * them.
 */
export function assertUniqueSkillNames(skills: readonly { id: number; name: string }[]): void {
  const byKey = new Map<string, { id: number; name: string }>();
  for (const skill of skills) {
    const key = normalizeName(skill.name);
    const other = byKey.get(key);
    if (other !== undefined) {
      throw new Error(
        `Skill name collision: ${other.id} ${JSON.stringify(other.name)} and ${skill.id} ` +
          `${JSON.stringify(skill.name)} would ship under the same English name. English names ` +
          `are the primary key, so this cannot be imported: either upstream stopped ` +
          `disambiguating a pair (see disambiguateFactionPairs in transform.ts) or a new skill ` +
          `reuses an existing name — review upstream by hand before extending the rule.`,
      );
    }
    byKey.set(key, skill);
  }
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
export const transformSkills = (upstream: Upstream) => {
  const rows = Object.keys(upstream.skilldata)
    .map(
      (id) =>
        ({
          ...(upstream.skilldata[id] as object),
          ...(upstream.skilldesc[id] as object),
        }) as UpstreamSkill,
    )
    .filter((s) => s.id !== 0); // id 0 = "No Skill" (empty-slot sentinel)

  // Names first, in three steps, each of which exists because upstream once
  // shipped the case it handles: collapse whitespace runs, repair a missing
  // "(PvP)", then tell the faction pairs apart. The plausibility gate runs on the
  // FINAL value, so what it checks is what gets shipped.
  const shippedName = new Map(rows.map((s) => [s.id, pvpSuffixed(tidyName(s.name), s.is_pvp)]));
  const renamed = disambiguateFactionPairs(
    rows.map((s) => ({ id: s.id, name: shippedName.get(s.id)!, attributeId: s.attribute })),
  );
  for (const [id, name] of renamed) shippedName.set(id, name);

  const skills = rows
    .map((s) => ({
      id: s.id,
      name: checkedName("skill", s.id, shippedName.get(s.id)!),
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
  assertUniqueSkillNames(skills);
  return skills;
};

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
 *  - `ambiguous`: "Rafale" is the French name of BOTH Flurry (344) and Gust (843);
 *    likewise Attaque féroce, Attaque sournoise and Coup enragé. Exact resolution
 *    would be a coin flip presented as a fact, so the runtime declines and the
 *    suggester offers both. The ten Luxon/Kurzick pairs used to be the bulk of this
 *    class (their French names are identical too, "Sanctuaire de l'ombre" twice)
 *    until the English disambiguation was mirrored here — see
 *    disambiguateFactionPairs; a French speaker now gets an exact answer for those
 *    twenty instead of a two-way suggestion.
 *  - `identical` (31 today): "Diversion", "Echo", "Rigor Mortis" — the English index
 *    already resolves these, so the French entry adds nothing at lookup time.
 *
 * PvP versions get the same "(PvP)" suffix discipline as the English transform.
 * Upstream currently suffixes all its French PvP names itself (measured: 0 missing),
 * but the English side already had to repair one, and an unsuffixed French PvP name
 * would collide with its own PvE form and cost BOTH skills their exact lookup. The
 * whitespace tidy and the faction suffix are shared for the same reason: a name
 * rule that exists on one side only is a collision waiting on the other.
 */
export function transformFrenchNames(
  skilldescFr: Record<string, unknown>,
  skills: readonly { id: number; name: string; isPvpVersion: boolean; attributeId: number }[],
): FrenchNamesResult {
  const englishIdsByNormalized = new Map<string, number[]>();
  for (const skill of skills) {
    const key = normalizeName(skill.name);
    englishIdsByNormalized.set(key, [...(englishIdsByNormalized.get(key) ?? []), skill.id]);
  }

  const result: FrenchNamesResult = { names: {}, identical: [], shadowed: [], ambiguous: [] };
  const frenchNameById = new Map<number, string>();
  const attributeOf = new Map(skills.map((skill) => [skill.id, skill.attributeId]));
  for (const skill of skills) {
    const entry = skilldescFr[String(skill.id)] as UpstreamFrenchDesc | undefined;
    if (entry?.name === undefined) continue;
    frenchNameById.set(skill.id, pvpSuffixed(tidyName(entry.name), skill.isPvpVersion));
  }
  const renamed = disambiguateFactionPairs(
    [...frenchNameById].map(([id, name]) => ({ id, name, attributeId: attributeOf.get(id)! })),
  );
  for (const [id, name] of renamed) frenchNameById.set(id, name);
  // Gated on the FINAL name, like the English side: what is checked is what ships.
  for (const [id, name] of frenchNameById) {
    assertPlausibleFrenchName(id, name);
    result.names[String(id)] = name;
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
