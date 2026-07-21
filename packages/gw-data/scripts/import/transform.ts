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
      name: s.name,
      description: s.concise || s.description,
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
