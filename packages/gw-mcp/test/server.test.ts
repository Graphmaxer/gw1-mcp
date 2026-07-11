import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.js";

async function connectedClient() {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([createServer().connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

function payload(result: Awaited<ReturnType<Client["callTool"]>>) {
  const content = result.content as Array<{ type: string; text: string }>;
  return JSON.parse(content[0]!.text);
}

describe("gw1-mcp server", () => {
  it("lists the compiler tools", async () => {
    const client = await connectedClient();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "decode_pawned_team",
      "decode_template",
      "encode_template",
      "get_hero",
      "get_skill",
      "list_heroes",
      "search_skills",
      "validate_build",
    ]);
  });

  it("gets a skill with suggestions on typo", async () => {
    const client = await connectedClient();
    const ok = payload(
      await client.callTool({ name: "get_skill", arguments: { name: "Mystic Regeneration" } }),
    );
    expect(ok.profession).toBe("Dervish");
    const ko = payload(
      await client.callTool({ name: "get_skill", arguments: { name: "Mystic Regenration" } }),
    );
    expect(ko.error.suggestions).toContain("Mystic Regeneration");
  });

  it("decodes the golden template", async () => {
    const client = await connectedClient();
    const decoded = payload(
      await client.callTool({
        name: "decode_template",
        arguments: { code: "OwpiMypMBg1cxcBAMBdmtIKAA" },
      }),
    );
    expect(decoded.primary).toBe("Assassin");
    expect(decoded.secondary).toBe("Dervish");
    expect(decoded.attributes).toContainEqual({ attribute: "Critical Strikes", rank: 12 });
  });

  it("round-trips a named build through encode -> decode", async () => {
    const client = await connectedClient();
    const encoded = payload(
      await client.callTool({
        name: "encode_template",
        arguments: {
          primary: "Dervish",
          secondary: "Monk",
          attributes: [
            { attribute: "Mysticism", rank: 12 },
            { attribute: "Scythe Mastery", rank: 12 },
          ],
          skills: [
            "Avatar of Balthazar",
            "Mystic Sweep",
            "Eremite's Attack",
            "Mystic Regeneration",
            "Faithful Intervention",
            "Watchful Intervention",
            "Mending Touch",
            null,
          ],
        },
      }),
    );
    expect(encoded.code).toBeTypeOf("string");
    const decoded = payload(
      await client.callTool({ name: "decode_template", arguments: { code: encoded.code } }),
    );
    expect(decoded.primary).toBe("Dervish");
    expect(decoded.skills[0].name).toBe("Avatar of Balthazar");
    expect(decoded.skills[7].name).toBeNull();
  });

  it("rejects rule violations with structured errors", async () => {
    const client = await connectedClient();
    const result = payload(
      await client.callTool({
        name: "validate_build",
        arguments: {
          primary: "Warrior",
          secondary: "Monk",
          attributes: [{ attribute: "Divine Favor", rank: 12 }],
          skills: ["Avatar of Balthazar", "Hundred Blades", null, null, null, null, null, null],
        },
      }),
    );
    expect(result.valid).toBe(false);
    const codes = result.errors.map((e: { code: string }) => e.code);
    expect(codes).toContain("MULTIPLE_ELITES");
    expect(codes).toContain("PROFESSION_MISMATCH"); // Avatar of Balthazar on a Warrior
    expect(codes).toContain("PRIMARY_ATTRIBUTE_ON_SECONDARY"); // Divine Favor with Monk secondary
  });
});

describe("GWToolbox account export integration", () => {
  it("warns on skills outside the unlocked list", async () => {
    const client = await connectedClient();
    const result = payload(
      await client.callTool({
        name: "validate_build",
        arguments: {
          primary: "Dervish",
          secondary: "Monk",
          attributes: [{ attribute: "Mysticism", rank: 12 }],
          skills: ["Avatar of Balthazar", "Mending Touch", null, null, null, null, null, null],
          forHero: true,
          unlockedSkillIds: [1518], // only Avatar of Balthazar unlocked
        },
      }),
    );
    expect(result.valid).toBe(true); // warnings, not errors
    const codes = result.warnings.map((w: { code: string }) => w.code);
    expect(codes).toContain("SKILL_NOT_UNLOCKED");
    expect(
      result.warnings.some((w: { message: string }) => w.message.includes("Mending Touch")),
    ).toBe(true);
  });
});

describe("audit regressions", () => {
  it("rejects title-track attributes with a structured error instead of crashing", async () => {
    const client = await connectedClient();
    const result = payload(
      await client.callTool({
        name: "encode_template",
        arguments: {
          primary: "Dervish",
          secondary: "Monk",
          attributes: [{ attribute: "Sunspear Title Track", rank: 8 }],
          skills: ["Mystic Sweep", null, null, null, null, null, null, null],
        },
      }),
    );
    expect(result.errors.map((e: { code: string }) => e.code)).toContain(
      "ATTRIBUTE_NOT_TEMPLATABLE",
    );
  });
});

describe("heroes and resources", () => {
  it("gets a hero by name with resolved profession", async () => {
    const client = await connectedClient();
    const hero = payload(
      await client.callTool({ name: "get_hero", arguments: { name: "master of whispers" } }),
    );
    expect(hero.profession).toBe("Necromancer");
    expect(hero.id).toBe(4); // GWCA HeroID — must match plugin export
  });

  it("lists Dervish heroes", async () => {
    const client = await connectedClient();
    const result = payload(
      await client.callTool({ name: "list_heroes", arguments: { professionName: "Dervish" } }),
    );
    const names = result.heroes.map((h: { name: string }) => h.name);
    expect(names).toContain("Melonni");
    expect(names).toContain("Kahmu");
    expect(names).toContain("M.O.X.");
  });

  it("exposes the build workflow guide as a resource", async () => {
    const client = await connectedClient();
    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri)).toContain("gw1://guide/build-workflow");
    const doc = await client.readResource({ uri: "gw1://guide/build-workflow" });
    expect((doc.contents[0] as { text: string }).text).toContain("One elite maximum");
  });
});

