import { Hono } from "hono";
import { StreamableHTTPTransport } from "@hono/mcp";
import { createServer } from "@gw1-mcp/gw-mcp";

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

type AppEnv = {
  Bindings: { OPENAI_APPS_CHALLENGE?: string; MCP_ANALYTICS?: AnalyticsEngineDataset };
};

export function createApp(faviconPng: ArrayBuffer | Uint8Array = new Uint8Array()): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", (c) =>
    c.json({
      name: "gw1-mcp",
      description: "A Guild Wars 1 build compiler for LLMs",
      endpoint: "/mcp",
      transport: "streamable-http",
      repository: "https://github.com/Graphmaxer/gw1-mcp",
      disclaimer:
        "Unofficial fan-made tool. Guild Wars is a registered trademark of NCSoft Corporation; not affiliated with or endorsed by NCSoft or ArenaNet.",
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
        "",
        "",
        "Unofficial fan-made tool. Guild Wars is a registered trademark of",
        "NCSoft Corporation; not affiliated with or endorsed by NCSoft or",
        "ArenaNet.",
        "",
        "Contact: open an issue at https://github.com/Graphmaxer/gw1-mcp",
      ].join("\n"),
    ),
  );

  // OpenAI Apps domain-verification challenge: the token is revealed during
  // submission; set it as a Worker variable (dash or wrangler.jsonc "vars").
  app.get("/.well-known/openai-apps-challenge", (c) => {
    const token = c.env?.["OPENAI_APPS_CHALLENGE"];
    return token ? c.text(token) : c.notFound();
  });

  // Origin-header validation (directory technical requirement): when a
  // browser context sends an Origin, require https. Non-browser MCP clients
  // send no Origin and are unaffected. This is the proportionate control for
  // a public, read-only, credential-free server (DNS-rebinding protection
  // targets local servers; there is no session or state here to ride).
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
        const label =
          rpc.method === "tools/call" && rpc.params?.name
            ? `tool:${rpc.params.name}`
            : `rpc:${rpc.method ?? "unknown"}`;
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
