declare module "@buildwars/gw-templates" {
  export class SkillTemplate {
    decode(template: string): {
      code: string;
      prof_pri: number;
      prof_sec: number;
      attributes: Record<string, number>;
      skills: number[];
    };
    encode(
      profPri: number,
      profSec: number,
      attributes: Record<number, number>,
      skills: number[],
    ): string;
  }
  export class PwndTemplate {
    decode(pwnd: string): Array<{
      skills: string;
      equipment: string;
      weaponsets: string[];
      player: string;
      description: string;
      flags: string;
    }>;
  }
  export class EquipmentTemplate {}
}
