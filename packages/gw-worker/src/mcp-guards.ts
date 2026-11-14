import type { Context, MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import type { AppEnv } from "./env.js";
import { isJsonRequest, rpcError } from "./rpc.js";

/**
 * Everything that stands between a request and the MCP transport, one guard per
 * export. `app.ts` registers them on both spellings of the endpoint and decides
 * their ORDER, which is load-bearing: the body limit runs before the rate
 * limiter and before anything reads the body, and the batch refusal runs after
 * the body limit so an oversized batch still answers 413.
 */

// CORS (B1). The previous state was the worst of both worlds: no CORS headers
// at all AND a 405 on preflight, so no browser MCP client (web playgrounds,
// MCP Inspector in a tab, some directory validators) could reach the server —
// while the Origin check let every https origin through anyway. Opening it is
// safe *here* specifically: the service is public, read-only and
// credential-free, so "*" grants a browser nothing curl does not already have.
// There is no cookie, no session and no Authorization header to ride on.
export const mcpCors: MiddlewareHandler<AppEnv> = cors({
  origin: "*",
  allowMethods: ["POST", "GET", "OPTIONS"],
  allowHeaders: ["Content-Type", "Accept", "Mcp-Session-Id", "Mcp-Protocol-Version"],
  exposeHeaders: ["Mcp-Session-Id", "Mcp-Protocol-Version"],
  maxAge: 86400,
});

// no-store is /mcp only, and deliberately so: those answers are
// request-specific and must never come from a shared cache, whereas the
// discovery document, security.txt and the favicon are static and benefit from
// being cacheable.
export const noStore: MiddlewareHandler<AppEnv> = async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store");
};

const MAX_BODY_BYTES = 512 * 1024;
// Body-size ceiling, enforced before parsing or rate limiting (GW1-AUD-01).
// hono/body-limit counts bytes actually read from the stream — unlike a
// Content-Length check, it can't be bypassed by omitting/forging that header
// or using chunked transfer encoding (GW1-RESTE-02).
// useOnMcp, not app.use("/mcp", ...): this middleware WAS the one that drifted.
// Registered on the bare path only, "/mcp/" had no body ceiling at all, so
// adding one character to the URL bought an attacker the platform limit
// (~100 MB) buffered in an isolate and parsed twice when MCP_ANALYTICS is
// bound. Found by an external audit on 2026-08-08, which reproduced it: 600
// KiB to /mcp answered 413, the same body to /mcp/ answered 400 after being
// fully read. Both spellings are covered by tests now.
export const mcpBodyLimit: MiddlewareHandler<AppEnv> = bodyLimit({
  maxSize: MAX_BODY_BYTES,
  onError: (c) => rpcError(c, 413, -32600, "Request body too large (max 512 KiB)."),
});

// Per-IP rate limit, evaluated before any parsing or analytics work.
// Optional binding (absent in dev/tests -> fail-open), same philosophy as
// MCP_ANALYTICS: protection must never break the service it protects.
export const rateLimit: MiddlewareHandler<AppEnv> = async (c, next) => {
  const limiter = c.env?.RATE_LIMITER;
  if (limiter) {
    const key = c.req.header("CF-Connecting-IP") ?? "unknown";
    // Fail-open on ANY limiter fault, not just a missing binding (GW1-08):
    // if limit() rejects or returns an unexpected shape, an uncaught throw
    // here would 500 the request — the opposite of "protection must never
    // break the service". A limiter outage degrades to "no limit", logged.
    let allowed = true;
    try {
      const result = await limiter.limit({ key });
      allowed = result?.success !== false;
    } catch (err) {
      console.error("rate limiter faulted, failing open:", err);
    }
    if (!allowed) {
      return rpcError(
        c,
        429,
        -32000,
        "Rate limit exceeded (100 requests/minute per IP). Retry shortly.",
        { "Retry-After": "60" },
      );
    }
  }
  await next();
};

