/**
 * Tests written from a mutation pass (2026-11-26, 261 hand-made mutants): each
 * one kills a small semantic change to the source that the suite let through
 * while reporting full line coverage. They assert exact values against the data
 * on purpose; a looser assertion is how each of these mutants survived.
 */
import {
  attributes,
  campaigns,
  professions,
  skillTypes,
  getAttributeById,
  getCampaignById,
  getProfessionById,
  getSkillByName,
  getSkillType,
  heroes,
  skills,
} from "@gw1-mcp/gw-data";
import { encodeTemplate } from "@gw1-mcp/gw-template";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { resolveNamedBuild } from "../src/build-io.js";
import { deriveEvent } from "../src/events.js";
import { fullHero } from "../src/results.js";
import { createServer } from "../src/server.js";
import { validateBuild } from "../src/validate.js";

async function connectedClient() {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "blindspots", version: "0.0.0" });
  await Promise.all([createServer().connect(serverTransport), client.connect(clientTransport)]);
  await client.listTools();
  return client;
}
async function raw(client: Client, name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content as { text: string }[])[0]!.text;
  return { isError: result.isError === true, text };
}
async function call(client: Client, name: string, args: Record<string, unknown>) {
  return JSON.parse((await raw(client, name, args)).text);
}
const bar = (...names: string[]) => [...names, ...Array<null>(8 - names.length).fill(null)];
const playable = skills.filter((s) => !s.isPvpVersion);
const id = (name: string) => getSkillByName(name)!.id;

describe("search_skills pages, plumbs includePvpVersions and reports each field", () => {
  it("offset walks the whole result set in pages of `limit`, default 50", async () => {
    const client = await connectedClient();
    const expected = playable.filter((s) => s.professionId === 3).map((s) => s.id);
    expect(expected.length).toBeGreaterThan(100);

    const firstDefault = await call(client, "search_skills", { professionName: "Monk" });
    expect(firstDefault.skills.map((s: { id: number }) => s.id)).toEqual(expected.slice(0, 50));

    const seen: number[] = [];
    for (let offset = 0; offset < expected.length; offset += 40) {
      const page = await call(client, "search_skills", {
        professionName: "Monk",
        limit: 40,
        offset,
      });
      expect(page.total).toBe(expected.length);
      expect(page.skills.length).toBe(Math.min(40, expected.length - offset));
      seen.push(...page.skills.map((s: { id: number }) => s.id));
    }
    expect(seen).toEqual(expected);
  });

  it("includePvpVersions: true adds the (PvP) versions, and only then", async () => {
    const client = await connectedClient();
    const withPvp = skills.filter((s) => s.professionId === 3 && s.elite);
    const without = withPvp.filter((s) => !s.isPvpVersion);
    expect(withPvp.length).toBeGreaterThan(without.length);
    const args = { professionName: "Monk", elite: true, limit: 200 };
    expect((await call(client, "search_skills", args)).total).toBe(without.length);
    expect(
      (await call(client, "search_skills", { ...args, includePvpVersions: true })).skills.map(
        (s: { id: number }) => s.id,
      ),
    ).toEqual(withPvp.map((s) => s.id));
  });

  it("filters on the id-0 attribute and campaign (Fast Casting, Core)", async () => {
    const client = await connectedClient();
    const fc = await call(client, "search_skills", { attributeName: "Fast Casting", limit: 200 });
    expect(fc.skills.map((s: { id: number }) => s.id)).toEqual(
      playable.filter((s) => s.attributeId === 0).map((s) => s.id),
    );
    const core = await call(client, "search_skills", { campaignName: "Core", limit: 1 });
    expect(core.total).toBe(playable.filter((s) => s.campaignId === 0).length);
  });

  it("each summary record carries its own skill's fields", async () => {
    const client = await connectedClient();
    const found = await call(client, "search_skills", {
      professionName: "Elementalist",
      limit: 200,
    });
    const expected = playable
      .filter((s) => s.professionId === 6)
      .map((s) => ({
        id: s.id,
        name: s.name,
        elite: s.elite,
        profession: getProfessionById(s.professionId)!.name,
        attribute: getAttributeById(s.attributeId)!.name,
        campaign: getCampaignById(s.campaignId)!.name,
        energy: s.energy,
        adrenaline: s.adrenaline,
        activation: s.activation,
        recharge: s.recharge,
      }));
    expect(found.skills).toEqual(expected);
    // The oracle can tell the fields apart: values differ within one record.
    expect(expected.some((s) => s.activation !== s.recharge && s.energy !== s.recharge)).toBe(true);
    expect(new Set(expected.map((s) => s.campaign)).size).toBeGreaterThan(1);
  });

  it("a search shows what an adrenaline skill costs, not a free skill", async () => {
    // Elementalists have no adrenaline skill, so the record test above cannot
    // tell this field from a constant 0. Eviscerate costs 8 strikes and no energy.
    const client = await connectedClient();
    const found = await call(client, "search_skills", { nameContains: "eviscerate" });
    const eviscerate = getSkillByName("Eviscerate")!;
    expect(eviscerate).toMatchObject({ energy: 0, adrenaline: 8 });
    expect(found.skills[0]).toMatchObject({ name: "Eviscerate", energy: 0, adrenaline: 8 });
  });

  it("holds limit to 1-200", async () => {
    const client = await connectedClient();
    for (const limit of [0, 201]) {
      const refused = await raw(client, "search_skills", { limit });
      expect(refused.isError, String(limit)).toBe(true);
      expect(refused.text, String(limit)).toMatch(/limit/);
    }
    expect((await call(client, "search_skills", { limit: 200 })).skills).toHaveLength(200);
    expect((await call(client, "search_skills", { limit: 1 })).skills).toHaveLength(1);
  });
});

