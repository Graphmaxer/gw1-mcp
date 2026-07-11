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

  app.all("/mcp", async (c) => {
    const server = createServer();
    const transport = new StreamableHTTPTransport();
    await server.connect(transport);
    return transport.handleRequest(c);
  });

  return app;
}
