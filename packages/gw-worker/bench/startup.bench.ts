import { bench, describe } from "vitest";
import { createApp } from "../src/app.js";

/**
 * Constructing the Hono app: route registration only.
 *
 * Note what this does NOT measure. `createServer` is called INSIDE the /mcp handler
 * (app.ts, per request), not here, so the expensive half of a cold isolate is absent:
 * measured locally, `createApp` is 0.07 ms against `createServer` at 2.0 ms, so this is
 * about 3.5% of real startup. `createServer` has its own benchmark in gw-mcp, and that
 * is the number to watch.
 *
 * Kept anyway, with a caveat: at roughly 1 ms in simulation it is the smallest benchmark
 * in the suite and therefore the noisiest. On 2026-08-01 it reported a 16% regression on
 * a commit that changed one error-message string and some comments — code the benchmark
 * never executes. CodSpeed itself flagged "different runtime environments", and every
 * other benchmark drifted the same direction (-3%, -1%), which is the signature of
 * environment noise rather than a targeted change.
 *
 * So: a regression here is worth a look at `createServer` first, and worth checking
 * whether the whole run drifted, BEFORE assuming route registration got slower. Deleting
 * it would have been the easy answer to a red check; the honest one is to record what it
 * can and cannot tell you.
 */
describe("cold isolate", () => {
  bench("createApp — routes only, not the MCP server", () => {
    createApp();
  });
});
