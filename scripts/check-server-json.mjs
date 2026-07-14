// Guards server.json against the MCP Registry schema BEFORE the publish step
// rejects it (learned the hard way: a 255-char description was silently
// rejected). Validation runs against the LIVE official schema — the exact one
// server.json declares in its $schema field — so registry schema evolutions
// are caught here instead of at publish time. If the schema cannot be fetched
// (network hiccup, registry site down), a minimal hardcoded fallback keeps
// the guard protective without making CI flaky.
//
// Usage: node scripts/check-server-json.mjs [schema-url-or-local-path]
import { readFileSync } from "node:fs";
import Ajv from "ajv";
import addFormats from "ajv-formats";

const server = JSON.parse(readFileSync(new URL("../server.json", import.meta.url)));
const source = process.argv[2] ?? server.$schema;

function fallbackChecks(reason) {
  console.warn(`::warning::schema unavailable (${reason}); minimal hardcoded checks only`);
  const errs = [];
  if (!/^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/.test(server.name)) errs.push("name pattern");
  if (!server.description || server.description.length > 100)
    errs.push(`description length 1-100 (got ${server.description?.length})`);
  if (!server.version || server.version.length > 255) errs.push("version length");
  return errs;
}

let errs;
try {
  const raw = source.startsWith("http")
    ? await (await fetch(source)).text()
    : readFileSync(source, "utf8");
  const schema = JSON.parse(raw);
  const ajv = new Ajv({ strict: false, allErrors: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  errs = validate(server)
    ? []
    : validate.errors.map((e) => `${e.instancePath || "(root)"} ${e.message}`);
  if (errs.length === 0) {
    console.log(`server.json valid against the official schema (${schema.$id ?? source})`);
  }
} catch (cause) {
  errs = fallbackChecks(cause.message ?? String(cause));
  if (errs.length === 0) console.log("server.json OK (fallback checks)");
}

if (errs.length) {
  console.error("server.json invalid:\n - " + errs.join("\n - "));
  process.exit(1);
}
