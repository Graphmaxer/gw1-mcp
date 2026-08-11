import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";

const app = createApp();

/** POST a JSON-RPC message to /mcp and parse the SSE-framed response. */
async function rpc(body: unknown): Promise<{ status: number; message: any }> {
  const res = await app.request("/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  const data = text
    .split("\n")
    .find((line) => line.startsWith("data: "))
    ?.slice("data: ".length);
  return { status: res.status, message: data ? JSON.parse(data) : null };
}

describe("streamable HTTP endpoint", () => {
  it("serves a discovery document at the root", async () => {
    const res = await app.request("/");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.endpoint).toBe("/mcp");
  });

  it("answers initialize", async () => {
    const { status, message } = await rpc({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "test", version: "0" },
      },
    });
    expect(status).toBe(200);
    expect(message.result.serverInfo.name).toBe("gw1-mcp");
  });

  it("lists tools statelessly (no prior session required)", async () => {
    const { message } = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    const names = message.result.tools.map((t: { name: string }) => t.name).sort();
    expect(names).toEqual([
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

  it("calls a tool over HTTP", async () => {
    const { message } = await rpc({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "decode_template",
        arguments: { code: "OwpiMypMBg1cxcBAMBdmtIKAA" },
      },
    });
    const payload = JSON.parse(message.result.content[0].text);
    expect(payload.primary).toBe("Assassin");
    expect(payload.secondary).toBe("Dervish");
  });
});
describe("directory-readiness routes", () => {
  it("serves a privacy policy", async () => {
    const res = await createApp().request("/privacy");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("does not collect");
  });
  it("serves the OpenAI apps challenge only when configured", async () => {
    const app = createApp();
    expect((await app.request("/.well-known/openai-apps-challenge")).status).toBe(404);
    const res = await app.request(
      "/.well-known/openai-apps-challenge",
      {},
      { OPENAI_APPS_CHALLENGE: "tok123" },
    );
    expect(await res.text()).toBe("tok123");
  });
  it("does not serve a Glama ownership file, and must not start", async () => {
    // Removed deliberately (2026-07-29): verification requires publishing an
    // email at a public URL, the maintainer declined, and the Glama account is
    // deleted. This asserts the absence so the route is not "restored" by someone
    // reading a 404 in the logs as a bug — which is how it was nearly fixed by
    // publishing a personal address.
    expect((await createApp().request("/.well-known/glama.json")).status).toBe(404);
  });
  it("serves an RFC 9116 security.txt pointing at GitHub private reporting", async () => {
    const app = createApp();
    const body = await (await app.request("/.well-known/security.txt")).text();
    expect(body).toContain(
      "Contact: https://github.com/Graphmaxer/gw1-mcp/security/advisories/new",
    );
    expect(body).toContain("Policy: https://github.com/Graphmaxer/gw1-mcp/blob/main/SECURITY.md");
    // Expires is a REQUIRED field per RFC 9116 (GW1-AUD-06).
    const expires = body.match(/^Expires: (.+)$/m);
    expect(expires).not.toBeNull();
    const expiresValue = expires?.[1] ?? "";
    expect(new Date(expiresValue).getTime()).toBeGreaterThan(Date.now());
  });

  it("serves /.well-known/forge.json with the publisher claim", async () => {
    const res = await createApp().request("/.well-known/forge.json");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ publisher: "Graphmaxer" });
  });
});

