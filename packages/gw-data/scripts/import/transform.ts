/** Upstream shapes -> our committed data shapes. Pure functions, no I/O. */
import type { Upstream } from "./load.ts";

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
export function assertPlausibleName(kind: string, id: number | string, name: string): void {
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
  if (!ALLOWED_NAME_CHARS.test(name)) {
    const offenders = [...new Set([...name].filter((c) => !ALLOWED_NAME_CHARS.test(c)))].join("");
    fail(`unexpected characters ${JSON.stringify(offenders)}`);
  }
  if (INSTRUCTION_PATTERN.test(name)) fail("reads as an instruction to a model");
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
