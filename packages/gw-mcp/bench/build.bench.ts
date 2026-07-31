import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { decodeTemplate } from "@gw1-mcp/gw-template";
import { bench, describe } from "vitest";
import { describeTemplate, resolveNamedBuild, type NamedBuild } from "../src/build-io.js";
import { createServer } from "../src/server.js";
import { validateBuild } from "../src/validate.js";

/**
 * Two layers are measured: the pure compiler stages (resolve names -> ids,
 * validate against the game rules, enrich a decoded template) and a full
 * tools/call round trip through the MCP SDK, which is what a client actually
 * pays for.
 */

/** Critical Scythe Assassin — a legal, full 8-skill bar. */
const GOLDEN_CODE = "OwpiMypMBg1cxcBAMBdmtIKAA";
const GOLDEN_TEMPLATE = decodeTemplate(GOLDEN_CODE);

const NAMED_BUILD: NamedBuild = {
  primary: "Dervish",
  secondary: "Monk",
  attributes: [
    { attribute: "Mysticism", rank: 12 },
    { attribute: "Scythe Mastery", rank: 12 },
    { attribute: "Earth Prayers", rank: 3 },
  ],
  skills: [
    "Avatar of Balthazar",
    "Mystic Sweep",
    "Eremite's Attack",
    "Mystic Regeneration",
    "Vow of Piety",
    "Heart of Holy Flame",
    "Pious Restoration",
    "Resurrection Signet",
  ],
};

/** Same bar with one misspelling: exercises the suggestion path on failure. */
const TYPO_BUILD: NamedBuild = {
  ...NAMED_BUILD,
  skills: [...NAMED_BUILD.skills.slice(0, 7), "Resurection Signet"],
};

async function connectedClient(): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "bench", version: "0.0.0" });
  await Promise.all([createServer().connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

describe("build compiler", () => {
  bench("resolveNamedBuild — full bar, all names resolve", () => {
    resolveNamedBuild(NAMED_BUILD);
  });

  bench("resolveNamedBuild — unknown skill (suggestion path)", () => {
    resolveNamedBuild(TYPO_BUILD);
  });

  bench("validateBuild — legal player bar", () => {
    validateBuild(GOLDEN_TEMPLATE);
  });

  bench("validateBuild — hero bar (extra PvE-only rules)", () => {
    validateBuild(GOLDEN_TEMPLATE, { forHero: true });
  });

  bench("describeTemplate — enrich a decoded bar", () => {
    describeTemplate(GOLDEN_TEMPLATE);
  });
});

const client = await connectedClient();
// A real client lists the tools before calling one, which makes the SDK
// validate every structured result against its output schema from then on.
// Priming it here keeps that cost inside every tools/call measurement instead
// of only the ones that happen to run after the tools/list benchmark.
// (get_skill is deliberately absent below: with the validators primed, its
// structured result is REJECTED by the SDK — "data must NOT have additional
// properties" — so it cannot be measured until that mismatch is fixed.)
await client.listTools();

describe("MCP round trip (in-memory transport)", () => {
  bench("tools/list", async () => {
    await client.listTools();
  });

  bench("tools/call decode_template", async () => {
    await client.callTool({ name: "decode_template", arguments: { code: GOLDEN_CODE } });
  });

  bench("tools/call encode_template", async () => {
    await client.callTool({ name: "encode_template", arguments: { ...NAMED_BUILD } });
  });

  bench("tools/call search_skills", async () => {
    await client.callTool({
      name: "search_skills",
      arguments: { professionName: "Dervish", nameContains: "mystic" },
    });
  });
});
