import { describe, expect, it } from "vitest";
import {
  getAttributeById,
  getAttributeByName,
  getCampaignById,
  getCampaignByName,
  getHeroByName,
  getProfessionById,
  getProfessionByName,
  getSkillById,
  getSkillByName,
  heroes,
  searchSkills,
  skills,
  suggestAttributeNames,
  suggestSkillNames,
} from "../src/index.js";

describe("upstream-integrity invariants (GW1-13)", () => {
  // These lock structural properties that a compromised or mis-parsed upstream
  // could break while still passing the coarse count/name checks below. They
  // don't validate game-correctness (that's the codec/validator corpus) —
  // they assert the dataset is internally consistent.
  it("every skill id is unique", () => {
    const ids = skills.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("every hero id is unique", () => {
    const ids = heroes.map((h) => h.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("every skill's foreign keys resolve", () => {
    for (const s of skills) {
      expect(getProfessionById(s.professionId), `skill ${s.id} profession`).toBeDefined();
      expect(getAttributeById(s.attributeId), `skill ${s.id} attribute`).toBeDefined();
      expect(getCampaignById(s.campaignId), `skill ${s.id} campaign`).toBeDefined();
    }
  });
  it("every hero's foreign keys resolve", () => {
    for (const h of heroes) {
      expect(getProfessionById(h.professionId), `hero ${h.id} profession`).toBeDefined();
      expect(getCampaignById(h.campaignId), `hero ${h.id} campaign`).toBeDefined();
    }
  });
  it("numeric skill fields stay within sane ranges", () => {
    for (const s of skills) {
      expect(s.id, `skill ${s.id} id`).toBeGreaterThan(0);
      expect(s.energy, `skill ${s.id} energy`).toBeGreaterThanOrEqual(0);
      expect(s.recharge, `skill ${s.id} recharge`).toBeGreaterThanOrEqual(0);
      expect(s.activation, `skill ${s.id} activation`).toBeGreaterThanOrEqual(0);
    }
  });
  it("pvpSplit and splitId agree bidirectionally", () => {
    for (const s of skills) {
      if (s.splitId) {
        expect(getSkillById(s.splitId), `skill ${s.id} splitId target`).toBeDefined();
      }
    }
  });
});

describe("data integrity", () => {
  it("has the full player skill set", () => {
    expect(skills.length).toBeGreaterThan(1400); // includes separate (PvP) versions
  });

  it("resolves the template profession index", () => {
    expect(getProfessionById(10)?.name).toBe("Dervish");
    expect(getProfessionById(1)?.name).toBe("Warrior");
  });

  it("resolves the template attribute index", () => {
    expect(getAttributeById(44)?.name).toBe("Mysticism");
    expect(getAttributeById(16)?.name).toBe("Divine Favor");
    expect(getAttributeById(44)?.isPrimary).toBe(true);
  });

  it("uses skilldata campaign indexing (0 = Core)", () => {
    expect(getCampaignById(0)?.name).toBe("Core");
    expect(getCampaignById(3)?.name).toBe("Nightfall");
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

describe("name uniqueness invariant", () => {
  it("normalized skill names are bijective (a collision would silently shadow a skill)", () => {
    // The name Maps overwrite on collision; nothing else would fail loudly if
    // the weekly upstream import ever introduced two names that normalize to
    // the same key. This makes that invariant a test failure instead.
    for (const skill of skills) {
      expect(getSkillByName(skill.name)?.id, `"${skill.name}"`).toBe(skill.id);
    }
  });

  it("normalized hero names are bijective", () => {
    for (const hero of heroes) {
      expect(getHeroByName(hero.name)?.id, `"${hero.name}"`).toBe(hero.id);
    }
  });
});

describe("entity lookups (both twins per entity)", () => {
  it("resolves professions, campaigns and attributes by name (normalized) and id", () => {
    expect(getProfessionByName("dervish")?.id).toBe(10);
    expect(getCampaignByName("NIGHTFALL")?.name).toBe("Nightfall");
    expect(getAttributeByName("mysticism")?.name).toBe("Mysticism");
    expect(getProfessionById(10)?.name).toBe("Dervish");
    expect(getAttributeById(44)?.name).toBe("Mysticism");
  });

  it("suggests close attribute names on a misspelling (LLM self-correction path)", () => {
    expect(suggestAttributeNames("Mystiscism")).toContain("Mysticism");
  });
});
