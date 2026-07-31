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
 * documented amplification risk in the codebase (GW1-AUD-01, O(n*m) over 1485
 * names). Both are measured here on the real dataset.
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
