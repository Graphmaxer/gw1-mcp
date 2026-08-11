import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";
import { TOOL_NAMES } from "../src/tool-names.js";

/**
 * Mechanical enforcement of the CLAUDE.md rule: "Every validator rule and
 * resolution error code MUST have a test that triggers it." A new error
 * code added to src without a corresponding test mention fails here —
 * drift between the rule and reality becomes a red test, not a doc lie.
 */
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("conventions: every error code has a triggering test", () => {
  const testCorpus =
    read("./validate.test.ts") + read("./build-io.test.ts") + read("./server.test.ts");
  for (const src of ["../src/validate.ts", "../src/build-io.ts"] as const) {
    it(`covers all codes declared in ${src}`, () => {
      const codes = [...read(src).matchAll(/code: "([A-Z_]+)"/g)].map((m) => m[1]);
      expect(codes.length).toBeGreaterThan(0);
      const untested = [...new Set(codes)].filter((c) => c && !testCorpus.includes(c));
      expect(untested).toEqual([]);
    });
  }
});

describe("Claude Code plugin manifest (mechanical lock)", () => {
  // `claude plugin validate --strict` turns unrecognised manifest keys into
  // errors, and a key one character off a real one still loads at runtime while
  // doing nothing. Neither failure is visible without running the CLI, which is
  // not available in CI here — so the recognised set is asserted from the
  // published reference instead.
  const RECOGNISED = new Set([
    "$schema",
    "name",
    "displayName",
    "version",
    "description",
    "author",
    "homepage",
    "repository",
    "license",
    "keywords",
    "defaultEnabled",
    "skills",
    "commands",
    "agents",
    "workflows",
    "hooks",
    "mcpServers",
    "outputStyles",
    "lspServers",
    "experimental",
    "userConfig",
    "channels",
    "dependencies",
  ]);

  const manifest = JSON.parse(read("../../../.claude-plugin/plugin.json")) as Record<
    string,
    unknown
  >;

  it("uses only keys the plugin reference recognises", () => {
    expect(Object.keys(manifest).filter((k) => !RECOGNISED.has(k))).toEqual([]);
  });

  it("declares a name that is kebab-case, since it namespaces the skill", () => {
    // The skill is invoked as /<name>:gw1-build-assistant, so a space or capital
    // here would break the invocation rather than just look untidy.
    expect(manifest["name"]).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it("keeps its version in step with the release", () => {
    // release-please updates both through extra-files. If they ever diverge,
    // users are told a version that is not what the server reports.
    const server = JSON.parse(read("../../../server.json")) as { version: string };
    expect(manifest["version"]).toBe(server.version);
  });

  it("wires the MCP server with an explicit http type", () => {
    // Without "type", the config fails schema validation SILENTLY: the tools
    // simply never appear and nothing is logged.
    const mcp = JSON.parse(read("../../../.mcp.json")) as {
      mcpServers: Record<string, { type?: string; url?: string }>;
    };
    const server = Object.values(mcp.mcpServers)[0];
    expect(server?.type).toBe("http");
    expect(server?.url).toMatch(/^https:\/\/.+\/mcp$/);
  });
});

describe("input documentation (mechanical lock)", () => {
  // Both locks below inspect the PUBLISHED JSON Schema, not the source text.
  //
  // They used to regex `src/server.ts`. That was fragile in the way that matters:
  // a regex tied to file layout keeps passing while finding nothing once the code
  // moves, and a lock that silently stops looking is worse than no lock. It also
  // measured the wrong artefact — what a client and a directory consume is the
  // schema the server emits, so a `.describe()` present in source but absent from
  // the output would have passed while the real contract was wrong.
  const publishedTools = async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createServer();
    await server.connect(serverTransport);
    const client = new Client({ name: "schema-lock", version: "1" });
    await client.connect(clientTransport);
    return (await client.listTools()).tools;
  };

  type JsonSchema = {
    properties?: Record<string, { description?: string; type?: string; maxLength?: number }>;
  };

  it("every input property is documented in the published schema", async () => {
    // Tool schemas are the manual an LLM reads, and directories render them
    // verbatim — Glama shows a blank Description cell for anything missing one.
    // Worse, list_heroes' filters REJECT unknown values, so an undocumented enum
    // costs the caller a failed round-trip.
    const tools = await publishedTools();
    expect(tools).toHaveLength(TOOL_NAMES.length);
    const undocumented: string[] = [];
    let inspected = 0;
    for (const tool of tools) {
      const props = (tool.inputSchema as JsonSchema).properties ?? {};
      for (const [name, prop] of Object.entries(props)) {
        inspected++;
        if (!prop.description) undocumented.push(`${tool.name}.${name}`);
      }
    }
    // Non-vacuity: if a refactor ever empties this, the count fails first.
    expect(inspected).toBeGreaterThan(20);
    expect(undocumented).toEqual([]);
  });

  it("every input string is length-bounded in the published schema", async () => {
    // An unbounded string reaches normalizeName() (NFD + three regexes) on every
    // call. bodyLimit caps the blast radius; the real problem is drift — all eight
    // tools carried .max(64) except list_heroes, and nothing said so.
    const tools = await publishedTools();
    const unbounded: string[] = [];
    let strings = 0;
    for (const tool of tools) {
      const props = (tool.inputSchema as JsonSchema).properties ?? {};
      for (const [name, prop] of Object.entries(props)) {
        if (prop.type !== "string") continue;
        strings++;
        if (typeof prop.maxLength !== "number") unbounded.push(`${tool.name}.${name}`);
      }
    }
    expect(strings).toBeGreaterThan(5);
    expect(unbounded).toEqual([]);
  });
});

describe("release versioning", () => {
  it("keeps the MCP serverInfo version in lockstep with server.json (release-please updates both)", () => {
    const serverJson = JSON.parse(read("../../../server.json")) as { version: string };
    const source = read("../src/server.ts");
    expect(source).toContain(`version: "${serverJson.version}", // x-release-please-version`);
  });
});

describe("isError policy (mechanical lock)", () => {
  it("every top-level error object in server.ts goes through jsonError (which sets isError)", () => {
    const source = read("../src/server.ts");
    // Strip the jsonError helper itself (the one legitimate `json({ error` site),
    // then forbid the pattern anywhere else: total-call failures must use the
    // helper so the isError flag can never be forgotten again.
    const withoutHelper = source.replace(/function jsonError\([\s\S]*?\n}\n/, "");
    expect(withoutHelper).not.toMatch(/json\(\{\s*error\s*:/);
  });
});

describe("every game rule cites its source (mechanical lock)", () => {
  // Added because four citations had silently failed to land: an audit found rules with
  // real, known sources carrying no reference in the code. Comments rot quietly, and a
  // provenance document that disagrees with the source is worse than none — this makes
  // the omission a build failure instead.
  //
  // Rules about request coherence or name resolution are exempt: they are not claims
  // about the game.
  const NOT_GAME_RULES = new Set([
    "UNKNOWN_PRIMARY",
    "UNKNOWN_SECONDARY",
    "UNKNOWN_SKILL",
    "UNKNOWN_ATTRIBUTE",
    "DUPLICATE_ATTRIBUTE",
    "SKILL_NOT_UNLOCKED",
    "UNALLOCATED_ATTRIBUTE",
    "UNUSED_ATTRIBUTE",
    "NO_PRIMARY",
  ]);

  it("has a wiki URL or an in-game observation near every game rule", () => {
    const source = readFileSync(new URL("../src/validate.ts", import.meta.url), "utf8");
    const codes = [...new Set([...source.matchAll(/code: "([A-Z_]+)"/g)].map((m) => m[1]!))];
    const gameRules = codes.filter((c) => !NOT_GAME_RULES.has(c));
    // Non-vacuity: if the extraction breaks, fail here rather than pass emptily.
    expect(gameRules.length).toBeGreaterThan(10);

    // Look only at each rule's OWN territory: the span between the previous `code:`
    // and this one. A fixed-size window fails vacuously here — a 1500-character look
    // back catches the NEIGHBOURING rule's citation, so removing a citation left the
    // test green. Found by trying it.
    const uncited = gameRules.filter((code) => {
      const at = source.indexOf(`code: "${code}"`);
      const previous = source.lastIndexOf('code: "', at - 1);
      const own = source.slice(previous === -1 ? 0 : previous, at);
      return !/wiki\.|fandom\.|in game|IN GAME/.test(own);
    });
    expect(uncited).toEqual([]);
  });
});

describe("output schemas match reality (mechanical lock)", () => {
  // Every real client calls tools/list before calling a tool, and the SDK then
  // validates every structured result against the declared outputSchema from that
  // point on. get_skill failed this for an unknown length of time: fullSkill did
  // `...skill`, leaking six internal join keys (attributeId, campaignId,
  // professionId, typeId, pvpSplit, splitId) into a strict schema, so a primed
  // client got "data must NOT have additional properties" and the call THREW.
  //
  // Nothing caught it. Typecheck cannot: excess-property checks do not apply to
  // spreads. The existing tool tests cannot either, because they call tools without
  // listing them first, which leaves the validators unprimed — the bug was invisible
  // precisely because tests are tidier than clients.
  //
  // So this asserts the client's own behaviour: list first, then call everything.
  it("every tool's structured result validates once tools/list has primed the SDK", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createServer();
    await server.connect(serverTransport);
    const client = new Client({ name: "schema-lock", version: "1" });
    await client.connect(clientTransport);
    await client.listTools();

    const bar = ["Aegis", null, null, null, null, null, null, null];
    const calls: [string, Record<string, unknown>][] = [
      ["get_skill", { name: "Aegis" }],
      ["get_hero", { name: "Koss" }],
      ["list_heroes", { campaignName: "Nightfall" }],
      ["search_skills", { professionName: "Monk", limit: 2 }],
      ["decode_template", { code: "OwpiMypMBg1cxcBAMBdmtIKAA" }],
      ["validate_build", { primary: "Monk", attributes: [], skills: bar }],
      [
        "encode_template",
        { primary: "Monk", attributes: [{ attribute: "Healing Prayers", rank: 12 }], skills: bar },
      ],
      // The golden PvX blob from server.test.ts, verbatim including the
      // wrap-induced spaces. This tool was the ONE the completeness assertion
      // below used to exempt (`- 1`), so a change to the slot shape — a new
      // field, a renamed inGamePlayerName — would have shipped green and broken
      // every client that primes its validators. Audit finding M3, 2026-08-08.
      [
        "decode_pawned_team",
        {
          pwnd: "pwnd0001?download pawned2 @ Copyright 2008-2018 Redeemer >XOwBR4ZymcBaXMmEAAAAAAAAAAAAAABXUGxheWVyCmh0dHBzOi8vZ3dwdnguZ2FtZXBlZGlhLmNvbS9 CdWlsZDpUZWFtXy1fM19IZXJvX0Rpc2NvcmR3YXkZOAhjUoGYIPxsjaGTaO5GmjzLGAAAACEIAAKSGVy byAxCgbOAhkUsG3RFuTMzOgIkmTuhJ1+iBAAAACEJAAKSGVybyAyCgZOANDUshvSxMVBoBbhKg3V1DBE AAAACEIAAKSGVybyAzCg<",
        },
      ],
    ];

    // Every declared tool must appear above, or a new tool could ship unchecked.
    expect(new Set(calls.map(([name]) => name)).size).toBe(TOOL_NAMES.length);

    for (const [name, args] of calls) {
      await expect(
        client.callTool({ name, arguments: args }),
        `${name} must not throw a schema validation error`,
      ).resolves.toBeDefined();
    }

    // Same fixture, second question: does every tool REJECT an argument it does
    // not declare? Permissive inputs answered as if the argument had not been
    // sent — `search_skills {"profession":"Monk"}` returned the first 50 skills
    // of the whole database presented as filtered results, which a caller cannot
    // tell from a real answer. Zod's message names the key, so one round trip is
    // enough to self-correct.
    for (const [name, args] of calls) {
      const res = await client.callTool({
        name,
        arguments: { ...args, notAToolArgument: "x" },
      });
      expect(res.isError, `${name} must reject an undeclared argument`).toBe(true);
      expect(JSON.stringify(res.content), name).toContain("notAToolArgument");
    }
  });
});
