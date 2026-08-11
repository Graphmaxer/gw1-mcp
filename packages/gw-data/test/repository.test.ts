import { readFileSync } from "node:fs";
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
  getSkillType,
  heroes,
  searchSkills,
  skills,
  suggestAttributeNames,
  suggestProfessionNames,
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
    // This test only checked that the target EXISTS, despite its name — an
    // external audit verified the reciprocity by script on 2026-08-08 and asked
    // for it to be locked. Every pvpSplit must point at a real PvP version, and
    // that version must point back.
    let pairs = 0;
    for (const s of skills) {
      if (!s.pvpSplit) continue;
      const target = getSkillById(s.splitId);
      expect(target, `skill ${s.id} splitId target`).toBeDefined();
      expect(target?.isPvpVersion, `skill ${s.id} splits to a PvP version`).toBe(true);
      expect(target?.splitId, `skill ${s.id} split points back`).toBe(s.id);
      pairs++;
    }
    expect(pairs).toBe(skills.filter((s) => s.isPvpVersion).length);
  });
  it("every skill's typeId resolves", () => {
    // The other four foreign keys were covered; typeId was not, and it is the one
    // feeding the `type` field of every get_skill answer.
    for (const s of skills) {
      expect(getSkillType(s.typeId), `skill ${s.id} type`).toBeDefined();
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

  it("returns no suggestions for an oversized query (GW1-AUD-01 CPU guard)", () => {
    // A multi-kilobyte name must not trigger the O(n*m) scan over every skill.
    expect(suggestSkillNames("a".repeat(5000))).toEqual([]);
  });

  it("still resolves realistic misspellings after the distance cap", () => {
    expect(suggestSkillNames("mystik regenaration")[0]).toBe("Mystic Regeneration");
    expect(suggestSkillNames("Vow of Revoltion")[0]).toBe("Vow of Revolution");
    expect(suggestSkillNames("healing bréeze")[0]).toBe("Healing Breeze");
  });

  it("suggests nothing rather than a plausible wrong skill (GW1-AUD-01, FR names)", () => {
    // A French skill name is not a typo of an English one. Returning three real
    // English signets for "Signet de guérison" is what makes an LLM encode a
    // valid-but-wrong template; an empty list makes it ask or search instead.
    expect(suggestSkillNames("Signet de guérison")).toEqual([]);
    expect(suggestSkillNames("Régénération mystique")).toEqual([]);
    expect(suggestSkillNames("Souffle mystique")).toEqual([]);
  });

  it("suggests nothing for padding that merely fits the length cap", () => {
    // Under the length-only guard these returned real skills (e.g. "Verata's
    // Gaze") at ~109 ms CPU per request; the band now abandons them.
    expect(suggestSkillNames("z".repeat(64))).toEqual([]);
    expect(suggestSkillNames("q".repeat(32))).toEqual([]);
    expect(suggestSkillNames("zzzzzzzz")).toEqual([]);
  });

  it("resolves abbreviations, which are not typos", () => {
    // "Mystic Regen" is 6 edits from "Mystic Regeneration" — past the distance
    // cap — so distance alone dropped the right answer and let shorter, wrong
    // names win ("Mystic Sweep"), and "Vow of Rev" resolved to "Vow of Piety".
    expect(suggestSkillNames("Mystic Regen")[0]).toBe("Mystic Regeneration");
    expect(suggestSkillNames("Vow of Rev")[0]).toBe("Vow of Revolution");
    expect(suggestSkillNames("Signet of Cap")[0]).toBe("Signet of Capture");
    expect(suggestSkillNames("heal sig")[0]).toBe("Healing Signet");
  });

  it("does not let prefix matching reopen the French or padding cases", () => {
    expect(suggestSkillNames("Signet de guérison")).toEqual([]);
    expect(suggestSkillNames("Souffle mystique")).toEqual([]);
    expect(suggestSkillNames("z".repeat(64))).toEqual([]);
  });

  it("keeps a French form that resolves correctly by cognate", () => {
    // The threshold is calibrated to keep this one (d=5) while dropping the
    // wrong matches above — it is the boundary case that fixes the cap at 5.
    expect(suggestSkillNames("Vœu de piété")[0]).toBe("Vow of Piety");
  });

  it("suggests nothing for a query that normalises to nothing (audit M2)", () => {
    // distance("", candidate) is just the candidate's length, so before the
    // empty-needle guard every short skill name passed the cap and a Cyrillic,
    // CJK or punctuation-only query came back with three confident wrong
    // answers — "Возрождение" returned ["Awe", "Echo", "Gale"].
    for (const query of ["Возрождение", "回復", "!!!", "   ", "***", "😀"]) {
      expect(suggestSkillNames(query), query).toEqual([]);
      expect(suggestAttributeNames(query), query).toEqual([]);
    }
  });

  it("suggests professions, excluding the no-secondary sentinel (audit L7)", () => {
    // Added for the build-resolution errors, where a profession typo used to come
    // back bare. Id 0 ("none") is out of the index on purpose: it is short enough
    // to beat real names on distance ("Bard" put it ahead of Monk and Warrior)
    // and it is not a profession anyone means to type.
    expect(suggestProfessionNames("Paragorn")[0]).toBe("Paragon");
    expect(suggestProfessionNames("necromancr")[0]).toBe("Necromancer");
    expect(suggestProfessionNames("Bard")).not.toContain("none");
    expect(suggestProfessionNames("Bard").length).toBeGreaterThan(0);
    expect(suggestProfessionNames("Возрождение")).toEqual([]);
    expect(suggestProfessionNames("z".repeat(5000))).toEqual([]);
  });

  it("treats a nameContains that normalises to nothing as matching nothing (audit L8)", () => {
    // `includes("")` is true for every name, so this used to return the whole
    // non-PvP dataset presented as the results of a filter that matched nothing.
    expect(searchSkills({ nameContains: "!!!" })).toEqual([]);
    expect(searchSkills({ nameContains: "" })).toEqual([]);
    expect(searchSkills({ nameContains: "Возрождение" })).toEqual([]);
    // An ABSENT filter still returns everything — the two cases must stay distinct.
    expect(searchSkills({}).length).toBeGreaterThan(1000);
  });
});

describe("documented counts stay true (mechanical lock)", () => {
  // The skill count is quoted in prose and drifted to 1484 at an earlier import.
  // It changes only through the automated weekly import, so it can be checked
  // against the data instead of trusted to a human habit.
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
  const quotedCounts = (text: string) =>
    [...text.matchAll(/(\d{3,5}) (?:real )?skills/g)].map((m) => Number(m[1]));

  // README advertises the count on purpose, so here the count must exist AND be
  // right — that also keeps the check non-vacuous.
  it("README.md quotes the real skill count", () => {
    const quoted = quotedCounts(read("../../../README.md"));
    expect(quoted.length).toBeGreaterThan(0);
    for (const count of quoted) expect(count).toBe(skills.length);
  });

  // Everywhere else the rule is only "if you quote it, be right". Requiring a
  // count to be present was an accident of writing this check, and it fired
  // when the status section legitimately stopped quoting one.
  it("CLAUDE.md quotes no stale skill count", () => {
    for (const count of quotedCounts(read("../../../CLAUDE.md"))) {
      expect(count).toBe(skills.length);
    }
  });

  // Inverse lock for the submission kits. Their text is copy-pasted into public
  // store listings, and once published a description is part of a versioned
  // review snapshot: correcting a number there costs a scan -> review ->
  // republish cycle, triggered by nothing more than an upstream data import. So
  // the kits must not quote a count at all — the fix is to make the drift
  // impossible, not merely detectable. Tool and resource counts are fine and
  // stay: those change only deliberately, and already require a new review.
  // Every document whose text can end up in a public listing, not just the two that
  // existed when this lock was written. chatgpt-tool-justifications.md was added on
  // 2026-08-05 carrying "1485 skills" straight into text destined for the OpenAI
  // directory — the lock caught the kit but not the new file, so the list is the part
  // that rots. Add a document here the moment its prose is written to be pasted.
  for (const kit of [
    "../../../docs/claude-plugin-submission.md",
    "../../../docs/chatgpt-plugin-submission.md",
    "../../../docs/chatgpt-tool-justifications.md",
    "../../../docs/chatgpt-demo-recording.md",
  ] as const) {
    it(`${kit} quotes no skill count that could go stale`, () => {
      const offenders = [...read(kit).matchAll(/\b\d{3,5} (?:real )?skills\b/g)].map((m) => m[0]);
      expect(offenders).toEqual([]);
    });
  }
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
