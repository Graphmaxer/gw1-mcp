import {
  getAttributeById,
  getCampaignById,
  getProfessionById,
  getSkillById,
  getSkillByName,
  getSkillType,
  heroes,
  skills,
} from "@gw1-mcp/gw-data";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";

/**
 * What the tools ANSWER, checked against the data rather than against one name.
 *
 * Every case here is a mutant that survived the suite on 2026-11-13: the source
 * was broken on purpose (a filter deleted, an option hard-coded to false, two
 * fields swapped) and 451 tests stayed green, because the existing assertions
 * asked "does the output contain Avatar of Balthazar" where the contract is
 * "these 28 skills and no others". Expectations are DERIVED from gw-data, never
 * written out, so a weekly balance patch cannot red this file.
 */
async function connectedClient() {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "contract", version: "0.0.0" });
  await Promise.all([createServer().connect(serverTransport), client.connect(clientTransport)]);
  // Primed, like every real client: this arms the SDK's output-schema validators.
  await client.listTools();
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args });
  const content = result.content as { text: string }[];
  return JSON.parse(content[0]!.text);
}

const bar = (...names: string[]) => [...names, ...Array<null>(8 - names.length).fill(null)];
const codes = (issues: { code: string }[]) => issues.map((issue) => issue.code);
const playable = skills.filter((s) => !s.isPvpVersion);

describe("search_skills applies every filter it accepts", () => {
  it.each([
    [
      "attributeName",
      { attributeName: "Mysticism" },
      (s: (typeof skills)[number]) => s.attributeId === 44,
    ],
    [
      "campaignName",
      { campaignName: "Factions" },
      (s: (typeof skills)[number]) => s.campaignId === 2,
    ],
    ["elite: true", { elite: true }, (s: (typeof skills)[number]) => s.elite],
    ["elite: false", { elite: false }, (s: (typeof skills)[number]) => !s.elite],
    [
      "professionName",
      { professionName: "Monk" },
      (s: (typeof skills)[number]) => s.professionId === 3,
    ],
  ])("%s returns exactly the matching skills", async (_label, filter, keep) => {
    const expected = playable.filter(keep);
    // The ids the test hard-codes must mean what the filter says, or the oracle is wrong.
    expect(getAttributeById(44)?.name).toBe("Mysticism");
    expect(getCampaignById(2)?.name).toBe("Factions");
    expect(getProfessionById(3)?.name).toBe("Monk");
    expect(expected.length).toBeGreaterThan(0);
    expect(expected.length).toBeLessThan(playable.length);

    const client = await connectedClient();
    const found = await call(client, "search_skills", { ...filter, limit: 200 });
    expect(found.total).toBe(expected.length);
    expect(found.skills.map((s: { id: number }) => s.id)).toEqual(
      expected.slice(0, 200).map((s) => s.id),
    );
  });

  it("combines filters as an intersection", async () => {
    const client = await connectedClient();
    const found = await call(client, "search_skills", {
      professionName: "Dervish",
      campaignName: "Nightfall",
      elite: true,
      nameContains: "avatar",
    });
    const names = found.skills.map((s: { name: string }) => s.name);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      const skill = getSkillByName(name)!;
      expect(skill.elite, name).toBe(true);
      expect(getProfessionById(skill.professionId)?.name, name).toBe("Dervish");
      expect(getCampaignById(skill.campaignId)?.name, name).toBe("Nightfall");
      expect(name.toLowerCase(), name).toContain("avatar");
    }
  });
});

describe("list_heroes applies both filters", () => {
  it("by profession and by campaign, exactly", async () => {
    const client = await connectedClient();
    const monks = await call(client, "list_heroes", { professionName: "Monk" });
    expect(monks.heroes.map((h: { id: number }) => h.id)).toEqual(
      heroes.filter((h) => h.professionId === 3).map((h) => h.id),
    );
    expect(monks.total).toBeLessThan(heroes.length);

    const nightfall = await call(client, "list_heroes", { campaignName: "Nightfall" });
    const nightfallId = heroes.find((h) => h.name === "Koss")!.campaignId;
    expect(nightfall.heroes.map((h: { id: number }) => h.id)).toEqual(
      heroes.filter((h) => h.campaignId === nightfallId).map((h) => h.id),
    );
    expect(nightfall.total).toBeLessThan(heroes.length);
  });
});

