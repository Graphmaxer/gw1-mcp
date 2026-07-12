import { Hono } from "hono";
import { StreamableHTTPTransport } from "@hono/mcp";
import { FAVICON_PNG_B64 } from "./favicon.generated.js";
import { createServer } from "@gw1-mcp/gw-mcp";

/**
 * Fetch-native Streamable HTTP wrapper around the gw1-mcp server.
 * The same app runs unchanged on Cloudflare Workers and on Node.
 *
 * Stateless mode: a fresh McpServer per request. All tools are pure
 * lookups over bundled data, so there is no session state to keep,
 * which is exactly what a Workers deployment wants.
 */
export function createApp(): Hono {
  const app = new Hono();

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

  // Favicon: a 32x32 PNG derived at build time from the single source logo
  // (assets/brand/logo-1024.png → scripts/generate-favicon.mjs). Served here
  // and also at /favicon.ico via the conventional path. The full-resolution
  // logo is never shipped in the Worker bundle; directory listings upload the
  // 1024px PNG from assets/brand/ directly on their forms.
  const FAVICON_PNG = Uint8Array.from(atob(FAVICON_PNG_B64), (ch) => ch.charCodeAt(0));
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
        "no request content is persisted by the application. The service runs on",
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
    const token = (c.env as Record<string, string | undefined> | undefined)?.[
      "OPENAI_APPS_CHALLENGE"
    ];
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
    const server = createServer();
    const transport = new StreamableHTTPTransport();
    await server.connect(transport);
    return transport.handleRequest(c);
  });

  return app;
}