describe("paw-ned2 team decoding", () => {
  it("decodes a real PvXwiki team blob (3 Hero Discordway) despite line wraps", async () => {
    const client = await connectedClient();
    // Verbatim from the PvX page rendering, including wrap-induced spaces.
    const pwnd =
      "pwnd0001?download pawned2 @ Copyright 2008-2018 Redeemer >XOwBR4ZymcBaXMmEAAAAAAAAAAAAAABXUGxheWVyCmh0dHBzOi8vZ3dwdnguZ2FtZXBlZGlhLmNvbS9 CdWlsZDpUZWFtXy1fM19IZXJvX0Rpc2NvcmR3YXkZOAhjUoGYIPxsjaGTaO5GmjzLGAAAACEIAAKSGVy byAxCgbOAhkUsG3RFuTMzOgIkmTuhJ1+iBAAAACEJAAKSGVybyAyCgZOANDUshvSxMVBoBbhKg3V1DBE AAAACEIAAKSGVybyAzCg<";
    const result = payload(
      await client.callTool({ name: "decode_pawned_team", arguments: { pwnd } }),
    );
    expect(result.builds).toHaveLength(4);
    expect(result.builds.map((b: { label: string }) => b.label)).toEqual([
      "Player",
      "Hero 1",
      "Hero 2",
      "Hero 3",
    ]);
    expect(result.builds[0].notes).toContain("gwpvx");
    // The three Discord hero bars are Necromancer-primary.
    for (const hero of result.builds.slice(1)) {
      expect(hero.build.primary).toBe("Necromancer");
      expect(hero.build.skills.some((s: { name: string | null }) => s.name === "Discord")).toBe(
        true,
      );
    }
  });
});

describe("resources and error surfaces", () => {
  it("lists and reads all three resources", async () => {
    const client = await connectedClient();
    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri).sort()).toEqual([
      "gw1://guide/build-workflow",
      "gw1://heroes",
      "gw1://meta",
    ]);
    for (const uri of ["gw1://meta", "gw1://heroes", "gw1://guide/build-workflow"]) {
      const { contents } = await client.readResource({ uri });
      const first = contents[0];
      expect(first && "text" in first ? first.text : undefined).toBeTruthy();
    }
    const metaContents = (await client.readResource({ uri: "gw1://meta" })).contents[0];
    const meta = JSON.parse(metaContents && "text" in metaContents ? metaContents.text : "{}");
    expect(meta.source ?? meta.upstream ?? meta).toBeTruthy();
  });

  it("returns a structured error for malformed template codes", async () => {
    const client = await connectedClient();
    const res = await client.callTool({
      name: "decode_template",
      arguments: { code: "not a code!!" },
    });
    expect(res.isError).toBe(true);
  });

  it("get_hero handles unknown names and list_heroes filters by campaign", async () => {
    const client = await connectedClient();
    const ko = await client.callTool({ name: "get_hero", arguments: { name: "Gandalf" } });
    expect(JSON.stringify(ko.content)).toMatch(/[Nn]o hero|not found|Unknown/);
    const nf = await client.callTool({
      name: "list_heroes",
      arguments: { campaignName: "Nightfall" },
    });
    expect(JSON.stringify(nf.content)).toContain("Koss");
  });

  it("decode_pawned_team rejects garbage blobs with a structured error", async () => {
    const client = await connectedClient();
    const res = await client.callTool({
      name: "decode_pawned_team",
      arguments: { blob: "pwnd-garbage" },
    });
    expect(res.isError).toBe(true);
  });
});

