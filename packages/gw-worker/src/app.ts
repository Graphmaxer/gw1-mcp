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
export function createApp(): Hono {
  const app = new Hono();

  app.get("/", (c) =>
    c.json({
      name: "gw1-mcp",
      description: "A Guild Wars 1 build compiler for LLMs",
      endpoint: "/mcp",
      transport: "streamable-http",
      repository: "https://github.com/Graphmaxer/gw1-mcp",
    }),
  );

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

  app.all("/mcp", async (c) => {
    const server = createServer();
    const transport = new StreamableHTTPTransport();
    await server.connect(transport);
    return transport.handleRequest(c);
  });

  return app;
}