describe("the build tools pass their options to the validator", () => {
  // Hard-coding forHero or forPvp to false inside either handler failed nothing.
  it.each(["validate_build", "encode_template"])("%s honours forHero and forPvp", async (tool) => {
    const client = await connectedClient();
    const build = { primary: "Warrior", attributes: [], skills: bar("Asuran Scan") };
    expect(codes((await call(client, tool, { ...build, forHero: true })).errors)).toEqual([
      "PVE_ONLY_ON_HERO",
    ]);
    expect(codes((await call(client, tool, { ...build, forPvp: true })).errors)).toEqual([
      "PVE_ONLY_ON_PVP_BUILD",
    ]);
    // And the same bar is fine for a PvE player, so the flags are what decided.
    const plain = await call(client, tool, build);
    expect(plain.errors ?? []).toEqual([]);
  });

  it.each(["validate_build", "encode_template"])("%s honours unlockedSkillIds", async (tool) => {
    const client = await connectedClient();
    const build = {
      primary: "Warrior",
      attributes: [{ attribute: "Tactics", rank: 12 }],
      skills: bar("Healing Signet"),
    };
    const healingSignet = getSkillByName("Healing Signet")!.id;
    const locked = await call(client, tool, { ...build, unlockedSkillIds: [healingSignet + 1] });
    expect(codes(locked.warnings)).toContain("SKILL_NOT_UNLOCKED");
    const unlocked = await call(client, tool, { ...build, unlockedSkillIds: [healingSignet] });
    expect(codes(unlocked.warnings)).not.toContain("SKILL_NOT_UNLOCKED");
    // An empty list is a list: nothing is unlocked, which is not "no list given".
    const none = await call(client, tool, { ...build, unlockedSkillIds: [] });
    expect(codes(none.warnings)).toContain("SKILL_NOT_UNLOCKED");
  });
});

describe("game rules at their boundaries", () => {
  it("accepts a profession-less skill on a dual-profession bar", async () => {
    // Resurrection Signet belongs to no profession. Every earlier fixture used
    // either no secondary or profession skills, so dropping the `professionId !== 0`
    // exemption raised PROFESSION_MISMATCH here and nothing noticed.
    const client = await connectedClient();
    const report = await call(client, "validate_build", {
      primary: "Warrior",
      secondary: "Monk",
      attributes: [],
      skills: bar("Resurrection Signet"),
    });
    expect(getSkillByName("Resurrection Signet")!.professionId).toBe(0);
    expect(report.errors).toEqual([]);
  });

  it("allows exactly 200 attribute points and refuses 201 or more", async () => {
    // 12/12/3 costs 97 + 97 + 6 = 200: the most common spread in the game, sitting
    // exactly on the limit. `>` versus `>=` is the whole rule.
    const client = await connectedClient();
    const spread = (third: number) => ({
      primary: "Dervish",
      secondary: "Monk",
      attributes: [
        { attribute: "Mysticism", rank: 12 },
        { attribute: "Scythe Mastery", rank: 12 },
        { attribute: "Earth Prayers", rank: third },
      ],
      skills: bar("Mystic Sweep", "Mystic Regeneration", "Sand Shards"),
    });
    expect(codes((await call(client, "validate_build", spread(3))).errors)).toEqual([]);
    const over = await call(client, "validate_build", spread(4));
    expect(codes(over.errors)).toEqual(["ATTRIBUTE_POINTS_EXCEEDED"]);
    // 97 + 97 + 10: the total in the message is the arithmetic a caller relies on.
    expect(over.errors[0].message).toContain("204 points");
  });

  it("never reports a PvP-version error for an unsplit skill", async () => {
    const client = await connectedClient();
    const report = await call(client, "validate_build", {
      primary: "Warrior",
      attributes: [],
      skills: bar("Healing Signet"),
      forPvp: true,
    });
    expect(codes(report.errors)).not.toContain("PVP_VERSION_IN_TEMPLATE");
    // ...and the rule does fire for a real PvP-version id, so the check above means something.
    const pvpVersion = skills.find((s) => s.isPvpVersion && s.professionId === 1)!;
    const bad = await call(client, "validate_build", {
      primary: "Warrior",
      attributes: [],
      skills: bar(pvpVersion.name),
      forPvp: true,
    });
    expect(codes(bad.errors)).toContain("PVP_VERSION_IN_TEMPLATE");
  });
});