describe("full records: the fields the three-skill sample could not tell apart", () => {
  // Healing Signet, Wounding Strike and Meteor Shower all have adrenaline 0 or
  // sacrifice 0, isRoleplay false and isPvpVersion false, so swapping those passed.
  const full = (name: string) => {
    const s = getSkillByName(name)!;
    return {
      id: s.id,
      name: s.name,
      elite: s.elite,
      isRoleplay: s.isRoleplay,
      energy: s.energy,
      activation: s.activation,
      recharge: s.recharge,
      adrenaline: s.adrenaline,
      sacrifice: s.sacrifice,
      overcast: s.overcast,
      upkeep: s.upkeep,
      description: s.description,
      isPvpVersion: s.isPvpVersion,
      profession: getProfessionById(s.professionId)!.name,
      attribute: getAttributeById(s.attributeId)!.name,
      campaign: getCampaignById(s.campaignId)!.name,
      type: getSkillType(s.typeId)!.name,
    };
  };

  it("get_skill reports adrenaline, sacrifice and isRoleplay from their own fields", async () => {
    const client = await connectedClient();
    expect(getSkillByName("Battle Rage")).toMatchObject({ adrenaline: 4, sacrifice: 0 });
    expect(getSkillByName("Blood Renewal")).toMatchObject({ adrenaline: 0, sacrifice: 15 });
    expect(getSkillByName("Lightbringer Signet")).toMatchObject({
      isRoleplay: true,
      isPvpVersion: false,
      elite: false,
    });
    for (const name of ["Battle Rage", "Blood Renewal", "Lightbringer Signet"]) {
      expect(await call(client, "get_skill", { name }), name).toEqual(full(name));
    }
  });

  it("decode_template reports adrenaline and sacrifice from their own fields", async () => {
    const client = await connectedClient();
    const code = encodeTemplate({
      primary: 1,
      secondary: 4,
      attributes: [],
      skills: [id("Battle Rage"), id("Blood Renewal"), 0, 0, 0, 0, 0, 0],
    });
    const decoded = await call(client, "decode_template", { code });
    expect(decoded.skills[0]).toMatchObject({ name: "Battle Rage", adrenaline: 4, sacrifice: 0 });
    expect(decoded.skills[1]).toMatchObject({
      name: "Blood Renewal",
      adrenaline: 0,
      sacrifice: 15,
    });
  });

  it("get_hero returns every field of every hero, names resolved from the right id", async () => {
    const client = await connectedClient();
    // At least one hero whose profession id and campaign id differ, or a mix-up hides.
    expect(heroes.some((h) => h.professionId !== h.campaignId)).toBe(true);
    for (const hero of heroes) {
      expect(await call(client, "get_hero", { id: hero.id }), hero.name).toEqual({
        id: hero.id,
        name: hero.name,
        professionId: hero.professionId,
        campaignId: hero.campaignId,
        unlock: hero.unlock,
        profession: getProfessionById(hero.professionId)!.name,
        campaign: getCampaignById(hero.campaignId)!.name,
      });
    }
  });

  it("get_skill by an unknown id is NOT_FOUND", async () => {
    const client = await connectedClient();
    const miss = await raw(client, "get_skill", { id: 65000 });
    expect(miss.isError).toBe(true);
    expect(JSON.parse(miss.text).error.code).toBe("NOT_FOUND");
  });
});

