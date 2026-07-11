import { serve } from "@hono/node-server";
import { createApp } from "./app.js";

// Local Node entry point: pnpm --filter @gw1-mcp/gw-worker dev:node
const port = Number(process.env["PORT"] ?? 8787);
serve({ fetch: createApp().fetch, port });
console.log(`gw1-mcp listening on http://localhost:${port}/mcp`);
