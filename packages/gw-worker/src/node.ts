import { serve } from "@hono/node-server";
import { pathToFileURL } from "node:url";
import { createApp } from "./app.js";

// Local Node entry point: pnpm --filter @gw1-mcp/gw-worker dev:node
function main(): void {
  const port = Number(process.env["PORT"] ?? 8787);
  // Bind loopback by default (GW1-12): the MCP transport spec recommends local
  // servers listen on 127.0.0.1 to avoid exposing a dev instance on the LAN.
  // Override with HOST=0.0.0.0 deliberately if you really want external access.
  const hostname = process.env["HOST"] ?? "127.0.0.1";
  serve({ fetch: createApp().fetch, port, hostname });
  console.log(`gw1-mcp listening on http://${hostname}:${port}/mcp`);
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) main();
