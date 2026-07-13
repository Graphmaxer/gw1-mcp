export interface Campaign {
  /** 0 = Core, 1 = Prophecies, 2 = Factions, 3 = Nightfall, 4 = Eye of the North. */
  id: number;
  name: string;
  nameDe: string;
}

export interface Profession {
  /** Template profession index: 0 = None, 1 = Warrior … 10 = Dervish. */
  id: number;
  name: string;
  nameDe: string;
  abbr: string;
}

export interface Attribute {
  /**
   * Template attribute index (0 = Fast Casting … 44 = Mysticism).
   * Ids >= 100 are non-template attributes: 101 = No Attribute,
   * 102-109 = PvE title tracks (Sunspear, Lightbringer, ...).
   */
  id: number;
  name: string;
  nameDe: string;
  /** Primary attributes are only available on the primary profession. */
  isPrimary: boolean;
  /** 0 for common / title-track attributes. */
  professionId: number;
  /** Maximum achievable rank including bonuses (21 for regular attributes). */
  max: number;
}

export interface SkillType {
  id: number;
  name: string;
}

export interface Skill {
  /** Template skill id (the id encoded in template codes). */
  id: number;
  name: string;
  description: string;
  campaignId: number;
  /** 0 = no profession (common / PvE-only skills). */
  professionId: number;
  /** 101 = no attribute; 102-109 = PvE title tracks. */
  attributeId: number;
  elite: boolean;
  /** True for the separate "(PvP)" version of a split skill. */
  isPvpVersion: boolean;
  /** True if the skill has a separate PvP version; splitId points to it. */
  pvpSplit: boolean;
  splitId: number;
  typeId: number;
  upkeep: number;
  energy: number;
  activation: number;
  recharge: number;
  adrenaline: number;
  sacrifice: number;
  overcast: number;
}

export interface Hero {
  /** GWCA HeroID enum value — matches the ids in AccountExport plugin output. */
  id: number;
  name: string;
  professionId: number;
  campaignId: number;
  /** Curated, coarse-grained unlock description. Verify against the wiki before relying on specifics. */
  unlock: string;
}

/**
 * Attribute id landmarks (see the Attribute doc above). These are game
 * constants, owned here so consumers never hardcode them.
 */
/** Highest attribute id storable in a template code (44 = Mysticism). */
export const MAX_TEMPLATE_ATTRIBUTE_ID = 44;
/** The "No Attribute" pseudo-attribute carried by attribute-less skills. */
export const NO_ATTRIBUTE_ID = 101;
/** First PvE title-track id (102 = Sunspear; ranks come from account progress). */
export const TITLE_TRACK_MIN_ID = 102;
