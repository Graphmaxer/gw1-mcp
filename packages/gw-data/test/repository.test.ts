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
  normalizeName,
} from "../src/index.js";
import frenchNamesJson from "../data/skill-names-fr.json";

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

  it("answers a French query with the RIGHT English skill, not a plausible wrong one", () => {
    // This test used to assert the opposite — [] for every French query — and that
    // was the correct answer while nothing here knew any French: "Signet de
    // guérison" sat 7 edits from the WRONG "Signet of Creation", so three real
    // English signets would have made an LLM encode a valid-but-wrong template.
    //
    // Now the French names are indexed, the same queries have a right answer, and
    // giving it is strictly better than refusing. What must NOT come back is a
    // confident wrong one, so each case below pins the skill, never merely
    // "something".
    expect(suggestSkillNames("Régénération mystique")).toEqual(["Mystic Regeneration"]);
    // A hybrid the caller half-translated ("Signet" is English, the rest French).
    // No French name matches it exactly, so this goes through the bounded fuzzy
    // pass and the right answer has to be IN the list — it ranks third behind two
    // other "... de guérison" skills at a smaller edit distance, which is what a
    // three-candidate list is for.
    expect(suggestSkillNames("Signet de guérison")).toContain("Healing Signet");
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

  it("does not let prefix matching or the French pass reopen the padding cases", () => {
    // The French pass is a SECOND O(n*m) scan, so every DoS guard has to hold on it
    // too — it runs precisely when the English pass found nothing, which is what a
    // padding attack looks like. Measured after wiring it: 0.48 ms for the 64-char
    // case and 1.83 ms for the worst real query (both passes running), against the
    // 10 ms per-request cap.
    expect(suggestSkillNames("z".repeat(64))).toEqual([]);
    expect(suggestSkillNames("q".repeat(32))).toEqual([]);
    expect(suggestSkillNames("zzzzzzzz")).toEqual([]);
  });

  it("still reaches the cognate case, now through the French names", () => {
    // MAX_SUGGEST_DISTANCE is 5 because of this one query: "Vœu de piété" was 5
    // edits from the ENGLISH "Vow of Piety", and the cap was set to the widest value
    // that kept it while still dropping French noise. That reasoning is obsolete —
    // the query now matches the FRENCH name at distance 2, so the cap no longer has
    // to stand in for a dictionary.
    //
    // The cap is deliberately NOT tightened on that news: it was measured against
    // real English misspellings too, and re-picking it from this one datum is how a
    // calibrated number becomes a guessed one.
    //
    // The unaccented spelling resolves EXACTLY, the ligature spelling resolves via
    // one suggestion. See normalize.ts for why there is no œ -> oe fold: it costs
    // ~10% on the hottest function in the package and buys an exact hit on 18 names
    // that already come back correctly here.
    expect(getSkillByName("Voeu de piété")?.name).toBe("Vow of Piety");
    expect(getSkillByName("Vœu de piété")).toBeUndefined();
    expect(suggestSkillNames("Vœu de piété")).toContain("Vow of Piety");
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
  //
  // The message matters as much as the assertion. This check has now fired twice on
  // a data PR for a cause three packages away — 2026-08-10 (README was hand-kept, so
  // the first legitimate count change red the weekly job) and 2026-08-31 (the import
  // rewrites README, but update-data.yml's path-scoped patch dropped the file before
  // the open-pr job saw it). Both times the reasonable reading was "this lock is
  // counterproductive", and both times the lock was right and the PIPELINE was half
  // wired. So it now names the two things to check, in order of likelihood.
  it("README.md quotes the real skill count", () => {
    const quoted = quotedCounts(read("../../../README.md"));
    expect(quoted.length).toBeGreaterThan(0);
    for (const count of quoted) {
      expect(
        count,
        "README.md is GENERATED for this number (syncReadmeSkillCount) — do not edit it by hand. " +
          "On a data PR this failing means the rewrite did not survive the pipeline: check that " +
          "README.md is in the `git diff` path list that update-data.yml turns into data-update.patch " +
          "(locked by provenance-cli.test.ts). Locally, re-run the import.",
      ).toBe(skills.length);
    }
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

describe("French skill names (data/skill-names-fr.json)", () => {
  const frenchNames = frenchNamesJson as Record<string, string>;

  it("resolves a French name, accented or not", () => {
    expect(getSkillByName("Sceau de guérison")?.name).toBe("Healing Signet");
    // normalizeName strips diacritics, so an unaccented keyboard works.
    expect(getSkillByName("sceau de guerison")?.name).toBe("Healing Signet");
    expect(getSkillByName("Mantra de la terre")?.id).toBe(6);
    expect(getSkillByName("Voeu de révolution")?.name).toBe("Vow of Revolution");
  });

  it("hands the 18 ligature names to the suggester rather than taxing every lookup", () => {
    // Upstream writes all 18 "oe" names with the digraph and none with a ligature
    // (Vœu, Cœur, Chœur, Œil, bœuf, Mœbius). A caller typing the typographically
    // correct ligature therefore MISSES the exact index — NFD does not decompose œ,
    // so the strip deletes it — and lands 2 edits from the French name instead.
    //
    // This is the trade normalize.ts documents, asserted rather than assumed: the
    // right answer must actually come back, or dropping the fold would be a
    // regression rather than a cost saving.
    for (const [typed, expected] of [
      ["Vœu du silence", "Vow of Silence"],
      ["œil critique", "Critical Eye"],
      ["Frappe de Mœbius", "Moebius Strike"],
      ["Cœur de furie", "Heart of Fury"],
      ["Cornes du bœuf", "Horns of the Ox"],
    ] as const) {
      expect(getSkillByName(typed), typed).toBeUndefined();
      expect(suggestSkillNames(typed), typed).toContain(expected);
    }
  });

  it("NEVER changes what an English name resolves to (whole dataset)", () => {
    // The load-bearing invariant. English names are the primary key, so this sweep
    // is what makes "French can only ADD a way to reach a skill" a fact rather than
    // an intention — one alias overwriting one English key would be a silently
    // wrong answer in the tool everything else is built on.
    for (const skill of skills) {
      expect(getSkillByName(skill.name)?.id, `"${skill.name}"`).toBe(skill.id);
    }
  });

  it("keeps the English skill when a French name IS an English name", () => {
    // "Récupération" is the French name of Recovery (1748) and normalises to
    // `recuperation`, the English name of a DIFFERENT skill (981). English wins.
    // The cost is real and accepted: a caller typing the French name of Recovery
    // receives Recuperation, because a single-answer lookup cannot serve both and
    // silently redefining an English name is the worse of the two failures.
    expect(normalizeName(frenchNames["1748"]!)).toBe(normalizeName("Recuperation"));
    expect(getSkillByName("Récupération")?.id).toBe(981);
    expect(getSkillByName("Recuperation")?.id).toBe(981);
  });

  it("refuses to guess when several skills share a French name, and suggests all of them", () => {
    // "Rafale" is the French name of BOTH Flurry (344) and Gust (843). A Map would
    // have kept whichever was inserted last — a coin flip presented as a fact.
    expect(frenchNames["344"]).toBe("Rafale");
    expect(frenchNames["843"]).toBe("Rafale");
    expect(getSkillByName("Rafale")).toBeUndefined();
    expect(suggestSkillNames("Rafale")).toEqual(["Flurry", "Gust"]);
    expect(suggestSkillNames("Attaque féroce")).toEqual(["Ferocious Strike", "Fierce Blow"]);
  });

  it("names every committed skill, and nothing that is not one", () => {
    // A stale table is the expected failure mode, not a corrupt one: only the Pages
    // and clone channels serve French, so an npm-fallback run refreshes skills.json
    // and leaves this table alone (by design — see import.ts). This asserts the two
    // stay in step, which is what catches that drift instead of leaving it to be
    // noticed by a French lookup quietly returning nothing.
    const ids = new Set(skills.map((s) => s.id));
    for (const id of Object.keys(frenchNames)) {
      expect(ids.has(Number(id)), `id ${id} has a French name but no skill`).toBe(true);
    }
    expect(Object.keys(frenchNames).length).toBe(skills.length);
  });

  it("suffixes every French PvP name, like the English transform does", () => {
    // Without the suffix a PvP name collides with its own PvE form and BOTH skills
    // lose their exact lookup. Upstream currently gets this right on its own; the
    // English side already had to repair one missing suffix.
    for (const skill of skills.filter((s) => s.isPvpVersion)) {
      expect(frenchNames[String(skill.id)], `${skill.name}`).toContain("(PvP)");
    }
  });
});
