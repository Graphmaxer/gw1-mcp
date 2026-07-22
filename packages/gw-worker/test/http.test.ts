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
  it("serves the Glama ownership file only when configured", async () => {
    const app = createApp();
    expect((await app.request("/.well-known/glama.json")).status).toBe(404);
    const res = await app.request(
      "/.well-known/glama.json",
      {},
      { GLAMA_MAINTAINER_EMAIL: "owner@example.com" },
    );
    expect(await res.json()).toEqual({
      $schema: "https://glama.ai/mcp/schemas/connector.json",
      maintainers: [{ email: "owner@example.com" }],
    });
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
    expect(points).toEqual([
      { blobs: ["tool:get_skill"], doubles: [1], indexes: ["tool:get_skill"] },
    ]);

    // non-JSON body: swallowed, nothing counted, request not broken
    const res = await app.request(
      "/mcp",
      { method: "POST", headers: { "Content-Type": "text/plain" }, body: "not json" },
      env,
    );
    expect(res.status).toBeLessThan(500);
    expect(points).toHaveLength(1);
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

  it("rejects an oversized body with 413 before processing (GW1-AUD-01)", async () => {
    const res = await createApp().request("/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": String(600 * 1024) },
      body: "x".repeat(10),
    });
    expect(res.status).toBe(413);
  });
  it("rejects a real oversized body even without a Content-Length header (GW1-RESTE-02)", async () => {
    // A Content-Length-only check is bypassable (omitted header, chunked
    // transfer, or a forged small value). hono/body-limit counts actual bytes
    // read, so a genuinely large body is caught even when no length is declared.
    const res = await createApp().request("/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "x".repeat(600 * 1024),
    });
    expect(res.status).toBe(413);
  });
  it("passes through when the limiter allows", async () => {
    const env = { RATE_LIMITER: { limit: async () => ({ success: true }) } };
    const res = await post(createApp(), env);
    expect(res.status).not.toBe(429);
  });
});
