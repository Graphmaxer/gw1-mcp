import { Hono } from "hono";
import type { Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { StreamableHTTPTransport } from "@hono/mcp";
import { createServer, TOOL_NAMES } from "@gw1-mcp/gw-mcp";

/**
 * Fetch-native Streamable HTTP wrapper around the gw1-mcp server.
 * The same app runs unchanged on Cloudflare Workers and on Node.
 *
 * Stateless mode: a fresh McpServer per request. All tools are pure
 * lookups over bundled data, so there is no session state to keep,
 * which is exactly what a Workers deployment wants.
 */
/**
 * @param faviconPng raw bytes of the 32x32 PNG favicon. The real entry point
 * (index.ts, the only file wrangler bundles) imports the PNG and passes it;
 * tests call createApp() with no argument, so the test path never imports a
 * binary asset — that's why no vitest asset config is needed.
 */
/** Minimal shape of the Analytics Engine binding (avoids a types package). */
interface AnalyticsEngineDataset {
  writeDataPoint(point: { blobs?: string[]; doubles?: number[]; indexes?: string[] }): void;
}

// THE tool list is imported from gw-mcp's single source of truth
// (tool-names.ts): registrations there are compiler-checked against the
// same union, so this set cannot drift from what the server exposes.
const KNOWN_TOOLS = new Set<string>(TOOL_NAMES);

// JSON-RPC methods are MCP protocol constants (spec-stable), not project
// state — the one acceptable literal list here.
const KNOWN_METHODS = new Set([
  "initialize",
  "ping",
  "tools/list",
  "tools/call",
  "resources/list",
  "resources/read",
  "resources/templates/list",
  "notifications/initialized",
  "notifications/cancelled",
]);

type AppEnv = {
  Bindings: {
    OPENAI_APPS_CHALLENGE?: string;
    GLAMA_MAINTAINER_EMAIL?: string;
    RATE_LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> };
    MCP_ANALYTICS?: AnalyticsEngineDataset;
  };
};

