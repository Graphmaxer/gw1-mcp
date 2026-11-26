/**
 * Tests written from a mutation pass (2026-11-26, 261 hand-made mutants): each
 * one kills a small semantic change to the source that the suite let through
 * while reporting full line coverage. They assert exact values against the data
 * on purpose; a looser assertion is how each of these mutants survived.
 */
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";

const JSON_HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json, text/event-stream",
};
const PING = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" });
const limiter = (answer: unknown, calls: string[] = []) => ({
  RATE_LIMITER: {
    limit: async ({ key }: { key: string }) => {
      calls.push(key);
      return answer;
    },
  },
});

describe("CORS preflight", () => {
  it("allows the headers an MCP browser client sends, and caches the answer for a day", async () => {
    const res = await createApp().request("/mcp", {
      method: "OPTIONS",
      headers: {
        Origin: "https://inspector.example",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type, mcp-protocol-version",
      },
    });
    const allowed = (res.headers.get("access-control-allow-headers") ?? "")
      .split(",")
      .map((h) => h.trim().toLowerCase());
    expect(allowed).toEqual(["content-type", "accept", "mcp-session-id", "mcp-protocol-version"]);
    expect(res.headers.get("access-control-max-age")).toBe("86400");
  });
});

describe("rate limiter", () => {
  it("fails open on an answer that is not a verdict (undefined, {}), and serves the call", async () => {
    for (const answer of [undefined, {}, { success: true }]) {
      const res = await createApp().request(
        "/mcp",
        { method: "POST", headers: JSON_HEADERS, body: PING },
        limiter(answer),
      );
      expect(res.status, JSON.stringify(answer)).toBe(200);
    }
  });

  it("answers 429 in the JSON-RPC error envelope, id null", async () => {
    const res = await createApp().request(
      "/mcp",
      { method: "POST", headers: JSON_HEADERS, body: PING },
      limiter({ success: false }),
    );
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32000, message: expect.stringContaining("Rate limit exceeded") },
    });
  });
});

describe("guard order", () => {
  it("consults the limiter before judging the size of the body", async () => {
    // The limiter never needs the body, so a throttled caller is refused before
    // any of it is read (the streamed case is in http.test.ts).
    const calls: string[] = [];
    const res = await createApp().request(
      "/mcp",
      {
        method: "POST",
        headers: { ...JSON_HEADERS, "Content-Length": String(600 * 1024) },
        body: "x",
      },
      limiter({ success: false }, calls),
    );
    expect(res.status).toBe(429);
    expect(calls).toHaveLength(1);
  });

  it("counts a request against the limiter before judging its Origin", async () => {
    const calls: string[] = [];
    const res = await createApp().request(
      "/mcp",
      { method: "POST", headers: { ...JSON_HEADERS, Origin: "http://evil.test" }, body: PING },
      limiter({ success: false }, calls),
    );
    expect(res.status).toBe(429);
    expect(calls).toHaveLength(1);
  });

  it("answers 405, not a batch refusal, to a non-POST that carries a JSON array", async () => {
    const res = await createApp().request("/mcp", {
      method: "DELETE",
      headers: JSON_HEADERS,
      body: "[]",
    });
    expect(res.status).toBe(405);
  });
});

describe("body limit sits at exactly 512 KiB", () => {
  const padded = (bytes: number) => PING + " ".repeat(bytes - PING.length);
  it("serves 524288 bytes and refuses 524289", async () => {
    const ok = await createApp().request("/mcp", {
      method: "POST",
      headers: JSON_HEADERS,
      body: padded(512 * 1024),
    });
    expect(ok.status).toBe(200);
    const over = await createApp().request("/mcp", {
      method: "POST",
      headers: JSON_HEADERS,
      body: padded(512 * 1024 + 1),
    });
    expect(over.status).toBe(413);
  });
});

describe("origin and media type edges", () => {
  const post = (headers: Record<string, string>) =>
    createApp().request("/mcp", {
      method: "POST",
      headers: { ...JSON_HEADERS, ...headers },
      body: PING,
    });

  it("accepts both loopback spellings over http and nothing else on loopback", async () => {
    expect((await post({ Origin: "http://localhost:8787" })).status).toBe(200);
    expect((await post({ Origin: "http://127.0.0.1:8787" })).status).toBe(200);
    expect((await post({ Origin: "ftp://localhost" })).status).toBe(403);
  });

  it("accepts whitespace before the media type parameters", async () => {
    expect((await post({ "Content-Type": "application/json ; charset=utf-8" })).status).toBe(200);
  });
});

describe("request labels", () => {
  it("labels every known JSON-RPC method by name", async () => {
    const labels: string[] = [];
    const env = {
      MCP_ANALYTICS: { writeDataPoint: (p: { blobs: string[] }) => labels.push(p.blobs[0]!) },
    };
    const methods = [
      "initialize",
      "ping",
      "tools/list",
      "tools/call",
      "resources/list",
      "resources/read",
      "resources/templates/list",
      "notifications/initialized",
      "notifications/cancelled",
    ];
    for (const method of methods.filter((m) => m !== "tools/call")) {
      await createApp().request(
        "/mcp",
        {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method }),
        },
        env,
      );
    }
    expect(labels).toEqual(methods.filter((m) => m !== "tools/call").map((m) => `rpc:${m}`));
  });
});

describe("static routes", () => {
  it("lets /terms be cached for an hour", async () => {
    const res = await createApp().request("/terms");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=3600");
  });
});