describe("remaining tool surfaces", () => {
  it("encode_template resolves, validates and encodes a named build", async () => {
    const client = await connectedClient();
    const res = payload(
      await client.callTool({
        name: "encode_template",
        arguments: {
          primary: "Dervish",
          attributes: [
            { attribute: "Scythe Mastery", rank: 11 },
            { attribute: "Mysticism", rank: 10 },
            { attribute: "Earth Prayers", rank: 8 },
          ],
          skills: [
            "Avatar of Balthazar",
            "Staggering Force",
            "Twin Moon Sweep",
            "Wearying Strike",
            "Pious Fury",
            "Aura of Holy Might (Kurzick)",
            "Asuran Scan",
            "Sunspear Rebirth Signet",
          ],
        },
      }),
    );
    expect(res.code).toBe("OgCjkurIrSuXaXPXBYihygvlYcA");
  });

  it("encode_template surfaces resolution errors with isError", async () => {
    const client = await connectedClient();
    const res = await client.callTool({
      name: "encode_template",
      arguments: {
        primary: "Bard",
        attributes: [],
        skills: [
          "Avatar of Balthazar",
          "Staggering Force",
          "Twin Moon Sweep",
          "Wearying Strike",
          "Pious Fury",
          "Aura of Holy Might (Kurzick)",
          "Asuran Scan",
          "Sunspear Rebirth Signet",
        ],
      },
    });
    expect(JSON.stringify(res.content)).toContain("UNKNOWN_PROFESSION");
  });

  it("search_skills flags unknown profession and campaign filters", async () => {
    const client = await connectedClient();
    for (const args of [
      { nameContains: "strike", professionName: "Bard" },
      { nameContains: "strike", campaignName: "Atlantis" },
    ]) {
      const res = await client.callTool({ name: "search_skills", arguments: args });
      expect(res.isError).toBe(true);
    }
  });

  it("search_skills filters by valid profession, campaign and elite flag", async () => {
    const client = await connectedClient();
    const res = payload(
      await client.callTool({
        name: "search_skills",
        arguments: {
          nameContains: "avatar",
          professionName: "Dervish",
          campaignName: "Nightfall",
          elite: true,
        },
      }),
    );
    expect(JSON.stringify(res)).toContain("Avatar of Balthazar");
  });

  it("get_skill works by id and validate_build reports through the tool", async () => {
    const client = await connectedClient();
    const byId = payload(await client.callTool({ name: "get_skill", arguments: { id: 1518 } }));
    expect(JSON.stringify(byId)).toContain("Avatar of Balthazar");
    const report = payload(
      await client.callTool({
        name: "validate_build",
        arguments: {
          primary: "Dervish",
          attributes: [
            { attribute: "Scythe Mastery", rank: 11 },
            { attribute: "Mysticism", rank: 10 },
            { attribute: "Earth Prayers", rank: 8 },
          ],
          skills: [
            "Avatar of Balthazar",
            "Staggering Force",
            "Twin Moon Sweep",
            "Wearying Strike",
            "Pious Fury",
            "Aura of Holy Might (Kurzick)",
            "Asuran Scan",
            "Sunspear Rebirth Signet",
          ],
        },
      }),
    );
    expect(report.valid).toBe(true);
  });

  it("list_heroes rejects unknown campaigns with isError", async () => {
    const client = await connectedClient();
    const res = await client.callTool({
      name: "list_heroes",
      arguments: { campaignName: "Atlantis" },
    });
    expect(res.isError).toBe(true);
  });
});