describe("CORS and method handling on /mcp", () => {
  it("answers the CORS preflight instead of 405ing browser clients", async () => {
    const res = await createApp().request("/mcp", {
      method: "OPTIONS",
      headers: {
        Origin: "https://inspector.example",
        "Access-Control-Request-Method": "POST",
      },
    });
    expect(res.status).toBeLessThan(300);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-methods")).toContain("POST");
  });

  it("exposes the MCP session header to browser callers", async () => {
    const res = await createApp().request("/mcp", {
      method: "OPTIONS",
      headers: { Origin: "https://inspector.example", "Access-Control-Request-Method": "POST" },
    });
    expect(res.headers.get("access-control-expose-headers")).toContain("Mcp-Session-Id");
  });

  it("405s GET rather than opening an SSE body that never closes", async () => {
    // Stateless: nothing to stream. The old 200 + text/event-stream held a
    // socket open per request and the limiter only counted the opening call.
    const res = await createApp().request("/mcp", { method: "GET" });
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toContain("POST");
  });

  it("405s DELETE rather than pretending to end a session", async () => {
    const res = await createApp().request("/mcp", { method: "DELETE" });
    expect(res.status).toBe(405);
  });

  it("sets the hardening headers on the routes a browser actually visits", async () => {
    // These were bare while only /mcp was covered — and /, /privacy and
    // /.well-known/* are exactly what a directory scanner fetches. Hono applies
    // middleware only to handlers registered after it, so this also locks the
    // registration order.
    for (const path of ["/", "/privacy", "/.well-known/security.txt"]) {
      const res = await createApp().request(path);
      expect(res.headers.get("x-content-type-options"), path).toBe("nosniff");
      expect(res.headers.get("referrer-policy"), path).toBe("no-referrer");
    }
  });

  it("keeps no-store on /mcp only, so static routes stay cacheable", async () => {
    const app = createApp();
    const discovery = await app.request("/");
    expect(discovery.headers.get("cache-control")).not.toBe("no-store");
  });

  it("sets the response hardening headers on /mcp", async () => {
    const res = await createApp().request("/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("accepts the project's own loopback dev origin", async () => {
    // `dev:node` serves on http://localhost:3000; rejecting it was a false
    // negative against our own workflow.
    const res = await createApp().request("/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", Origin: "http://localhost:3000" },
      body: "{}",
    });
    expect(res.status).not.toBe(403);
  });
});

describe("the endpoint answers with and without a trailing slash", () => {
  // Hono routes "/mcp/" as a distinct path, so a client joining a trailing slash
  // used to get a plain 404 and fail outright — 21 times in 7 days of production
  // logs. Both spellings must stay identical across the whole middleware chain,
  // which is what these assertions lock.
  const call = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };

  for (const path of ["/mcp", "/mcp/"] as const) {
    it(`serves a tool call on ${path}`, async () => {
      const res = await createApp().request(path, { method: "POST", headers, body: call });
      expect(res.status).toBe(200);
      expect((await res.text()).length).toBeGreaterThan(100);
    });

    it(`applies the hardening headers on ${path}`, async () => {
      const res = await createApp().request(path, { method: "POST", headers, body: call });
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("cache-control")).toBe("no-store");
    });

    it(`still 405s GET and answers preflight on ${path}`, async () => {
      const app = createApp();
      expect((await app.request(path, { method: "GET" })).status).toBe(405);
      const pre = await app.request(path, {
        method: "OPTIONS",
        headers: { Origin: "https://inspector.example", "Access-Control-Request-Method": "POST" },
      });
      expect(pre.headers.get("access-control-allow-origin")).toBe("*");
    });

    it(`still rejects a non-loopback http origin on ${path}`, async () => {
      const res = await createApp().request(path, {
        method: "POST",
        headers: { ...headers, Origin: "http://evil.example" },
        body: call,
      });
      expect(res.status).toBe(403);
    });
  }
});

describe("robots.txt", () => {
  it("is served, and tells crawlers not to fetch the JSON-RPC endpoint", async () => {
    const res = await createApp().request("/robots.txt");
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("User-agent: *");
    expect(body).toContain("Disallow: /mcp");
  });

  it("advertises no sitemap, since none is served", async () => {
    // Pointing at a missing sitemap is worse than omitting the line.
    const body = await (await createApp().request("/robots.txt")).text();
    expect(body.toLowerCase()).not.toContain("sitemap");
    expect((await createApp().request("/sitemap.xml")).status).toBe(404);
  });
});

