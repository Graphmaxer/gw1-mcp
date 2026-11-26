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

/**
 * Whether the request has the JSON media type, with optional parameters.
 *
 * Every middleware that reads the body gates on this, so none of them can act on
 * (refuse, or count) a request that will be answered 415. It is stricter than the
 * transport's own test, a case-sensitive substring match, in both directions:
 * `checkContentType` therefore answers the 415 itself and rewrites an accepted
 * header to the canonical spelling, which is what keeps the two from disagreeing.
 * Change one and check the other.
 */
export const isJsonRequest = (c: Context<AppEnv>): boolean =>
  c.req.header("Content-Type")?.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
