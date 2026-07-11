import { serve } from "@hono/node-server";
import { createApp } from "./app.js";

// Local Node entry point: pnpm --filter @gw1-mcp/gw-worker dev:node
function main(): void {
  const port = Number(process.env["PORT"] ?? 8787);
  serve({ fetch: createApp().fetch, port });
  console.log(`gw1-mcp listening on http://localhost:${port}/mcp`);
}

const isDirectRun =
  process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isDirectRun) main();