describe("terms of use", () => {
  it("is served, since the plugin form requires a Terms of Service URL", async () => {
    const res = await createApp().request("/terms");
    expect(res.status).toBe(200);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("separates the code licence from the game data rights", async () => {
    // The submission kit used to offer the repository's MIT LICENSE as terms of
    // service. MIT governs the CODE; it says nothing about using a hosted service
    // and nothing about the third-party game data this service redistributes.
    const body = await (await createApp().request("/terms")).text();
    expect(body).toMatch(/MIT/);
    expect(body).toMatch(/game data is NOT/);
    expect(body).toMatch(/THIRD_PARTY_NOTICES/);
  });

  it("promises nothing the service cannot keep", async () => {
    const body = await (await createApp().request("/terms")).text();
    expect(body).toMatch(/without\s+warranty of any kind/);
    expect(body).toMatch(/shut down at any time/);
    expect(body).toMatch(/rate-limited/);
  });

  it("carries the trademark disclaimer", async () => {
    const body = await (await createApp().request("/terms")).text();
    expect(body).toMatch(/NCSoft/);
  });
});

describe("privacy policy covers what the directory requires", () => {
  // The connectors directory lists five mandatory topics and states that a
  // missing or incomplete privacy policy is an immediate rejection. Retention
  // was the one absent: the counters were described without a duration.
  const topics: [string, RegExp][] = [
    ["collection", /collect/i],
    ["usage and storage", /stor|usage/i],
    ["third-party sharing", /third[- ]part|Cloudflare/i],
    ["retention", /retention|retain/i],
    ["contact", /Contact:/],
  ];
  for (const [topic, pattern] of topics) {
    it(`states ${topic}`, async () => {
      const body = await (await createApp().request("/privacy")).text();
      expect(pattern.test(body), topic).toBe(true);
    });
  }
});

describe("security.txt reproducibility", () => {
  it("derives Canonical from the serving host, not a hardcoded workers.dev URL", async () => {
    const body = await (
      await createApp().request("https://gw1-mcp.example.org/.well-known/security.txt")
    ).text();
    expect(body).toContain("Canonical: https://gw1-mcp.example.org/.well-known/security.txt");
  });

  it("serves a byte-identical file across requests (cacheable, reproducible)", async () => {
    const app = createApp();
    const a = await (await app.request("/.well-known/security.txt")).text();
    const b = await (await app.request("/.well-known/security.txt")).text();
    expect(a).toBe(b);
  });

  it("does not claim the counters are narrower than they are", async () => {
    // These two sentences went stale the moment a dimension was added: the flags
    // ARE arguments, and the entity is derived from one. Asserting their absence
    // is cheap; asserting prose is accurate is not, so this at least stops the
    // two known-false claims from coming back by copy-paste.
    const body = await (await createApp().request("/privacy")).text();
    expect(body).not.toMatch(/never its arguments/);
    expect(body).not.toMatch(/a tool name and a timestamp/);
    // And it must still say what it does not do.
    expect(body).toMatch(/never IP/i);
    // The client name is caller-controlled, so an unqualified "no personal data
    // is collected" would be a claim the server cannot enforce. Say who supplies
    // it instead of asserting the absolute.
    expect(body).not.toMatch(/no personal data is collected/i);
    expect(body).toMatch(/supplied by the caller/i);
  });

  it("fails while there is still time to bump Expires, not after it lapses", async () => {
    const body = await (await createApp().request("/.well-known/security.txt")).text();
    const expires = new Date(body.match(/^Expires: (.+)$/m)?.[1] ?? "").getTime();
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    expect(expires - Date.now()).toBeGreaterThan(thirtyDays);
  });
});

describe("favicon", () => {
  it("serves the injected favicon bytes as image/png", async () => {
    // Inject fake PNG-magic bytes; the real PNG is wired in index.ts, not here.
    const fakePng = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const res = await createApp(fakePng).request("/favicon.ico");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([bytes[0], bytes[1], bytes[2], bytes[3]]).toEqual([137, 80, 78, 71]);
  });
});

describe("origin validation and logo", () => {
  it("rejects non-https browser origins on /mcp", async () => {
    const res = await createApp().request("/mcp", {
      method: "POST",
      headers: { Origin: "http://evil.test" },
    });
    expect(res.status).toBe(403);
  });
  it("accepts requests without an Origin header", async () => {
    const res = await createApp().request("/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).not.toBe(403);
  });
  it("rejects a malformed Origin that a prefix check would have let through (GW1-12)", async () => {
    const res = await createApp().request("/mcp", {
      method: "POST",
      headers: { Origin: "https://" },
    });
    expect(res.status).toBe(403);
  });
  it("accepts a well-formed https Origin", async () => {
    const res = await createApp().request("/mcp", {
      method: "POST",
      headers: { Origin: "https://claude.ai", "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).not.toBe(403);
  });
  it("serves the PNG logo at /logo.png", async () => {
    const res = await createApp(new Uint8Array([137, 80, 78, 71])).request("/logo.png");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
  });
});

describe("tool outcome points", () => {
  const call = async (name: string, args: Record<string, unknown>) => {
    const points: { blobs?: string[] }[] = [];
    const env = { MCP_ANALYTICS: { writeDataPoint: (p: (typeof points)[0]) => points.push(p) } };
    await createApp().request(
      "/mcp",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name, arguments: args },
        }),
      },
      env,
    );
    return points.find((p) => p.blobs?.[0] === "event:tool_call")?.blobs;
  };

  it("records the error code when a lookup misses", async () => {
    // The blob5 column is what the 'Name lookups' and 'Top validation failures'
    // panels read; an unresolvable name must land here rather than vanish.
    const blobs = await call("get_skill", { name: "Régénération mystique" });
    expect(blobs?.[3]).toBe("error");
    expect(blobs?.[4]).toBe("NOT_FOUND");
    expect(blobs?.[5]).toBe("");
  });

  it("records a validation code on a call that succeeded", async () => {
    const blobs = await call("validate_build", {
      primary: "Dervish",
      attributes: [],
      skills: ["Avatar of Balthazar", "Pious Renewal", null, null, null, null, null, null],
    });
    expect(blobs?.[3]).toBe("ok");
    expect(blobs?.[4]).toBe("MULTIPLE_ELITES");
  });

  it("records the context flags, space separated", async () => {
    const blobs = await call("validate_build", {
      primary: "Dervish",
      forHero: true,
      forPvp: true,
      attributes: [],
      skills: ["Mystic Regeneration", null, null, null, null, null, null, null],
    });
    expect(blobs?.[6]).toBe("forHero forPvp");
  });

  it("records the profession beside the entity, so the two can be read together", async () => {
    // Public dashboards cannot use template variables, so a real drilldown is out.
    // Recording the profession on the same row is what makes a two-level
    // profession/entity reading possible with a flat query.
    const blobs = await call("get_skill", { name: "Word of Healing" });
    expect(blobs?.[5]).toBe("Word of Healing");
    expect(blobs?.[7]).toBe("Monk");
  });

  it("records 'none' for skills that belong to no profession", async () => {
    // Common and PvE-only skills have no profession; the dataset says "none"
    // rather than null, and that distinction is worth keeping visible.
    const blobs = await call("get_skill", { name: "Asuran Scan" });
    expect(blobs?.[7]).toBe("none");
  });

  it("leaves the entity empty for tools that resolve no single entity", async () => {
    const blobs = await call("search_skills", { professionName: "Monk", limit: 1 });
    expect(blobs?.[2]).toBe("search_skills");
    expect(blobs?.[5]).toBe("");
  });

  it("writes nothing at all when the binding is absent", async () => {
    // Analytics is optional: the service must work without it, unchanged.
    const res = await createApp().request("/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "get_skill", arguments: { name: "Aegis" } },
      }),
    });
    expect(res.status).toBe(200);
  });
});