export function createApp(faviconPng: ArrayBuffer | Uint8Array = new Uint8Array()): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // Response hardening (B4), on EVERY route rather than just /mcp: the routes a
  // browser or a directory scanner actually visits are /, /privacy and
  // /.well-known/*, and those were the ones left bare.
  app.use("*", async (c, next) => {
    await next();
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "no-referrer");
  });

  // Single source of truth for cross-endpoint strings (repo URL appeared in
  // three places, the trademark disclaimer in two).
  const REPO_URL = "https://github.com/Graphmaxer/gw1-mcp";
  const DISCLAIMER =
    "Unofficial fan-made tool. Guild Wars is a registered trademark of NCSoft Corporation; not affiliated with or endorsed by NCSoft or ArenaNet.";
  // Security contact derives from the same place SECURITY.md points to:
  // GitHub private vulnerability reporting. No email to duplicate or scrape.
  const SECURITY_CONTACT = `${REPO_URL}/security/advisories/new`;
  // RFC 9116 requires Expires, but a value recomputed per request made the
  // response uncacheable and non-reproducible (every fetch returned a different
  // file). A fixed date is the conformant form; a test in test/http.test.ts
  // fails once it is under 30 days away, so CI asks for the bump instead of the
  // file silently expiring.
  const SECURITY_TXT_EXPIRES = "2027-07-01T00:00:00.000Z";

  app.get("/", (c) =>
    c.json({
      name: "gw1-mcp",
      description: "A Guild Wars 1 build compiler for LLMs",
      endpoint: "/mcp",
      transport: "streamable-http",
      repository: REPO_URL,
      disclaimer: DISCLAIMER,
    }),
  );

  // Favicon: 32x32 PNG (assets/brand/favicon-32.png, a 32px export of
  // logo-1024.png), passed in by index.ts. Served here and at /favicon.ico.
  const FAVICON_PNG = new Uint8Array(faviconPng);
  const serveFavicon = (c: { body: (b: BodyInit, init?: ResponseInit) => Response }) =>
    c.body(FAVICON_PNG as unknown as BodyInit, {
      headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" },
    });
  app.get("/favicon.ico", (c) => serveFavicon(c));
  app.get("/favicon.png", (c) => serveFavicon(c));
  app.get("/logo.png", (c) => serveFavicon(c));

  app.get("/privacy", (c) =>
    c.text(
      [
        "gw1-mcp privacy policy",
        "",
        "This service is a stateless, read-only compiler for Guild Wars 1 build",
        "data. It has no accounts, no authentication, and it does not collect,",
        "store, or share any personal data. Requests are processed in memory and",
        "no request content is persisted by the application. Aggregate,",
        "anonymous usage counters (the invoked tool's name only - never its",
        "arguments) are recorded for operational purposes. The service runs on",
        "Cloudflare Workers; Cloudflare may process standard operational metadata",
        "(such as IP addresses in transient logs) per its own privacy policy.",
        "Per-IP rate limiting sends the connecting IP to Cloudflare's Rate",
        "Limiting binding as a lookup key. Cloudflare may cache and synchronize",
        "the resulting counters within its own infrastructure per its rate-limit",
        "product's operation — this is not purely a local in-memory count. The",
        "application itself does not persist request content or write IP",
        "addresses to its own analytics dataset.",
        "",
        "",
        DISCLAIMER,
        "",
        `Contact: open an issue at ${REPO_URL}`,
      ].join("\n"),
    ),
  );

  // OpenAI Apps domain-verification challenge: the token is revealed during
  // submission; set it as a Worker variable (dash or wrangler.jsonc "vars").
  app.get("/.well-known/openai-apps-challenge", (c) => {
    const token = c.env?.["OPENAI_APPS_CHALLENGE"];
    return token ? c.text(token) : c.notFound();
  });

  // Glama connector ownership verification: Glama fetches this file from the
  // server's own domain and matches the email against the Glama account that
  // claims the listing. Email lives in a var (GLAMA_MAINTAINER_EMAIL) — it is
  // public by design, not a secret. Absent var → 404, same as the challenge.
  app.get("/.well-known/glama.json", (c) => {
    const email = c.env?.["GLAMA_MAINTAINER_EMAIL"];
    return email
      ? c.json({
          $schema: "https://glama.ai/mcp/schemas/connector.json",
          maintainers: [{ email }],
        })
      : c.notFound();
  });

  // security.txt (RFC 9116): points researchers to the same GitHub private
  // vulnerability reporting SECURITY.md uses — Contact is a URL, not an email,
  // so nothing is duplicated or exposed to scrapers.
  app.get("/.well-known/security.txt", (c) => {
    // Canonical must match the URL the file is actually served from, so derive
    // it from the request instead of hardcoding the workers.dev host — the
    // hardcoded value silently became wrong the moment a custom domain existed.
    const canonical = `${new URL(c.req.url).origin}/.well-known/security.txt`;
    return c.text(
      [
        `Contact: ${SECURITY_CONTACT}`,
        `Expires: ${SECURITY_TXT_EXPIRES}`,
        `Policy: ${REPO_URL}/blob/main/SECURITY.md`,
        "Preferred-Languages: en, fr",
        `Canonical: ${canonical}`,
      ].join("\n"),
      200,
      { "Content-Type": "text/plain; charset=utf-8" },
    );
  });

  // Forge registry (forgeregistry.com) domain-verification claim, served the
  // same way as security.txt above — a well-known file only does its job if
  // it's actually fetchable at the real domain, not just sitting in git.
  // Static identity assertion only: no CI or publish-permission changes
  // involved, unlike the rest of that site's suggested "AI prompt" steps
  // (npm publish/OIDC), which this project doesn't use and won't add.
  app.get("/.well-known/forge.json", (c) =>
    c.json({ publisher: "Graphmaxer" }, 200, { "Content-Type": "application/json; charset=utf-8" }),
  );

  // Origin-header validation (directory technical requirement): when a
  // browser context sends an Origin, require https. Non-browser MCP clients
  // send no Origin and are unaffected. This is the proportionate control for
  // a public, read-only, credential-free server (DNS-rebinding protection
  // targets local servers; there is no session or state here to ride).
  // Per-IP rate limit, evaluated before any parsing or analytics work.
  // Body-size ceiling, enforced before parsing or rate limiting (GW1-AUD-01).
  // hono/body-limit counts bytes actually read from the stream — unlike a
  // Content-Length check, it can't be bypassed by omitting/forging that header
  // or using chunked transfer encoding (GW1-RESTE-02).
  // CORS (B1). The previous state was the worst of both worlds: no CORS headers
  // at all AND a 405 on preflight, so no browser MCP client (web playgrounds,
  // MCP Inspector in a tab, some directory validators) could reach the server —
  // while the Origin check let every https origin through anyway. Opening it is
  // safe *here* specifically: the service is public, read-only and
  // credential-free, so "*" grants a browser nothing curl does not already have.
  // There is no cookie, no session and no Authorization header to ride on.
  app.use(
    "/mcp",
    cors({
      origin: "*",
      allowMethods: ["POST", "GET", "OPTIONS"],
      allowHeaders: ["Content-Type", "Accept", "Mcp-Session-Id", "Mcp-Protocol-Version"],
      exposeHeaders: ["Mcp-Session-Id", "Mcp-Protocol-Version"],
      maxAge: 86400,
    }),
  );

  // no-store is /mcp only, and deliberately so: those answers are
  // request-specific and must never come from a shared cache, whereas the
  // discovery document, security.txt and the favicon are static and benefit from
  // being cacheable.
  app.use("/mcp", async (c, next) => {
    await next();
    c.header("Cache-Control", "no-store");
  });

  const MAX_BODY_BYTES = 512 * 1024;
  app.use(
    "/mcp",
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: (c) =>
        c.json(
          {
            jsonrpc: "2.0",
            id: null,
            error: { code: -32600, message: "Request body too large (max 512 KiB)." },
          },
          413,
        ),
    }),
  );

  // Optional binding (absent in dev/tests -> fail-open), same philosophy as
  // MCP_ANALYTICS: protection must never break the service it protects.
  app.use("/mcp", async (c, next) => {
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
        return c.json(
          {
            jsonrpc: "2.0",
            id: null,
            error: {
              code: -32000,
              message: "Rate limit exceeded (100 requests/minute per IP). Retry shortly.",
            },
          },
          429,
          { "Retry-After": "60" },
        );
      }
    }
    await next();
  });

  app.use("/mcp", async (c, next) => {
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
  });

  // B2/B3. In stateless mode there is no session to resume and no server->client
  // notification to stream, so a GET opened an SSE body that never closed (100
  // danglers per IP per minute, since the limiter only counts the opening
  // request) and a DELETE 200'd on a session that does not exist. The Streamable
  // HTTP spec explicitly allows 405 for both; that is the honest answer.
  const methodNotAllowed = (c: Context<AppEnv>) =>
    c.json(
      {
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32000,
          message:
            "This server is stateless: only POST /mcp is supported (no SSE stream, no sessions to delete).",
        },
      },
      405,
      { Allow: "POST, OPTIONS" },
    );
  app.get("/mcp", methodNotAllowed);
  app.delete("/mcp", methodNotAllowed);

  app.all("/mcp", async (c) => {
    // Usage analytics: count tool invocations by NAME only — never arguments,
    // never identities (see /privacy). Fail-soft by design: the binding is
    // optional (absent in local dev/tests) and any parse error is swallowed;
    // analytics must never cost a request.
    const analytics = c.env?.MCP_ANALYTICS;
    if (analytics && c.req.method === "POST") {
      try {
        const rpc = (await c.req.raw.clone().json()) as {
          method?: string;
          params?: { name?: string };
        };
        // Whitelisted labels only: the endpoint is public and probed by
        // registry validators and scanners sending arbitrary tool names —
        // recording the REQUESTED name verbatim would let anyone inject
        // labels into a public dashboard. Unknown names aggregate.
        // KEEP IN SYNC with the server's tools (locked by a test in
        // gw-worker test/http.test.ts against the real tool list).
        const label =
          rpc.method === "tools/call"
            ? KNOWN_TOOLS.has(rpc.params?.name ?? "")
              ? `tool:${rpc.params?.name}`
              : "tool:_unknown"
            : KNOWN_METHODS.has(rpc.method ?? "")
              ? `rpc:${rpc.method}`
              : "rpc:_other";
        analytics.writeDataPoint({ blobs: [label], doubles: [1], indexes: [label] });
      } catch {
        // non-JSON or unreadable body: nothing to count
      }
    }

    const server = createServer();
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
  });

  return app;
}