describe("decoded records carry the data, field for field", () => {
  it("get_skill returns every stat of the record it found", async () => {
    // Swapping energy and recharge, or nulling attribute/campaign/type, survived:
    // the tests read `name` and nothing else.
    const client = await connectedClient();
    for (const name of ["Healing Signet", "Wounding Strike", "Meteor Shower"]) {
      const skill = getSkillByName(name)!;
      expect(await call(client, "get_skill", { name })).toEqual({
        id: skill.id,
        name: skill.name,
        elite: skill.elite,
        isRoleplay: skill.isRoleplay,
        energy: skill.energy,
        activation: skill.activation,
        recharge: skill.recharge,
        adrenaline: skill.adrenaline,
        sacrifice: skill.sacrifice,
        overcast: skill.overcast,
        upkeep: skill.upkeep,
        description: skill.description,
        isPvpVersion: skill.isPvpVersion,
        profession: getProfessionById(skill.professionId)!.name,
        attribute: getAttributeById(skill.attributeId)!.name,
        campaign: getCampaignById(skill.campaignId)!.name,
        type: getSkillType(skill.typeId)!.name,
      });
    }
    // The three were chosen so that a swap cannot hide: their stats differ pairwise.
    const meteor = getSkillByName("Meteor Shower")!;
    expect(new Set([meteor.energy, meteor.activation, meteor.recharge]).size).toBe(3);
  });

  it("decode_template describes each slot from its own skill, in bar order", async () => {
    const client = await connectedClient();
    const decoded = await call(client, "decode_template", { code: "OwpiMypMBg1cxcBAMBdmtIKAA" });
    expect(decoded.primary).toBe("Assassin");
    expect(decoded.secondary).toBe("Dervish");
    expect(decoded.attributes).toEqual([
      { attribute: "Critical Strikes", rank: 12 },
      { attribute: "Scythe Mastery", rank: 12 },
    ]);
    const ids: number[] = decoded.raw.skills;
    expect(ids).toHaveLength(8);
    // Every slot is described at its own position; an empty one has a null name.
    expect(decoded.skills.map((s: { slot: number }) => s.slot)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(decoded.skills.map((s: { name: string | null }) => s.name === null)).toEqual(
      ids.map((id) => id === 0),
    );
    const filled = decoded.skills.filter((s: { name: string | null }) => s.name !== null);
    expect(filled.length).toBeGreaterThan(5);
    for (const described of filled) {
      const skill = getSkillById(ids[described.slot - 1]!)!;
      expect(described).toEqual({
        slot: described.slot,
        name: skill.name,
        elite: skill.elite,
        isRoleplay: skill.isRoleplay,
        attribute: getAttributeById(skill.attributeId)!.name,
        energy: skill.energy,
        activation: skill.activation,
        recharge: skill.recharge,
        adrenaline: skill.adrenaline,
        sacrifice: skill.sacrifice,
        description: skill.description,
      });
    }
    expect(filled.filter((s: { elite: boolean }) => s.elite)).toHaveLength(1);
  });

  it("decode_template reports no secondary as null, not as a profession named None", async () => {
    const client = await connectedClient();
    const { code } = await call(client, "encode_template", {
      primary: "Warrior",
      attributes: [],
      skills: bar("Healing Signet"),
    });
    const decoded = await call(client, "decode_template", { code });
    expect(decoded.primary).toBe("Warrior");
    expect(decoded.secondary).toBeNull();
  });
});
