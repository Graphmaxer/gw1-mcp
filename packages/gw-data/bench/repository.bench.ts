import { bench, describe } from "vitest";
import {
  getSkillByName,
  normalizeName,
  searchSkills,
  skills,
  suggestSkillNames,
} from "../src/index.js";

/**
 * The repository is the CPU floor of every tool call: name resolution runs
 * 10 times for a single encode_template, and the suggestion path is the one
 * documented amplification risk in the codebase (GW1-AUD-01, O(n*m) over every
 * name). Both are measured here on the real dataset.
 *
 * WHICH MEANS EVERY BENCHMARK HERE MOVES ON A DATA-ONLY PR. They scan the whole
 * committed dataset, so importing new skills shifts them with no code change at
 * all — read a CodSpeed regression on `chore/update-game-data` against the size of
 * the import before looking for a cause in the diff, because there is no diff.
 * Measured on the 2026-08-31 import (+31 skills, +2%): "heal sig" went 0.2026 ms ->
 * 0.2295 ms, and the other two suggestion queries +8% and +24%. CodSpeed reported
 * -72.24% on that same query for that same import, with its "different runtime
 * environments" warning attached — the signature of the false positive the CodSpeed
 * section in CLAUDE.md documents. The `benchmarks` JOB was green; only the
 * dashboard-side check was red.
 *
 * The count is deliberately not written into this comment (the doc-count lock reads
 * "<number> skills" as a current claim, and a benchmark file is the last place that
 * should need editing after an import).
 */

/** Longest query the suggester accepts — the worst case it is bounded to. */
const MAX_SUGGEST_LEN = 64;

// The suggestion indexes are built lazily on first use (deliberately: most
// isolates never suggest anything). Warm them here so the benchmark measures
// the query, not the one-off index build.
suggestSkillNames("warmup");

describe("name lookup", () => {
  bench("normalizeName", () => {
    normalizeName("Vow of Piété!");
  });

  bench("getSkillByName — exact hit", () => {
    getSkillByName("Mystic Regeneration");
  });

  bench("getSkillByName — every skill in the dataset", () => {
    for (const skill of skills) getSkillByName(skill.name);
  });
});

describe("search", () => {
  bench("searchSkills — profession + elite filter", () => {
    searchSkills({ professionId: 1, elite: true });
  });

  bench("searchSkills — name substring over the full dataset", () => {
    searchSkills({ nameContains: "heal" });
  });

  bench("searchSkills — unfiltered (every non-PvP skill)", () => {
    searchSkills({});
  });
});

describe("fuzzy suggestions", () => {
  bench("suggestSkillNames — real misspelling", () => {
    suggestSkillNames("Mystik Regenaration");
  });

  bench("suggestSkillNames — token-prefix abbreviation", () => {
    suggestSkillNames("heal sig");
  });

  // The length-difference early exit is what keeps this from running 1485 full
  // edit-distance matrices; this is the input that used to cost ~109 ms.
  bench("suggestSkillNames — worst-case padded query", () => {
    suggestSkillNames("a".repeat(MAX_SUGGEST_LEN));
  });
});
