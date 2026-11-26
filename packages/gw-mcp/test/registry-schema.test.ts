import { readFileSync } from "node:fs";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";

// Snapshot from the MCP Registry release pinned in .github/pins.env when this
// fixture was added. Validate offline against the publisher's snapshot of the
// dated schema server.json declares, including its transport metadata.
const schema = JSON.parse(
  readFileSync(
    new URL("./fixtures/registry-server-2025-12-11.schema.json", import.meta.url),
    "utf8",
  ),
) as { $id: string };
const server = JSON.parse(
  readFileSync(new URL("../../../server.json", import.meta.url), "utf8"),
) as { $schema: string };
const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);
const validate = ajv.compile(schema);

describe("MCP Registry server.json", () => {
  it("conforms to the declared dated Registry schema", () => {
    expect(server.$schema).toBe(schema.$id);
    const valid = validate(server);
    expect.soft(validate.errors ?? [], "official-schema violations").toEqual([]);
    expect(valid).toBe(true);
  });

  it("rejects an unsupported remote transport", () => {
    expect(
      validate({ ...server, remotes: [{ type: "stdio", url: "https://example.org/mcp" }] }),
    ).toBe(false);
    expect(validate.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ instancePath: "/remotes/0/type" })]),
    );
  });
});