// Origin-header validation (directory technical requirement): when a
// browser context sends an Origin, require https. Non-browser MCP clients
// send no Origin and are unaffected. This is the proportionate control for
// a public, read-only, credential-free server (DNS-rebinding protection
// targets local servers; there is no session or state here to ride).
export const checkOrigin: MiddlewareHandler<AppEnv> = async (c, next) => {
  const origin = c.req.header("Origin");
  // Parse the Origin rather than string-prefixing (GW1-12): startsWith
  // "https://" accepts "https://evil.example" and even "https://" as a
  // substring prefix of a crafted value. We require a well-formed https
  // Origin with a real host. Non-browser MCP clients send no Origin and are
  // unaffected; this stays proportionate for a public read-only server.
  if (origin !== undefined) {
    let ok = false;
    try {
      const u = new URL(origin);
      // Loopback over http is the project's own `dev:node` flow; rejecting it
      // was a false negative against ourselves. The MCP spec's DNS-rebinding
      // advice targets servers bound to localhost, which this is not.
      const isLoopback =
        u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1");
      ok = (u.protocol === "https:" && u.hostname.length > 0) || isLoopback;
    } catch {
      ok = false;
    }
    if (!ok) {
      return c.json({ error: "forbidden origin" }, 403);
    }
  }
  await next();
};

// No JSON-RPC batching (audit N1, 2026-08-08). This is the last amplification
// path left: every other guard in this file reasons per REQUEST — the body
// limit, the pwnd slot cap, the bounded Levenshtein — and the rate limiter
// counts HTTP requests, so a batch was the one place where one request was
// many operations. Measured: a single 508 KiB POST carrying 3100 get_skill
// calls fits under the 512 KiB ceiling, returns 3100 results, and costs one
// unit of the 100/min/IP quota — a ~139 s/min/IP work ceiling under Node.
//
// Rejecting is also the conformant answer, not just the cheap one: MCP
// 2025-06-18 REMOVED batching (spec PR #416) and every later revision keeps it
// removed. The SDK still lists 2025-03-26 and 2024-11-05 as supported
// versions and @hono/mcp still parses arrays, so this has to be refused here
// rather than assumed absent. Unconditional on purpose: no real client batches,
// and gating it on a negotiated version would mean tracking session state this
// stateless server does not have.
//
// Registered with useOnMcp and AFTER bodyLimit, both deliberately: M1 in this
// same audit was a middleware registered on one path spelling only, and an
// oversized batch must still 413 rather than be buffered and inspected here.
export const refuseBatch: MiddlewareHandler<AppEnv> = async (c, next) => {
  // JSON bodies only. Without this the check ran first and answered 400 for a
  // `text/plain` body starting with "[", where the transport answers 415 —
  // silently changing a documented response code. Measured under real workerd
  // 2026-08-11. Nothing is lost: a non-JSON batch never reaches any work,
  // because the transport refuses the content type before parsing.
  if (!isJsonRequest(c)) return next();
  // First non-whitespace character only — a body of up to 512 KiB does not
  // need JSON.parse to answer "is the top level an array?".
  const body = await c.req.raw.clone().text();
  if (/^\s*\[/.test(body)) {
    return rpcError(
      c,
      400,
      -32600,
      "JSON-RPC batching is not supported: send one request object per HTTP POST. Batching was removed from MCP in revision 2025-06-18.",
    );
  }
  await next();
};

// B2/B3. In stateless mode there is no session to resume and no server->client
// notification to stream, so a GET opened an SSE body that never closed (100
// danglers per IP per minute, since the limiter only counts the opening
// request) and a DELETE 200'd on a session that does not exist. The Streamable
// HTTP spec explicitly allows 405 for both; that is the honest answer.
export const methodNotAllowed = (c: Context<AppEnv>) =>
  rpcError(
    c,
    405,
    -32000,
    "This server is stateless: only POST /mcp is supported (no SSE stream, no sessions to delete).",
    { Allow: "POST, OPTIONS" },
  );