describe("client attribution on initialize", () => {
  const send = async (clientInfo: unknown) => {
    const points: { blobs?: string[] }[] = [];
    const env = { MCP_ANALYTICS: { writeDataPoint: (p: (typeof points)[0]) => points.push(p) } };
    await createApp().request(
      "/mcp",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo },
        }),
      },
      env,
    );
    return points[0]?.blobs?.[1];
  };

  it("records the client name so monitors can be told from real usage", async () => {
    // The point of this dimension: SentinelOracle made 1 620 initialize calls
    // and zero tool calls in a week. Counting connections per client against
    // tool calls overall separates the profiles without per-call correlation,
    // which a stateless server cannot do anyway.
    expect(await send({ name: "claude-code", version: "1.2.3" })).toBe("claude-code");
  });

  it("drops the version, which only adds fingerprinting", async () => {
    expect(await send({ name: "Cursor", version: "0.42.1" })).toBe("Cursor");
  });

  it("sanitises a hostile name rather than trusting it", async () => {
    // The dashboard is public and this value is caller-controlled — the same
    // reason tool names are bucketed into tool:_unknown.
    expect(await send({ name: '<script>alert("x")</script>' })).toBe("script alert x script");
    expect(await send({ name: "a|b;c`d" })).toBe("a b c d");
    expect(await send({ name: "a\nb\tc" })).toBe("a b c");
    // Readability is the point of this dimension, so a legitimate space survives.
    expect(await send({ name: "Claude Desktop" })).toBe("Claude Desktop");
  });

  it("bounds the length", async () => {
    expect((await send({ name: "z".repeat(500) }))?.length).toBe(64);
  });

  it("marks a missing or empty name rather than writing nothing", async () => {
    expect(await send({ version: "1.0" })).toBe("_unnamed");
    expect(await send({ name: "***" })).toBe("_unnamed");
  });
});

