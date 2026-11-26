/**
 * Tests written from a mutation pass (2026-11-26, 261 hand-made mutants): each
 * one kills a small semantic change to the source that the suite let through
 * while reporting full line coverage. They assert exact values against the data
 * on purpose; a looser assertion is how each of these mutants survived.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  getAttributeByName,
  getCampaignByName,
  getSkillByName,
  searchSkills,
  skills,
  suggestAttributeNames,
  suggestHeroNames,
  suggestProfessionNames,
  suggestSkillNames,
} from "../src/index.js";
import { loadUpstream } from "../scripts/import/load.ts";
import {
  assertPlausibleDescription,
  canonicaliseUpstreamIds,
  transformSkills,
} from "../scripts/import/transform.ts";
import { writeImport } from "../scripts/import/write.ts";

describe("searchSkills: id 0 is a filter value, not an absent filter", () => {
  // Fast Casting is attribute 0 and Core is campaign 0. A truthiness check
  // (`!filters.attributeId`) returns the whole dataset for both.
  it("filters on attribute id 0 (Fast Casting) and campaign id 0 (Core)", () => {
    const playable = skills.filter((s) => !s.isPvpVersion);
    expect(getAttributeByName("Fast Casting")?.id).toBe(0);
    expect(getCampaignByName("Core")?.id).toBe(0);

    const fastCasting = playable.filter((s) => s.attributeId === 0);
    expect(fastCasting.length).toBeGreaterThan(0);
    expect(searchSkills({ attributeId: 0 }).map((s) => s.id)).toEqual(fastCasting.map((s) => s.id));

    const core = playable.filter((s) => s.campaignId === 0);
    expect(core.length).toBeGreaterThan(0);
    expect(core.length).toBeLessThan(playable.length);
    expect(searchSkills({ campaignId: 0 }).map((s) => s.id)).toEqual(core.map((s) => s.id));
  });
});

describe("suggestions: count, order, uniqueness, cap", () => {
  it("returns exactly `count` names when more candidates exist, shortest prefix match first", () => {
    // 10+ skills start with "heal"; the contract is the 3 closest, not 4.
    expect(suggestSkillNames("heal", 10).length).toBe(10);
    expect(suggestSkillNames("heal")).toEqual(["Heal Area", "Heal Other", "Heal Party"]);
    // Data order is not length order, so this fails if the prefix ranking is dropped.
    const dataOrder = skills.filter((s) => /^heal/i.test(s.name)).map((s) => s.name);
    expect(dataOrder.slice(0, 3)).not.toEqual(["Heal Area", "Heal Other", "Heal Party"]);
  });

  it("never lists one skill twice (a prefix match is not also scored by distance)", () => {
    const names = suggestSkillNames("healing signe", 10);
    expect(names[0]).toBe("Healing Signet");
    expect(new Set(names).size).toBe(names.length);
  });

  it("answers nothing at edit distance 6, and something at 5", () => {
    // No token-prefix match on either; only the distance cap decides.
    expect(suggestSkillNames("xxxxxmystic regeneration")).toContain("Mystic Regeneration");
    expect(suggestSkillNames("xxxxxxmystic regeneration")).toEqual([]);
  });

  it("refuses a 65-character query on every suggester and accepts 64", () => {
    const at = (n: number) => "heal".padEnd(n, " ");
    expect(suggestSkillNames(at(64)).length).toBeGreaterThan(0);
    expect(suggestSkillNames(at(65))).toEqual([]);
    expect(suggestAttributeNames("blood".padEnd(64, " "))[0]).toBe("Blood Magic");
    expect(suggestAttributeNames("blood".padEnd(65, " "))).toEqual([]);
    expect(suggestProfessionNames("mon".padEnd(64, " "))[0]).toBe("Monk");
    expect(suggestProfessionNames("mon".padEnd(65, " "))).toEqual([]);
    expect(suggestHeroNames("kos".padEnd(64, " "))[0]).toBe("Koss");
    expect(suggestHeroNames("kos".padEnd(65, " "))).toEqual([]);
  });

  it("resolves a name typed with doubled or padded whitespace", () => {
    expect(getSkillByName("  Healing   Signet ")?.name).toBe("Healing Signet");
  });
});

describe("transformSkills maps each upstream field to its own output field", () => {
  // Every value distinct, so a swap or a wrong source field cannot hide.
  const row = {
    id: 7,
    campaign: 3,
    profession: 4,
    attribute: 5,
    type: 6,
    is_elite: true,
    is_rp: false,
    is_pvp: false,
    pvp_split: true,
    split_id: 2999,
    upkeep: -1,
    energy: 15,
    activation: 2,
    recharge: 30,
    adrenaline: 8,
    sacrifice: 17,
    overcast: 9,
    name: "Aegis",
    description: "Long form.",
    concise: "Concise form.",
  };
  const upstream = (...rows: Record<string, unknown>[]) =>
    ({
      skilldata: Object.fromEntries(rows.map((r) => [r["id"], r])),
      skilldesc: Object.fromEntries(rows.map((r) => [r["id"], {}])),
    }) as unknown as Parameters<typeof transformSkills>[0];

  it("produces exactly this record", () => {
    expect(transformSkills(upstream(row))).toEqual([
      {
        id: 7,
        name: "Aegis",
        description: "Concise form.",
        campaignId: 3,
        professionId: 4,
        attributeId: 5,
        elite: true,
        isRoleplay: false,
        isPvpVersion: false,
        pvpSplit: true,
        splitId: 2999,
        typeId: 6,
        upkeep: -1,
        energy: 15,
        activation: 2,
        recharge: 30,
        adrenaline: 8,
        sacrifice: 17,
        overcast: 9,
      },
    ]);
  });

  it("reads is_rp and is_pvp into their own flags, and falls back to the long description", () => {
    const [skill] = transformSkills(
      upstream({
        ...row,
        is_elite: false,
        is_rp: true,
        is_pvp: true,
        pvp_split: false,
        concise: "",
      }),
    );
    expect(skill).toMatchObject({
      name: "Aegis (PvP)",
      elite: false,
      isRoleplay: true,
      isPvpVersion: true,
      pvpSplit: false,
      description: "Long form.",
    });
  });

  it("drops the id-0 sentinel, defaults a missing split id to 0, and sorts by id", () => {
    const out = transformSkills(
      upstream(
        { ...row, id: 9, name: "Bane Signet", split_id: undefined },
        { ...row, id: 0, name: "No Skill" },
        { ...row, id: 8, name: "Castigation Signet" },
      ),
    );
    expect(out.map((s) => [s.id, s.splitId])).toEqual([
      [8, 2999],
      [9, 0],
    ]);
  });
});

describe("canonicaliseUpstreamIds holds the template range at exactly 0-44", () => {
  const lang = (en: string) => ({ en, de: en });
  const attribute = (name: string) => ({ prof: 1, pri: false, max: 21, name: lang(name) });
  const source = (attributes: Record<string, unknown>) =>
    ({
      ATTRIBUTES: attributes,
      CAMPAIGNS: [],
      PROFESSIONS: [],
      SKILLTYPES: { 1: { name: lang("Skill") } },
      skilldata: {},
      skilldesc: {},
      version: "test",
    }) as unknown as Parameters<typeof canonicaliseUpstreamIds>[0];

  it("keeps 44 as is and refuses an unnamed 45", () => {
    const kept = canonicaliseUpstreamIds(source({ 44: attribute("Mysticism") }));
    expect(Object.keys(kept.ATTRIBUTES as object)).toEqual(["44"]);
    expect(() => canonicaliseUpstreamIds(source({ 45: attribute("Brand New Line") }))).toThrow(
      /outside the template\s+range/,
    );
  });

  it("refuses two upstream attributes that land on one stable id", () => {
    expect(() =>
      canonicaliseUpstreamIds(
        source({ 102: attribute("Sunspear Title Track"), 902: attribute("Sunspear Title Track") }),
      ),
    ).toThrow(/same stable id/);
  });
});

describe("writeImport", () => {
  it("replaces an existing provenance entry with the new one and keeps the others", () => {
    const dir = mkdtempSync(join(tmpdir(), "gw-write-"));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      writeFileSync(
        join(dir, "_meta.json"),
        JSON.stringify({ skills: { sourceVersion: "old" }, heroes: { generatedAt: "2026-01-01" } }),
      );
      writeImport(dir, [], { skills: { sourceVersion: "new" } });
      const text = readFileSync(join(dir, "_meta.json"), "utf8");
      expect(JSON.parse(text)).toEqual({
        skills: { sourceVersion: "new" },
        heroes: { generatedAt: "2026-01-01" },
      });
      // Generated-file convention: one-space indent plus a trailing newline.
      expect(text).toBe(JSON.stringify(JSON.parse(text), null, 1) + "\n");
    } finally {
      log.mockRestore();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("transformAttributes maps each upstream field to its own output field", () => {
  it("produces exactly this record", async () => {
    const { transformAttributes } = await import("../scripts/import/transform.ts");
    expect(
      transformAttributes({
        17: { prof: 3, pri: true, max: 21, name: { en: "Divine Favor", de: "x" } },
        18: { prof: 3, pri: false, max: 20, name: { en: "Healing Prayers", de: "x" } },
      }),
    ).toEqual([
      { id: 17, name: "Divine Favor", isPrimary: true, professionId: 3, max: 21 },
      { id: 18, name: "Healing Prayers", isPrimary: false, professionId: 3, max: 20 },
    ]);
  });
});

describe("import guards that only an unusual input reaches", () => {
  const lang = (en: string) => ({ en, de: en });

  it("refuses a bare www. address and any markup outside the three known tags", () => {
    expect(() => assertPlausibleDescription(1, "X", "Read more at www.example.org.")).toThrow(
      /contains a URL/,
    );
    for (const tag of ["<b>", "<i>", "<a>", "<br>", "<img>", "<script>", "<gray >", "</sic>"]) {
      expect(() => assertPlausibleDescription(1, "X", `Heal ${tag} for 5.`), tag).toThrow(
        /unexpected tag/,
      );
    }
    for (const tag of ["<gray>", "</gray>", "<sic/>"]) {
      expect(() => assertPlausibleDescription(1, "X", `Heal ${tag} for 5.`), tag).not.toThrow();
    }
  });

  it("leaves the empty-slot row alone, whose attribute is in no table", () => {
    // Upstream gives skill 0 the attribute -1. Remapping it like a real skill
    // throws "not in upstream's table" and stops every import.
    const upstream = {
      ATTRIBUTES: { 0: { prof: 5, pri: true, max: 21, name: lang("Fast Casting") } },
      CAMPAIGNS: [],
      PROFESSIONS: [],
      SKILLTYPES: {},
      skilldata: { 0: { id: 0, attribute: -1 }, 5: { id: 5, attribute: 0 } },
      skilldesc: {},
      version: "test",
    } as unknown as Parameters<typeof canonicaliseUpstreamIds>[0];
    const out = canonicaliseUpstreamIds(upstream).skilldata as Record<
      string,
      { attribute: number }
    >;
    expect(out["0"]!.attribute).toBe(-1);
    expect(out["5"]!.attribute).toBe(0);
  });

  it("treats an unreadable _meta.json as a fault, not as a first run", () => {
    // Only a MISSING file means "no record yet". Anything else swallowed as {}
    // would rewrite the file with this run's keys alone and drop the others.
    const dir = mkdtempSync(join(tmpdir(), "gw-write-"));
    try {
      mkdirSync(join(dir, "_meta.json"));
      const data = { path: join(dir, "skills.json"), content: "[]\n", summary: 0 };
      expect(() => writeImport(dir, [data], { skills: { sourceVersion: "new" } })).toThrow(
        /EISDIR/,
      );
      // And it is found BEFORE anything is written: the write of _meta.json
      // would fail on a directory too, but only after the data files were out.
      expect(existsSync(data.path)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reads an empty source argument as the npm package, like no argument", async () => {
    expect((await loadUpstream("")).version).toMatch(/^npm:/);
  });
});
