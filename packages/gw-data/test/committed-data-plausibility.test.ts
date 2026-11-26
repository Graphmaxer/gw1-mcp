import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  assertPlausibleDescription,
  assertPlausibleFrenchName,
  assertPlausibleName,
} from "../scripts/import/transform.ts";

/**
 * Re-runs the import's plausibility gates over the COMMITTED data.
 *
 * Why this exists when the import already applies them: the import is the
 * untrusted half of `update-data.yml`. That job executes an unpinned bundle from
 * upstream's GitHub Pages, so every check it performs is a check the same remote
 * code could skip, and what it hands the privileged `open-pr` job is a patch whose
 * CONTENT nothing there reads. `open-pr` restricts the patch to the generated
 * paths and flags a description that grew by more than 80 characters, and that is
 * all: a skill with no baseline, a same-length rewrite of an existing description
 * and every name sail through both. Replayed on 2026-11-26, a patch adding one
 * skill whose description was an instruction to a model plus a URL was applied
 * and answered `changed=false`, which arms auto-merge.
 *
 * This suite is the trusted half. It runs in the pull request's own CI, from test
 * code the patch cannot touch (the allowlist admits the data files only), so text
 * that the import job merely CLAIMED to have checked is checked again before the
 * weekly PR can merge. The gates are imported rather than restated, so the two
 * halves cannot drift apart.
 */
const read = <T>(file: string): T =>
  JSON.parse(readFileSync(new URL(`../data/${file}`, import.meta.url), "utf8")) as T;

interface Named {
  id: number;
  name: string;
}

describe("committed data passes the import's plausibility gates", () => {
  const skills = read<(Named & { description: string })[]>("skills.json");
  const frenchNames = read<Record<string, string>>("skill-names-fr.json");

  it("every skill name and description", () => {
    // Non-vacuous: a truncated or emptied file must not pass by checking nothing.
    expect(skills.length).toBeGreaterThan(1000);
    for (const skill of skills) {
      assertPlausibleName("skill", skill.id, skill.name);
      assertPlausibleDescription(skill.id, skill.name, skill.description);
    }
  });

  it("every French skill name", () => {
    const entries = Object.entries(frenchNames);
    expect(entries.length).toBeGreaterThan(1000);
    for (const [id, name] of entries) assertPlausibleFrenchName(id, name);
  });

  it("every campaign, profession, attribute and skill type name", () => {
    // The same patch carries these four tables, and their names reach a caller
    // through the same tools.
    for (const [kind, file] of [
      ["campaign", "campaigns.json"],
      ["profession", "professions.json"],
      ["attribute", "attributes.json"],
      ["skill type", "skill-types.json"],
    ] as const) {
      const rows = read<(Named & { abbr?: string })[]>(file);
      expect(rows.length, file).toBeGreaterThan(0);
      for (const row of rows) {
        assertPlausibleName(kind, row.id, row.name);
        if (row.abbr !== undefined) assertPlausibleName(`${kind} abbreviation`, row.id, row.abbr);
      }
    }
  });
});
