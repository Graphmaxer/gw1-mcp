/** Upstream shapes -> our committed data shapes. Pure functions, no I/O. */
import type { Upstream } from "./load.js";

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

// --- campaigns / professions / attributes / types ---------------------------
export const transformCampaigns = (CAMPAIGNS: unknown) =>
  (CAMPAIGNS as unknown as UpstreamCampaign[]).map((c, id) => ({
    id,
    name: c.name.en,
  }));

export const transformProfessions = (PROFESSIONS: unknown) =>
  (PROFESSIONS as unknown as UpstreamProfession[]).map((p, id) => ({
    id,
    name: p.name.en,
    abbr: p.abbr.en,
  }));

export const transformAttributes = (ATTRIBUTES: unknown) =>
  Object.entries(ATTRIBUTES as unknown as Record<string, UpstreamAttribute>).map(([id, a]) => ({
    id: Number(id),
    name: a.name.en,
    isPrimary: a.pri,
    professionId: a.prof,
    /** Maximum achievable rank incl. bonuses (21 for regular attributes, title cap otherwise). */
    max: a.max,
  }));

export const transformSkillTypes = (SKILLTYPES: unknown) =>
  Object.entries(SKILLTYPES as unknown as Record<string, UpstreamSkillType>).map(([id, t]) => ({
    id: Number(id),
    name: t.name.en,
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
  // Second-person imperatives aimed at a reader/model, not at the player. Real
  // descriptions are third-person effect text ("Target foe takes...").
  const instructionPattern =
    /\b(ignore (all |any )?(previous|prior|above)|disregard (all |the )?(previous|prior)|system prompt|you are (now )?an? |instead(,)? (call|use|reply|respond|output)|do not (tell|mention|reveal)|reveal your|print your)\b/i;
  if (instructionPattern.test(description)) fail("reads as an instruction to a model");
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
      name: s.is_pvp && !s.name.includes("(PvP)") ? `${s.name} (PvP)` : s.name,
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