describe("decode_pawned_team numbers slots from 1 and caps them at 12", () => {
  const blob = (payload: string) => `pwnd0001?download pawned2 >${payload}<`;
  // An all-'A' payload is a run of zero-length fields; find how many characters make one slot.
  const slotsFor = async (client: Client, chars: number) => {
    const res = await raw(client, "decode_pawned_team", { pwnd: blob("A".repeat(chars)) });
    return res.isError ? res.text : (JSON.parse(res.text).builds as { slot: number }[]);
  };

  it("accepts exactly 12 slots and refuses 13", async () => {
    const client = await connectedClient();
    let twelve: number | undefined;
    let thirteen: number | undefined;
    for (let chars = 1; chars < 2000 && thirteen === undefined; chars++) {
      const out = await slotsFor(client, chars);
      if (typeof out === "string") {
        if (twelve !== undefined && out.includes("TOO_MANY_SLOTS")) thirteen = chars;
      } else if (out.length === 12) twelve ??= chars;
    }
    expect(twelve, "a payload that parses into 12 slots").toBeDefined();
    expect(thirteen, "the first longer payload that is refused").toBeDefined();
    const refused = await slotsFor(client, thirteen!);
    expect(refused).toContain("Blob declares 13 slots");

    const res = JSON.parse(
      (await raw(client, "decode_pawned_team", { pwnd: blob("A".repeat(twelve!)) })).text,
    );
    expect(res.builds.map((b: { slot: number }) => b.slot)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
    // An empty slot code is a codec error, reported under the codec's own code.
    expect(res.builds[0]).toMatchObject({
      inGamePlayerName: null,
      equipmentCode: null,
      error: { code: "TRUNCATED" },
    });
  });
});

describe("validator: slot numbers, boundaries and single reports", () => {
  const template = (over: Partial<Parameters<typeof validateBuild>[0]>) => ({
    primary: 1,
    secondary: 0,
    attributes: [],
    skills: [0, 0, 0, 0, 0, 0, 0, 0],
    ...over,
  });
  const messages = (report: ReturnType<typeof validateBuild>, code: string) =>
    [...report.errors, ...report.warnings].filter((i) => i.code === code).map((i) => i.message);

  it("names the 1-based slot in every per-slot message", () => {
    // Each offender sits in the THIRD slot (index 2).
    const third = (skill: number) => [0, 0, skill, 0, 0, 0, 0, 0];
    const pvpVersion = skills.find((s) => s.isPvpVersion && s.professionId === 1)!;
    const cases: [string, ReturnType<typeof validateBuild>][] = [
      ["UNKNOWN_SKILL", validateBuild(template({ skills: third(65000) }))],
      ["PROFESSION_MISMATCH", validateBuild(template({ skills: third(id("Meteor Shower")) }))],
      [
        "SKILL_NOT_UNLOCKED",
        validateBuild(template({ skills: third(id("Healing Signet")) }), { unlockedSkillIds: [] }),
      ],
      ["UNALLOCATED_ATTRIBUTE", validateBuild(template({ skills: third(id("Healing Signet")) }))],
      [
        "PVE_ONLY_ON_HERO",
        validateBuild(template({ skills: third(id("Lightbringer Signet")) }), { forHero: true }),
      ],
      [
        "PVE_ONLY_ON_PVP_BUILD",
        validateBuild(template({ skills: third(id("Lightbringer Signet")) }), { forPvp: true }),
      ],
      ["PVP_VERSION_IN_TEMPLATE", validateBuild(template({ skills: third(pvpVersion.id) }))],
    ];
    for (const [code, report] of cases) {
      const found = messages(report, code);
      expect(found, code).toHaveLength(1);
      expect(found[0], code).toMatch(/^Slot 3: /);
    }
  });

  it("reports a duplicated skill once, not once per copy", () => {
    const hs = id("Healing Signet");
    const report = validateBuild(template({ skills: [hs, 0, hs, 0, hs, 0, 0, 0] }));
    expect(messages(report, "DUPLICATE_SKILL")).toHaveLength(1);
    expect(messages(report, "DUPLICATE_SKILL")[0]).toContain("slots 1, 3, 5");
  });

  it("warns UNALLOCATED_ATTRIBUTE for the last template attribute too (Mysticism, id 44)", () => {
    const skill = playable.find((s) => s.attributeId === 44)!;
    const report = validateBuild(
      template({ primary: 10, skills: [skill.id, 0, 0, 0, 0, 0, 0, 0] }),
    );
    expect(messages(report, "UNALLOCATED_ATTRIBUTE")).toHaveLength(1);
  });

  it("does not call a rank-0 line unused, nor repeat the warning for a repeated line", () => {
    const tactics = { attributeId: 21, rank: 0 };
    expect(getAttributeById(21)).toMatchObject({ professionId: 1, isPrimary: false });
    expect(validateBuild(template({ attributes: [tactics] })).warnings).toEqual([]);
    const twice = validateBuild(
      template({
        attributes: [
          { attributeId: 21, rank: 5 },
          { attributeId: 21, rank: 5 },
        ],
      }),
    );
    expect(messages(twice, "UNUSED_ATTRIBUTE")).toHaveLength(1);
  });

  it("says one thing about a title track, and tells it from the no-attribute sentinel", () => {
    const title = validateBuild(template({ attributes: [{ attributeId: 102, rank: 15 }] }));
    expect(title.errors.map((e) => e.code)).toEqual(["ATTRIBUTE_NOT_TEMPLATABLE"]);
    expect(title.errors[0]!.message).toContain("PvE title track");
    expect(title.warnings).toEqual([]);
    const none = validateBuild(template({ attributes: [{ attributeId: 101, rank: 1 }] }));
    expect(none.errors[0]!.message).toContain("not an attribute line");
    expect(none.errors[0]!.message).not.toMatch(/title/i);
  });

  it("reports a profession-less header as NO_PRIMARY only", () => {
    const report = validateBuild(template({ primary: 0 }));
    expect(report.errors.map((e) => e.code)).toEqual(["NO_PRIMARY"]);
  });

  it("does not add the player-bar PvE cap to a hero bar", () => {
    const pve = playable.filter((s) => s.isRoleplay && s.professionId === 0).slice(0, 4);
    expect(pve).toHaveLength(4);
    const report = validateBuild(template({ skills: [...pve.map((s) => s.id), 0, 0, 0, 0] }), {
      forHero: true,
    });
    expect(new Set(report.errors.map((e) => e.code))).toEqual(new Set(["PVE_ONLY_ON_HERO"]));
  });
});

describe("build resolution", () => {
  it("suggests for the SECONDARY name when the secondary is the unknown one", () => {
    const result = resolveNamedBuild({
      primary: "Warrior",
      secondary: "Mesmr",
      attributes: [],
      skills: bar(),
    });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ code: "UNKNOWN_PROFESSION" });
    expect(result.errors[0]!.suggestions?.[0]).toBe("Mesmer");
  });

  it("treats a whitespace-only secondary or skill as absent", () => {
    const result = resolveNamedBuild({
      primary: "Warrior",
      secondary: "  ",
      attributes: [],
      skills: ["   ", ...bar().slice(1)],
    });
    expect(result.errors).toEqual([]);
    expect(result.template).toMatchObject({ secondary: 0, skills: [0, 0, 0, 0, 0, 0, 0, 0] });
  });
});

