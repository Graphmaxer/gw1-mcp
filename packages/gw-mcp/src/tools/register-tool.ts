import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * The registration function each tool module receives. It has the SDK's own
 * signature, so a tool's handler is typed from its input schema exactly as if it
 * were registered on the server directly; what `createServer` passes in is its
 * instrumented wrapper, which is how no tool can be registered unobserved.
 */
export type RegisterTool = McpServer["registerTool"];
