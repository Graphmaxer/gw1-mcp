import { readFileSync } from "node:fs";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";

/**
 * Guards server.json against the MCP Registry schema BEFORE the publish step
 * rejects it (learned the hard way: a 255-char description was silently
 * rejected). Validates against the LIVE official schema — the exact one
 * server.json declares in its $schema field — so registry schema evolutions
 * are caught by CI instead of at publish time. Offline runs (no network)
 * fall back to the critical hardcoded constraints with a warning, so the
 * suite stays green off-grid while CI (which has network) validates fully.
 */
describe("MCP Registry server.json", () => {
  const server = JSON.parse(
    readFileSync(new URL("../../../server.json", import.meta.url), "utf8"),
  ) as { $schema: string; name: string; description?: string; version?: string };

  it("conforms to the official registry schema (live), or to the critical floors offline", async () => {
    let schema: object | undefined;
    try {
      const res = await fetch(server.$schema, { signal: AbortSignal.timeout(10_000) });
      schema = (await res.json()) as object;
    } catch {
      console.warn("registry schema unreachable — falling back to critical hardcoded checks");
    }

    if (schema) {
      const ajv = new Ajv({ strict: false, allErrors: true });
      addFormats(ajv);
      const validate = ajv.compile(schema);
      const valid = validate(server);
      expect.soft(validate.errors ?? [], "official-schema violations").toEqual([]);
      expect(valid).toBe(true);
    } else {
      expect(server.name).toMatch(/^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/);
      expect(server.description ?? "").not.toBe("");
      expect((server.description ?? "").length).toBeLessThanOrEqual(100);
      expect((server.version ?? "").length).toBeLessThanOrEqual(255);
    }
  });
});
