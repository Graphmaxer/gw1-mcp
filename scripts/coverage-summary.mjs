// Aggregates per-package vitest coverage (json-summary) into one markdown
// table, counting SRC files only (maintenance scripts are untested by design
// — see CLAUDE.md), and enforces per-package line-coverage floors so coverage
// can never silently regress. Run after:
//   pnpm -r run test --coverage.enabled=true --coverage.reporter=json-summary
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Floors sit ~2 points under the measured values at introduction (2026-07-14)
// — raise them as coverage improves, never lower them without a written why.
const FLOORS = { "gw-template": 96, "gw-data": 92, "gw-mcp": 94, "gw-worker": 98 };

const rows = [];
const failures = [];
for (const pkg of readdirSync("packages")) {
  let summary;
  try {
    summary = JSON.parse(readFileSync(join("packages", pkg, "coverage", "coverage-summary.json")));
  } catch {
    continue; // package without tests/coverage
  }
  const acc = { lines: [0, 0], statements: [0, 0], branches: [0, 0], functions: [0, 0] };
  for (const [file, m] of Object.entries(summary)) {
    if (file === "total" || !file.includes("/src/")) continue;
    for (const k of Object.keys(acc)) {
      acc[k][0] += m[k].covered;
      acc[k][1] += m[k].total;
    }
  }
  const pct = (k) => (acc[k][1] === 0 ? 100 : (100 * acc[k][0]) / acc[k][1]);
  const lines = pct("lines");
  rows.push(
    `| ${pkg} | ${lines.toFixed(1)}% | ${pct("statements").toFixed(1)}% | ${pct("branches").toFixed(1)}% | ${pct("functions").toFixed(1)}% |`,
  );
  const floor = FLOORS[pkg];
  if (floor !== undefined && lines < floor) {
    failures.push(`${pkg}: ${lines.toFixed(1)}% lines < floor ${floor}%`);
  }
}

console.log("### Coverage (src files)\n");
console.log("| Package | Lines | Statements | Branches | Functions |");
console.log("| --- | --- | --- | --- | --- |");
for (const r of rows) console.log(r);
console.log("\n_Line-coverage floors enforced per package (see scripts/coverage-summary.mjs)._");

if (failures.length) {
  console.error("\nCoverage regression:\n - " + failures.join("\n - "));
  process.exit(1);
}
