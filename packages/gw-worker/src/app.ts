import { Hono } from "hono";
import type { Context, MiddlewareHandler } from "hono";
import { StreamableHTTPTransport } from "@hono/mcp";
import { createServer } from "@gw1-mcp/gw-mcp";
import { recordRequest, toolCallRecorder } from "./analytics.js";
import type { AppEnv } from "./env.js";
import {
  checkOrigin,
  mcpBodyLimit,
  mcpCors,
  methodNotAllowed,
  noStore,
  rateLimit,
  refuseBatch,
} from "./mcp-guards.js";
import { registerSiteRoutes } from "./site.js";

/**
 * Fetch-native Streamable HTTP wrapper around the gw1-mcp server.
 * The same app runs unchanged on Cloudflare Workers and on Node.
 *
 * Stateless mode: a fresh McpServer per request. All tools are pure
 * lookups over bundled data, so there is no session state to keep,
 * which is exactly what a Workers deployment wants.
 *
 * Assembly only. The static routes are in `site.ts`, each guard on /mcp is a
 * named middleware in `mcp-guards.ts`, the Analytics Engine writes are in
 * `analytics.ts`. What stays here is the ORDER they are registered in.
 */
export function createApp(faviconPng: ArrayBuffer | Uint8Array = new Uint8Array()): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // The endpoint answers on both spellings. Hono routes "/mcp/" as a distinct
  // path from "/mcp", so a client that builds its URL by joining a trailing
  // slash got a 404 and failed outright — measured 21 times in 7 days in Workers
  // Logs. Unlike the discovery documents we deliberately do not serve, the
  // capability here exists and only the path spelling differed, so accepting
  // both is interoperability rather than a false claim. Every middleware below
  // (CORS, hardening headers, body limit, origin check, analytics) is registered
  // against this same list so the two paths cannot drift apart.
  const MCP_PATHS = ["/mcp", "/mcp/"] as const;
  /** Register a middleware on every spelling of the endpoint at once. */
  const useOnMcp = (mw: MiddlewareHandler<AppEnv>) => {
    for (const path of MCP_PATHS) app.use(path, mw);
  };

  // Response hardening (B4), on EVERY route rather than just /mcp: the routes a
  // browser or a directory scanner actually visits are /, /privacy and
  // /.well-known/*, and those were the ones left bare.
  app.use("*", async (c, next) => {
    await next();
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "no-referrer");
  });

  registerSiteRoutes(app, faviconPng);

  // Order matters here, and every guard explains its own place in mcp-guards.ts.
  for (const guard of [mcpCors, noStore, mcpBodyLimit, rateLimit, checkOrigin, refuseBatch]) {
    useOnMcp(guard);
  }

  for (const path of MCP_PATHS) {
    app.get(path, methodNotAllowed);
    app.delete(path, methodNotAllowed);
  }

  const handleMcp = async (c: Context<AppEnv>) => {
    const analytics = c.env?.MCP_ANALYTICS;
    await recordRequest(c, analytics);

    const server = createServer({ onToolCall: toolCallRecorder(analytics) });
    const transport = new StreamableHTTPTransport();
    await server.connect(transport);
    // Deliberately NO try/finally { server.close() } here, despite the pair
    // being per-request. Measured 2026-07-24: adding it empties every response
    // (get_skill 1290 bytes -> 0, tools/list 19159 -> 0) while still returning
    // 200, because handleRequest hands back a Response whose body is produced
    // lazily after this function returns — closing the server closes the stream
    // before anything is written. @hono/mcp owns that lifecycle in stateless
    // mode. The repo's own tests do catch this (3 failures in test/http.test.ts),
    // which is the guardrail; this comment is so nobody "fixes" it again.
    return transport.handleRequest(c);
  };
  for (const path of MCP_PATHS) app.all(path, handleMcp);

  return app;
}