describe("usage analytics hook", () => {
  it("counts a tools/call by name through the optional binding, fail-soft otherwise", async () => {
    const points: { blobs?: string[]; indexes?: string[] }[] = [];
    const env = { MCP_ANALYTICS: { writeDataPoint: (p: (typeof points)[0]) => points.push(p) } };
    const app = createApp();

    await app.request(
      "/mcp",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "get_skill", arguments: { id: 1 } },
        }),
      },
      env,
    );
    // Two points per tool call, and the second MUST NOT reuse "tool:<name>":
    // the six panels that sum `blob1 LIKE 'tool:%'` would double every count.
    // blob2 is empty for anything but initialize — clientInfo only exists there.
    expect(points).toEqual([
      { blobs: ["tool:get_skill", ""], doubles: [1], indexes: ["tool:get_skill"] },
      {
        blobs: ["event:tool_call", "", "get_skill", "ok", "", "Healing Signet", "", "Warrior"],
        doubles: [1],
        indexes: ["event:tool_call"],
      },
    ]);
    expect(points.filter((p) => p.blobs?.[0]?.startsWith("tool:"))).toHaveLength(1);

    // non-JSON body: swallowed, nothing counted, request not broken. Asserted as
    // "no new points" rather than a fixed total, so adding a dimension later
    // cannot make this fail for the wrong reason — which is exactly what a hard
    // total did when the outcome point was introduced.
    const before = points.length;
    const res = await app.request(
      "/mcp",
      { method: "POST", headers: { "Content-Type": "text/plain" }, body: "not json" },
      env,
    );
    expect(res.status).toBeLessThan(500);
    expect(points).toHaveLength(before);
  });
});
describe("rate limiting", () => {
  const post = (app: ReturnType<typeof createApp>, env?: object) =>
    app.request(
      "/mcp",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          "CF-Connecting-IP": "203.0.113.7",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
      },
      env,
    );

  it("fails open when the binding is absent (dev/tests)", async () => {
    const res = await post(createApp());
    expect(res.status).not.toBe(429);
  });

  it("returns 429 with Retry-After when the limiter denies, keyed on the IP", async () => {
    const seen: string[] = [];
    const env = {
      RATE_LIMITER: {
        limit: async ({ key }: { key: string }) => {
          seen.push(key);
          return { success: false };
        },
      },
    };
    const res = await post(createApp(), env);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
    expect(seen).toEqual(["203.0.113.7"]);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toContain("Rate limit");
  });

  it("fails open (not 500) when the limiter itself throws", async () => {
    const env = {
      RATE_LIMITER: {
        limit: async () => {
          throw new Error("limiter backend unavailable");
        },
      },
    };
    const res = await post(createApp(), env);
    expect(res.status).not.toBe(429);
    expect(res.status).not.toBe(500);
  });

  // Both spellings, both tests: the limit was registered on the bare path only,
  // so "/mcp/" — an endpoint this app deliberately serves — had no ceiling at all
  // and buffered the body before failing to parse it (audit M1, 2026-08-08).
  for (const path of ["/mcp", "/mcp/"]) {
    it(`rejects an oversized body on ${path} with 413 before processing (GW1-AUD-01)`, async () => {
      const res = await createApp().request(path, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": String(600 * 1024) },
        body: "x".repeat(10),
      });
      expect(res.status).toBe(413);
    });
    it(`rejects a real oversized body on ${path} without a Content-Length header (GW1-RESTE-02)`, async () => {
      // A Content-Length-only check is bypassable (omitted header, chunked
      // transfer, or a forged small value). hono/body-limit counts actual bytes
      // read, so a genuinely large body is caught even when no length is declared.
      const res = await createApp().request(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "x".repeat(600 * 1024),
      });
      expect(res.status).toBe(413);
    });
  }
  it("passes through when the limiter allows", async () => {
    const env = { RATE_LIMITER: { limit: async () => ({ success: true }) } };
    const res = await post(createApp(), env);
    expect(res.status).not.toBe(429);
  });

  // Audit N1: a batch was the only place where one HTTP request — one unit of the
  // per-IP quota — carried N operations. 3100 get_skill calls fitted under the
  // 512 KiB body limit and cost 1.4 s of work for one unit.
  for (const path of ["/mcp", "/mcp/"]) {
    it(`rejects a JSON-RPC batch on ${path} with -32600 (audit N1)`, async () => {
      const batch = Array.from({ length: 3 }, (_, i) => ({
        jsonrpc: "2.0",
        id: i,
        method: "tools/list",
        params: {},
      }));
      const res = await createApp().request(path, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify(batch),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe(-32600);
      expect(body.error.message).toMatch(/batching is not supported/);
    });
  }

  it("still rejects an oversized batch as 413, not as a batch (order matters)", async () => {
    // bodyLimit must stay AHEAD of the batch check: otherwise a huge body gets
    // buffered and inspected before being refused for its size.
    const res = await createApp().request("/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: `[${"x".repeat(600 * 1024)}]`,
    });
    expect(res.status).toBe(413);
  });

  it("a single request object is unaffected by the batch check", async () => {
    const { status, message } = await rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(status).toBe(200);
    expect(message.result.tools.length).toBeGreaterThan(0);
  });

  it("leaves the content-type answer to the transport", async () => {
    // The batch check runs on every POST, so it must not answer for a body the
    // transport would refuse on its content type: a text/plain body starting
    // with "[" answered 400 instead of 415 until the check was narrowed to JSON.
    const res = await createApp().request("/mcp", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "[1,2,3]",
    });
    expect(res.status).toBe(415);
  });
});
