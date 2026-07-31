import { describe, expect, it } from "vitest";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { createServer } from "../src/server.js";
import type { ToolCallEvent } from "../src/events.js";

/**
 * These tests live in gw-mcp on purpose: the observer is a DOMAIN interface, and
 * nothing here mentions Analytics Engine, blobs or dashboards. The worker's job
 * is to translate; this package's job is to report accurately. If a future change
 * makes these tests need a Cloudflare type, the boundary has been broken.
 */
async function collect(
  call: (client: Client) => Promise<unknown>,
): Promise<readonly ToolCallEvent[]> {
  const events: ToolCallEvent[] = [];
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createServer({ onToolCall: (e) => events.push(e) });
  await server.connect(serverTransport);
  const client = new Client({ name: "test", version: "1" });
  await client.connect(clientTransport);
  await call(client);
  return events;
}

describe("tool call events", () => {
  it("reports the canonical entity name, not what the caller typed", async () => {
    // The caller's spelling is irrelevant: the name comes from OUR resolution,
    // which is what makes the value safe for a consumer to store publicly.
    const events = await collect((c) =>
      c.callTool({ name: "get_skill", arguments: { name: "mystic regeneration" } }),
    );
    expect(events).toEqual([{ tool: "get_skill", ok: true, entity: "Mystic Regeneration" }]);
  });

  it("reports a miss with its code, which is how unresolvable names get measured", async () => {
    // This is the signal that decides whether a French alias table is worth
    // building: how often real callers ask for something we cannot resolve.
    const events = await collect((c) =>
      c.callTool({ name: "get_skill", arguments: { name: "Régénération mystique" } }),
    );
    expect(events).toEqual([{ tool: "get_skill", ok: false, code: "NOT_FOUND" }]);
  });

  it("reports a requested report as a successful call carrying the first code", async () => {
    // validate_build returning invalid is not a failed CALL — the caller asked for
    // a verdict and got one. The first code is what they would fix first.
    const events = await collect((c) =>
      c.callTool({
        name: "validate_build",
        arguments: {
          primary: "Dervish",
          attributes: [],
          skills: ["Avatar of Balthazar", "Pious Renewal", null, null, null, null, null, null],
        },
      }),
    );
    expect(events[0]?.ok).toBe(true);
    expect(events[0]?.code).toBe("MULTIPLE_ELITES");
  });

  it("reports the context flags the caller actually set", async () => {
    const events = await collect((c) =>
      c.callTool({
        name: "validate_build",
        arguments: {
          primary: "Dervish",
          forHero: true,
          attributes: [],
          skills: ["Mystic Regeneration", null, null, null, null, null, null, null],
        },
      }),
    );
    expect(events[0]?.flags).toEqual(["forHero"]);
  });

  it("never reports the template code encode_template produced", async () => {
    // It is derived from caller input and has no aggregate meaning.
    const events = await collect((c) =>
      c.callTool({
        name: "encode_template",
        arguments: {
          primary: "Dervish",
          attributes: [{ attribute: "Scythe Mastery", rank: 12 }],
          skills: ["Eremite's Attack", null, null, null, null, null, null, null],
        },
      }),
    );
    expect(events[0]?.tool).toBe("encode_template");
    expect(JSON.stringify(events[0])).not.toMatch(/[A-Za-z0-9+/]{20,}/);
  });

  it("stays silent when no observer is passed", async () => {
    // The option is optional: stdio and tests must not need one.
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const server = createServer();
    await server.connect(st);
    const client = new Client({ name: "test", version: "1" });
    await client.connect(ct);
    await expect(
      client.callTool({ name: "get_skill", arguments: { name: "Aegis" } }),
    ).resolves.toBeDefined();
  });

  it("does not let a throwing observer break the tool call", async () => {
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const server = createServer({
      onToolCall: () => {
        throw new Error("observer exploded");
      },
    });
    await server.connect(st);
    const client = new Client({ name: "test", version: "1" });
    await client.connect(ct);
    const res = await client.callTool({ name: "get_skill", arguments: { name: "Aegis" } });
    expect(res.isError).not.toBe(true);
  });
});
