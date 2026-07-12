// Guards server.json against the MCP Registry schema constraints that the
// publish step enforces (learned the hard way: a 255-char description was
// silently rejected). Run in CI so a bad edit fails the PR, not the release.
import { readFileSync } from "node:fs";
const d = JSON.parse(readFileSync(new URL("../server.json", import.meta.url)));
const errs = [];
if (!/^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/.test(d.name)) errs.push("name pattern");
if (d.name.length < 3 || d.name.length > 200) errs.push("name length 3-200");
if (!d.description || d.description.length < 1 || d.description.length > 100)
  errs.push(`description length 1-100 (got ${d.description?.length})`);
if (!d.version || d.version.length > 255) errs.push("version length");
if (d.title && d.title.length > 100) errs.push("title length <=100");
for (const r of d.remotes ?? [])
  if (!/^https?:\/\/[^\s]+$/.test(r.url)) errs.push(`remote url ${r.url}`);
if (errs.length) {
  console.error("server.json invalid:\n - " + errs.join("\n - "));
  process.exit(1);
}
console.log("server.json OK for the MCP Registry schema");
