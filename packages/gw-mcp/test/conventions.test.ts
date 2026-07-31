import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

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
