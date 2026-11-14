import type { Context } from "hono";
import type { AppEnv } from "./env.js";

/**
 * The one JSON-RPC error envelope every refusal on /mcp answers with. `id` is
 * null because none of these refusals has parsed a request to echo an id from.
 */
export function rpcError(
  c: Context<AppEnv>,
  status: 400 | 405 | 413 | 429,
  code: number,
  message: string,
  headers?: Record<string, string>,
) {
  return c.json({ jsonrpc: "2.0", id: null, error: { code, message } }, status, headers);
}

/**
 * Whether the transport will treat this body as JSON. Deliberately the same
 * test the transport applies and nothing smarter: every middleware that reads
 * the body gates on it, so none of them can act on (refuse, or count) a request
 * the transport is about to answer 415 to.
 */
export const isJsonRequest = (c: Context<AppEnv>): boolean =>
  c.req.header("Content-Type")?.includes("application/json") === true;
