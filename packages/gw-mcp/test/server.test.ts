import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.js";

async function connectedClient() {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([
    createServer().connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return client;
}

function payload(result: Awaited<ReturnType<Client["callTool"]>>) {
  const content = result.content as Array<{ type: string; text: string }>;
  return JSON.parse(content[0]!.text);
}

describe("gw1-mcp server", () => {
  it("lists the five compiler tools", async () => {
    const client = await connectedClient();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "decode_template",
      "encode_template",
      "get_skill",
      "search_skills",
      "validate_build",
    ]);
  });

  it("gets a skill with suggestions on typo", async () => {
    const client = await connectedClient();
    const ok = payload(await client.callTool({ name: "get_skill", arguments: { name: "Mystic Regeneration" } }));
    expect(ok.profession).toBe("Dervish");
    const ko = payload(await client.callTool({ name: "get_skill", arguments: { name: "Mystic Regenration" } }));
    expect(ko.error.suggestions).toContain("Mystic Regeneration");
  });

  it("decodes the golden template", async () => {
    const client = await connectedClient();
    const decoded = payload(
      await client.callTool({ name: "decode_template", arguments: { code: "OwpiMypMBg1cxcBAMBdmtIKAA" } }),
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
          skills: [
            "Avatar of Balthazar",
            "Hundred Blades",
            null, null, null, null, null, null,
          ],
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
