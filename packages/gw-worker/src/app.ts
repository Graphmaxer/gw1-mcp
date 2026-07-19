import { Hono } from "hono";
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
  "prompts/list",
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

  // Single source of truth for cross-endpoint strings (repo URL appeared in
  // three places, the trademark disclaimer in two).
  const REPO_URL = "https://github.com/Graphmaxer/gw1-mcp";
  const DISCLAIMER =
    "Unofficial fan-made tool. Guild Wars is a registered trademark of NCSoft Corporation; not affiliated with or endorsed by NCSoft or ArenaNet.";
  // Security contact derives from the same place SECURITY.md points to:
  // GitHub private vulnerability reporting. No email to duplicate or scrape.
  const SECURITY_CONTACT = `${REPO_URL}/security/advisories/new`;

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
        "Per-IP rate limiting uses the connecting IP as an in-memory counter",
        "key at the edge; we never store it.",
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
  app.get("/.well-known/security.txt", (c) =>
    c.text(
      [
        `Contact: ${SECURITY_CONTACT}`,
        `Policy: ${REPO_URL}/blob/main/SECURITY.md`,
        "Preferred-Languages: en, fr",
        `Canonical: https://gw1-mcp.graphmaxer.workers.dev/.well-known/security.txt`,
      ].join("\n"),
      200,
      { "Content-Type": "text/plain; charset=utf-8" },
    ),
  );

  // Origin-header validation (directory technical requirement): when a
  // browser context sends an Origin, require https. Non-browser MCP clients
  // send no Origin and are unaffected. This is the proportionate control for
  // a public, read-only, credential-free server (DNS-rebinding protection
  // targets local servers; there is no session or state here to ride).
  // Per-IP rate limit, evaluated before any parsing or analytics work.
  // Optional binding (absent in dev/tests -> fail-open), same philosophy as
  // MCP_ANALYTICS: protection must never break the service it protects.
  app.use("/mcp", async (c, next) => {
    const limiter = c.env?.RATE_LIMITER;
    if (limiter) {
      const key = c.req.header("CF-Connecting-IP") ?? "unknown";
      const { success } = await limiter.limit({ key });
      if (!success) {
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
    if (origin !== undefined && !origin.startsWith("https://")) {
      return c.json({ error: "forbidden origin" }, 403);
    }
    await next();
  });

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
    return transport.handleRequest(c);
  });

  return app;
}
