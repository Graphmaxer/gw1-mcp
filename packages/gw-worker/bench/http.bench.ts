import { bench, describe } from "vitest";
import { createApp } from "../src/app.js";

/**
 * The deployed shape of the server: a JSON-RPC message over the Streamable
 * HTTP transport, handled statelessly by the Hono app. The Worker sits at 77%
 * of a 10 ms per-request CPU budget, so this is the number that decides
 * whether a change is deployable, not just fast.
 */
const app = createApp();

const GOLDEN_CODE = "OwpiMypMBg1cxcBAMBdmtIKAA";

async function rpc(body: unknown): Promise<void> {
  const res = await app.request("/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify(body),
  });
  await res.text();
}

describe("streamable HTTP endpoint", () => {
  bench("GET / (discovery document)", async () => {
    await (await app.request("/")).text();
  });

  bench("POST /mcp — initialize", async () => {
    await rpc({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "bench", version: "0" },
      },
    });
  });

  // ~97.5% of real traffic is monitors running initialize + tools/list and
  // nothing else, so this is the single hottest request the service serves.
  bench("POST /mcp — tools/list", async () => {
    await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  });

  bench("POST /mcp — tools/call decode_template", async () => {
    await rpc({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "decode_template", arguments: { code: GOLDEN_CODE } },
    });
  });
});
