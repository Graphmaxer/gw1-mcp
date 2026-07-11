import { describe, expect, it } from "vitest";
import {
  getAttribute,
  getCampaign,
  getProfession,
  getSkillById,
  getSkillByName,
  searchSkills,
  skills,
  suggestSkillNames,
} from "../src/index.js";

describe("data integrity", () => {
  it("has the full player skill set", () => {
    expect(skills.length).toBeGreaterThan(1400); // includes separate (PvP) versions
  });

  it("resolves the template profession index", () => {
    expect(getProfession(10)?.name).toBe("Dervish");
    expect(getProfession(1)?.name).toBe("Warrior");
  });

  it("resolves the template attribute index", () => {
    expect(getAttribute(44)?.name).toBe("Mysticism");
    expect(getAttribute(16)?.name).toBe("Divine Favor");
    expect(getAttribute(44)?.isPrimary).toBe(true);
  });

  it("uses skilldata campaign indexing (0 = Core)", () => {
    expect(getCampaign(0)?.name).toBe("Core");
    expect(getCampaign(3)?.name).toBe("Nightfall");
    const balthazar = getSkillByName("Avatar of Balthazar");
    expect(balthazar?.campaignId).toBe(3);
    expect(balthazar?.elite).toBe(true);
  });
});

describe("lookups", () => {
  it("finds skills by id and by name (diacritics/case-insensitive)", () => {
    const skill = getSkillById(2);
    expect(skill?.name).toBe("Resurrection Signet");
    expect(getSkillByName("resurrection signet")?.id).toBe(2);
  });

  it("searches with combined filters", () => {
    const dervishElites = searchSkills({ professionId: 10, elite: true });
    expect(dervishElites.length).toBe(16); // 15 classic + Vow of Revolution (added by Reforged, 2026)
    expect(dervishElites.every((s) => s.elite && s.professionId === 10)).toBe(true);
  });

  it("suggests close names for typos", () => {
    expect(suggestSkillNames("Mystic Regenration")[0]).toBe("Mystic Regeneration");
  });
});
