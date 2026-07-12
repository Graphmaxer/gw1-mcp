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
});

describe("favicon", () => {
  it("redirects the conventional path to the svg logo", async () => {
    const res = await createApp().request("/favicon.ico");
    expect(res.status).toBe(301);
    expect(res.headers.get("Location")).toBe("/logo.svg");
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
  it("serves a scalable svg logo", async () => {
    const res = await createApp().request("/logo.svg");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("<svg");
  });
});
