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
   * Negative ids are PvE title tracks; -1 = No Attribute.
   */
  id: number;
  name: string;
  nameDe: string;
  abbr: string;
  /** Primary attributes are only available on the primary profession. */
  isPrimary: boolean;
  /** 0 for common / title-track attributes. */
  professionId: number;
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
  /** -1 = no attribute; negative = PvE title track. */
  attributeId: number;
  elite: boolean;
  playerUsable: boolean;
  /** True if the skill has a separate PvP version. */
  pvpSplit: boolean;
  typeId: number;
  upkeep: number;
  energy: number;
  activation: number;
  recharge: number;
  adrenaline: number;
  sacrifice: number;
  overcast: number;
}