describe("input bounds sit exactly where the schema says", () => {
  const build = { primary: "Warrior", attributes: [], skills: bar("Healing Signet") };
  const cases: [string, string, Record<string, unknown>, Record<string, unknown>][] = [
    ["get_skill name 64/65", "get_skill", { name: "x".repeat(64) }, { name: "x".repeat(65) }],
    ["get_skill id 65535/65536", "get_skill", { id: 65535 }, { id: 65536 }],
    [
      "build primary 64/65",
      "validate_build",
      { ...build, primary: "x".repeat(64) },
      { ...build, primary: "x".repeat(65) },
    ],
    [
      "build skill name 64/65",
      "validate_build",
      { ...build, skills: bar("x".repeat(64)) },
      { ...build, skills: bar("x".repeat(65)) },
    ],
    [
      "encode unlockedSkillIds 8192/8193",
      "encode_template",
      { ...build, unlockedSkillIds: Array(8192).fill(1) },
      { ...build, unlockedSkillIds: Array(8193).fill(1) },
    ],
    [
      "rank 12/13",
      "validate_build",
      { ...build, attributes: [{ attribute: "Tactics", rank: 12 }] },
      { ...build, attributes: [{ attribute: "Tactics", rank: 13 }] },
    ],
    [
      "attributes 15/16",
      "validate_build",
      { ...build, attributes: Array(15).fill({ attribute: "Tactics", rank: 0 }) },
      { ...build, attributes: Array(16).fill({ attribute: "Tactics", rank: 0 }) },
    ],
    [
      "template code 128/129",
      "decode_template",
      { code: "A".repeat(128) },
      { code: "A".repeat(129) },
    ],
    [
      "pwnd blob 8192/8193",
      "decode_pawned_team",
      { pwnd: "x".repeat(8192) },
      { pwnd: "x".repeat(8193) },
    ],
  ];
  it.each(cases)("%s", async (_label, tool, inside, outside) => {
    const client = await connectedClient();
    const SCHEMA_REFUSAL = /Input validation error|Invalid arguments/;
    const ok = await raw(client, tool, inside);
    expect(ok.text).not.toMatch(SCHEMA_REFUSAL);
    const refused = await raw(client, tool, outside);
    expect(refused.isError).toBe(true);
    expect(refused.text).toMatch(SCHEMA_REFUSAL);
  });
});

