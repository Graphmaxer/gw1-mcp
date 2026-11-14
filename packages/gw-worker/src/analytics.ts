import { TOOL_NAMES } from "@gw1-mcp/gw-mcp";
import type { ToolCallEvent } from "@gw1-mcp/gw-mcp";
import type { Context } from "hono";
import type { AnalyticsEngineDataset, AppEnv } from "./env.js";
import { isJsonRequest } from "./rpc.js";

/**
 * Everything written to Analytics Engine, and nothing else. Two kinds of point:
 * one per HTTP request (which method, which tool was asked for, which client
 * announced itself) and one per tool call that actually ran (its outcome). Both
 * are fail-soft: the binding is optional and analytics must never cost a request.
 */

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

/**
 * Bounded, printable client name for a PUBLIC dashboard. Only ever called on
 * `initialize`, so a missing name yields "_unnamed" rather than "" — an empty
 * blob means "not an initialize" and the two must stay distinguishable.
 *
 * Allow-list, not escaping: anything outside letters, digits and `. _ @ -`
 * becomes a space. That covers every realistic client name
 * (claude-code, Cursor, mcp-inspector) while removing angle brackets, quotes,
 * slashes, parentheses and control characters, so the value cannot be mistaken
 * for markup or break a table cell.
 */
function sanitizeClientName(name: unknown): string {
  if (typeof name !== "string") return "_unnamed";
  const cleaned = name
    // Disallowed characters become a space, not nothing: dropping them would
    // mash words together ("Claude<>Desktop" -> "ClaudeDesktop").
    .replace(/[^A-Za-z0-9._@-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 64);
  return cleaned.length > 0 ? cleaned : "_unnamed";
}

/** Counts one incoming request by kind. Reads a CLONE of the body, never the body. */
export async function recordRequest(
  c: Context<AppEnv>,
  analytics: AnalyticsEngineDataset | undefined,
): Promise<void> {
  // Usage analytics: count tool invocations by NAME only — never arguments,
  // never identities (see /privacy). Fail-soft by design: the binding is
  // optional (absent in local dev/tests) and any parse error is swallowed;
  // analytics must never cost a request.
  // JSON bodies only: the transport answers 415 to anything else, and counting a
  // `tools/call` it is about to refuse inflated the public tool counters with
  // calls that never ran (and JSON-parsed a body nothing would ever read).
  if (analytics && c.req.method === "POST" && isJsonRequest(c)) {
    try {
      const rpc = (await c.req.raw.clone().json()) as {
        method?: string;
        params?: { name?: string; clientInfo?: { name?: string } };
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
      // blob2: which software is talking, recorded on `initialize` only —
      // that is the one message carrying clientInfo, and a stateless server has
      // no session to attach it to afterwards. Counting connections per client
      // against tool calls overall is enough to tell the profiles apart without
      // per-call correlation: SentinelOracle made 1 620 initialize calls and
      // zero tool calls, which is an unmistakable monitor signature, whereas a
      // real user shows few connections and many calls.
      //
      // Sanitised, NOT whitelisted. A whitelist would need hand-maintaining and
      // would bucket every new client as "_other", which defeats the purpose;
      // blob cardinality is explicitly unlimited in Analytics Engine (the index
      // is what samples, and the index here is unchanged). But clientInfo.name
      // is caller-controlled and this dashboard is public, so the value is
      // charset-restricted and length-bounded — same reasoning as tool:_unknown.
      // The version is deliberately dropped: the name answers the question and
      // a version only adds fingerprinting.
      const client =
        rpc.method === "initialize" ? sanitizeClientName(rpc.params?.clientInfo?.name) : "";
      analytics.writeDataPoint({ blobs: [label, client], doubles: [1], indexes: [label] });
    } catch {
      // non-JSON or unreadable body: nothing to count
    }
  }
}

// Domain events from gw-mcp, translated here into Analytics Engine points.
// gw-mcp knows nothing about blobs or datasets — it reports what happened and
// this layer decides how to store it. Written as a SEPARATE data point under
// blob1 = "event:tool_call": reusing "tool:<name>" would double every count in
// the six panels that already sum `blob1 LIKE 'tool:%'`.
//
// Blob layout for this dataset (positions carry one meaning each; unused
// positions are simply absent):
//   blob1  kind — "tool:<name>" / "rpc:<method>" / "event:tool_call"
//   blob2  client name, on rpc:initialize only
//   blob3  tool that ran           (event:tool_call)
//   blob4  "ok" | "error"          (event:tool_call)
//   blob5  our own error / first validation code
//   blob6  canonical entity resolved from our data
//   blob7  context flags the caller set, space separated
//   blob8  profession of the resolved entity ("Monk", or "none")
export function toolCallRecorder(
  analytics: AnalyticsEngineDataset | undefined,
): (event: ToolCallEvent) => void {
  return (event) => {
    analytics?.writeDataPoint({
      blobs: [
        "event:tool_call",
        "",
        event.tool,
        event.ok ? "ok" : "error",
        event.code ?? "",
        event.entity ?? "",
        (event.flags ?? []).join(" "),
        event.profession ?? "",
      ],
      doubles: [1],
      indexes: ["event:tool_call"],
    });
  };
}
