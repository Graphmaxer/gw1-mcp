import { bench, describe } from "vitest";
import { createApp } from "../src/app.js";

/**
 * What a COLD ISOLATE pays before it can answer anything: constructing the Hono
 * app, which registers every route and builds the MCP server with its 8 tools and
 * 3 resources. Production reports a 50 ms Worker startup and the service sits at
 * 77% of a 10 ms per-request CPU budget, so this construction cost is the part of
 * that budget a code change can actually move.
 *
 * Deliberately SYNCHRONOUS. This file previously benchmarked the HTTP endpoint by
 * awaiting `app.request(...)`, which measured nothing trustworthy: CodSpeed's own
 * documentation warns that execution profiles for async code can lose stack-trace
 * information to the event loop, and the numbers showed it — `tools/list` came back
 * at 221 ms where the same call measures ~17 ms under plain Node and production
 * averages 7.66 ms of CPU across ALL requests. A benchmark whose variance produces
 * false regressions is worse than none, because the whole suite stops being believed.
 *
 * The request paths those benchmarks aimed at are covered synchronously where the
 * work actually happens: the codec in gw-template, resolution and validation in
 * gw-mcp, lookups and suggestions in gw-data.
 */
describe("cold isolate", () => {
  bench("createApp — full worker, routes + MCP server", () => {
    createApp();
  });
});
