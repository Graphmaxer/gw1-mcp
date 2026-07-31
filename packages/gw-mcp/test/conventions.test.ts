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
  it("every z field in a tool inputSchema carries a .describe()", () => {
    // Tool schemas are the manual an LLM reads, and directories publish them
    // verbatim — Glama renders a blank Description cell for anything missing one.
    // Worse, list_heroes' two filters REJECT unknown values, so an undocumented
    // enum costs the caller a failed round-trip. Found by reading the published
    // listing rather than the code, which is exactly why this is now mechanical.
    const source = read("../src/server.ts");
    const schemas = [...source.matchAll(/inputSchema:\s*\{([\s\S]*?)\n {6}\}/g)].map(
      (m) => m[1] ?? "",
    );
    expect(schemas.length).toBeGreaterThan(0);
    const undocumented: string[] = [];
    for (const block of schemas) {
      // Split on top-level field starts so each field carries its own chain.
      const fields = block.split(/\n {8}(?=[a-zA-Z_]\w*:)/);
      for (const field of fields) {
        const name = /^\s*([a-zA-Z_]\w*):/.exec(field)?.[1];
        if (!name || !/\bz\./.test(field)) continue;
        if (!field.includes(".describe(")) undocumented.push(name);
      }
    }
    expect(undocumented).toEqual([]);
  });
});

describe("input length bounds (mechanical lock)", () => {
  it("every z.string() in a tool inputSchema carries a .max()", () => {
    // An unbounded string reaches normalizeName() (NFD + three regexes) on every
    // call. bodyLimit caps the blast radius, but the real problem is drift: all
    // eight tools carried .max(64) except list_heroes, and nothing said so.
    const source = read("../src/server.ts");
    const schemas = [...source.matchAll(/inputSchema:\s*\{([\s\S]*?)\n {6}\}/g)].map(
      (m) => m[1] ?? "",
    );
    expect(schemas.length).toBeGreaterThan(0);
    const unbounded = schemas
      .flatMap((block) => block.split("\n"))
      .filter((line) => /z\.string\(\)/.test(line) && !/\.max\(/.test(line));
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
    ];

    // Every declared tool must appear above, or a new tool could ship unchecked.
    expect(new Set(calls.map(([name]) => name)).size).toBe(TOOL_NAMES.length - 1);

    for (const [name, args] of calls) {
      await expect(
        client.callTool({ name, arguments: args }),
        `${name} must not throw a schema validation error`,
      ).resolves.toBeDefined();
    }
  });
});
