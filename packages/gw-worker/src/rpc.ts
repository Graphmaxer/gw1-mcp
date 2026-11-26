import type { Context } from "hono";
import type { AppEnv } from "./env.js";

/**
 * The one JSON-RPC error envelope every refusal on /mcp answers with. `id` is
 * null because none of these refusals has parsed a request to echo an id from.
 */
export function rpcError(
  c: Context<AppEnv>,
  status: 400 | 405 | 413 | 415 | 429,
  code: number,
  message: string,
  headers?: Record<string, string>,
) {
  return c.json({ jsonrpc: "2.0", id: null, error: { code, message } }, status, headers);
}

/** Whether the request has the JSON media type, with optional parameters. */
export const isJsonRequest = (c: Context<AppEnv>): boolean =>
  c.req.header("Content-Type")?.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