describe("tool events", () => {
  it("carries the FIRST validation code and the unlockedSkillIds flag", () => {
    const event = deriveEvent(
      "validate_build",
      { unlockedSkillIds: [1] },
      { structuredContent: { errors: [{ code: "MULTIPLE_ELITES" }, { code: "DUPLICATE_SKILL" }] } },
    );
    expect(event).toEqual({
      tool: "validate_build",
      ok: true,
      code: "MULTIPLE_ELITES",
      flags: ["unlockedSkillIds"],
    });
  });
});

describe("resources carry the whole tables, not a sample of them", () => {
  const read = async (uri: string) => {
    const client = await connectedClient();
    const { contents } = await client.readResource({ uri });
    return JSON.parse((contents[0] as { text: string }).text);
  };

  it("gw1://heroes is every hero, in full", async () => {
    expect(await read("gw1://heroes")).toEqual(heroes.map(fullHero));
  });

  it("gw1://meta is the four reference tables and the provenance record", async () => {
    const meta = await read("gw1://meta");
    expect(meta.attributes).toEqual(attributes);
    expect(meta.professions).toEqual(professions);
    expect(meta.campaigns).toEqual(campaigns);
    expect(meta.skillTypes).toEqual(skillTypes);
    expect(Object.keys(meta.provenance).sort()).toEqual(["heroes", "skillNamesFr", "skills"]);
  });
});

describe("encode_template answers in exactly one of its three shapes", () => {
  it("a build that does not resolve carries errors and nothing else", async () => {
    // `valid` belongs to the validation shape. A resolution failure that grew it
    // would read as a validator verdict on a build that was never validated.
    const client = await connectedClient();
    const res = await call(client, "encode_template", {
      primary: "Warrior",
      attributes: [],
      skills: bar("Not A Real Skill Name"),
    });
    expect(Object.keys(res)).toEqual(["errors"]);
    expect(res.errors.map((e: { code: string }) => e.code)).toEqual(["UNKNOWN_SKILL"]);
  });
});
