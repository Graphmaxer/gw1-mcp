import { decodeTemplate } from "@gw1-mcp/gw-template";
import { bench, describe } from "vitest";
import { describeTemplate, resolveNamedBuild, type NamedBuild } from "../src/build-io.js";
import { createServer } from "../src/server.js";
import { validateBuild } from "../src/validate.js";

/**
 * Two layers are measured: the pure compiler stages (resolve names -> ids,
 * validate against the game rules, enrich a decoded template) and a full
 * tools/call round trip through the MCP SDK, which is what a client actually
 * pays for.
 */

/** Critical Scythe Assassin — a legal, full 8-skill bar. */
const GOLDEN_CODE = "OwpiMypMBg1cxcBAMBdmtIKAA";
const GOLDEN_TEMPLATE = decodeTemplate(GOLDEN_CODE);

const NAMED_BUILD: NamedBuild = {
  primary: "Dervish",
  secondary: "Monk",
  attributes: [
    { attribute: "Mysticism", rank: 12 },
    { attribute: "Scythe Mastery", rank: 12 },
    { attribute: "Earth Prayers", rank: 3 },
  ],
  skills: [
    "Avatar of Balthazar",
    "Mystic Sweep",
    "Eremite's Attack",
    "Mystic Regeneration",
    "Vow of Piety",
    "Heart of Holy Flame",
    "Pious Restoration",
    "Resurrection Signet",
  ],
};

/** Same bar with one misspelling: exercises the suggestion path on failure. */
const TYPO_BUILD: NamedBuild = {
  ...NAMED_BUILD,
  skills: [...NAMED_BUILD.skills.slice(0, 7), "Resurection Signet"],
};

describe("build compiler", () => {
  bench("resolveNamedBuild — full bar, all names resolve", () => {
    resolveNamedBuild(NAMED_BUILD);
  });

  bench("resolveNamedBuild — unknown skill (suggestion path)", () => {
    resolveNamedBuild(TYPO_BUILD);
  });

  bench("validateBuild — legal player bar", () => {
    validateBuild(GOLDEN_TEMPLATE);
  });

  bench("validateBuild — hero bar (extra PvE-only rules)", () => {
    validateBuild(GOLDEN_TEMPLATE, { forHero: true });
  });

  bench("describeTemplate — enrich a decoded bar", () => {
    describeTemplate(GOLDEN_TEMPLATE);
  });
});

/**
 * Constructing the server: 8 tools and 3 resources, each with its zod schemas.
 * Paid once per isolate before any request is answered, so it is part of the same
 * budget as the handlers themselves.
 *
 * This replaces four `tools/call` benchmarks that drove the real MCP client over an
 * in-memory transport. They were async, and CodSpeed warns that async profiles can
 * lose stack information to the event loop — `tools/list` reported 221 ms against
 * ~17 ms measured under plain Node. They were also redundant: every tool's actual
 * work is already benchmarked synchronously above, so what the round trip added was
 * protocol plumbing plus noise.
 */
describe("server construction", () => {
  bench("createServer — 8 tools + 3 resources", () => {
    createServer();
  });
});
