import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";

/**
 * Cross-language contract test (consumer side). The golden fixture is
 * PRODUCED and byte-verified by the C++ plugin test suite
 * (gwtoolbox-plugin/tests/core_tests.cpp) from a realistic AccountSnapshot;
 * this test parses the SAME file and feeds it through validate_build — the
 * exact journey a real in-game export takes. If either side drifts, its own
 * suite fails against the shared fixture.
 */
const exportPath = new URL("../../../gwtoolbox-plugin/tests/sample-export.json", import.meta.url);

interface AccountExport {
  type: string;
  version: number;
  character: { name: string; primaryProfessionId: number };
  heroes: { id: number; name: string }[];
  unlockedAccountSkills: number[];
  learnedCharacterSkills: number[];
}

async function connectedClient(): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "contract-test", version: "0.0.0" });
  await Promise.all([createServer().connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

describe("account export contract (plugin -> MCP)", () => {
  const doc = JSON.parse(readFileSync(exportPath, "utf8")) as AccountExport;

  it("the plugin's document has the shape the assistant workflow documents", () => {
    expect(doc.type).toBe("gw1-mcp-account-export");
    expect(doc.version).toBe(1);
    expect(doc.character.name).toContain('"'); // escaping survived the round trip
    expect(doc.heroes.map((h) => h.name)).toContain("Ogden Stonehealer");
    for (const ids of [doc.unlockedAccountSkills, doc.learnedCharacterSkills]) {
      expect(Array.isArray(ids)).toBe(true);
      for (const id of ids) expect(Number.isInteger(id)).toBe(true);
    }
  });

  it("validate_build consumes unlockedSkillIds from the export (warns on locked skills)", async () => {
    const client = await connectedClient();
    const result = await client.callTool({
      name: "validate_build",
      arguments: {
        primary: "Dervish",
        secondary: "Monk",
        attributes: [{ attribute: "Mysticism", rank: 12 }],
        // "Healing Signet" is skill id 1 — deliberately NOT in the fixture's
        // learnedCharacterSkills ([30, 64, 66]).
        skills: ["Healing Signet", null, null, null, null, null, null, null],
        unlockedSkillIds: doc.learnedCharacterSkills,
      },
    });
    expect(result.isError ?? false).toBe(false);
    const first = (result.content as { type: string; text: string }[]).at(0);
    expect(first).toBeDefined();
    const body = JSON.parse(first?.text ?? "{}") as {
      warnings: { code: string }[];
    };
    expect(body.warnings.some((w) => w.code === "SKILL_NOT_UNLOCKED")).toBe(true);
  });
});
