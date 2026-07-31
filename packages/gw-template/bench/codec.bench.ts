import { bench, describe } from "vitest";
import { decodeTemplate, encodeTemplate } from "../src/index.js";
import fixtureFile from "../test/fixtures/templates.json";

/**
 * The codec is the one piece of this server that runs on every single
 * encode/decode tool call, so it is measured on the same corpus the
 * correctness tests use: real codes from the game client, PvXwiki and
 * @buildwars/gw-templates, not synthetic bit patterns.
 */
const CORPUS: readonly string[] = fixtureFile.fixtures.map((f) => f.code);

/** Critical Scythe Assassin — a full 8-skill bar with 3 attributes. */
const MODERN_CODE = "OwpiMypMBg1cxcBAMBdmtIKAA";
const MODERN_TEMPLATE = decodeTemplate(MODERN_CODE);

/** Pre-2007 header dialect (4-bit version, no template type). */
const LEGACY_CODE = "ABJRkncAAAoVAAAAAAAA";

/** Same bar, followed by 10k legal zero-padding chars. */
const PADDED_CODE = MODERN_CODE + "A".repeat(10_000);

describe("decode", () => {
  bench("decodeTemplate — modern full bar", () => {
    decodeTemplate(MODERN_CODE);
  });

  bench("decodeTemplate — legacy pre-2007 header", () => {
    decodeTemplate(LEGACY_CODE);
  });

  bench("decodeTemplate — 27-code golden corpus", () => {
    for (const code of CORPUS) decodeTemplate(code);
  });

  // Trailing zero chars are legal padding (the client pads to an even length),
  // so an oversized code is accepted input, not a rejected one — this measures
  // the zero-tail scan that GW1-01/GW1-02 made O(1) in memory and keeps a
  // regression there visible.
  bench("decodeTemplate — 10k chars of zero padding", () => {
    decodeTemplate(PADDED_CODE);
  });
});

describe("encode", () => {
  bench("encodeTemplate — modern full bar", () => {
    encodeTemplate(MODERN_TEMPLATE);
  });

  bench("round-trip encode(decode(code))", () => {
    encodeTemplate(decodeTemplate(MODERN_CODE));
  });
});
