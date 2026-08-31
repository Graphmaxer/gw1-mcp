/**
 * Tolerant name matching, in its own module with ZERO imports.
 *
 * It lives here rather than in repository.ts because two very different runtimes
 * need it and only one of them can load that file: the import script runs on bare
 * `node` (see the ONE script archetype in CLAUDE.md), while repository.ts imports
 * the generated JSON without an import attribute — legal under vitest and
 * wrangler, a hard failure under bare node.
 *
 * Sharing the FUNCTION rather than a copy of the rule is the whole point. The
 * French alias map is built by asserting that no alias collides with an English
 * name under this normaliser; a second implementation that drifted by one
 * character would make that guarantee a lie while every test still passed.
 */

/**
 * Lowercase, strip diacritics and punctuation — tolerant name matching.
 *
 * The ligature fold is not decoration. NFD does not decompose `œ`, so the strip
 * below DELETED it: "Vœu de révolution" normalised to "vu de revolution" and missed,
 * while upstream spells the same name "Voeu de révolution". Folding to the digraph
 * makes both spellings meet. It cannot change any English lookup — no English skill,
 * hero, profession, attribute or campaign name contains either ligature — so this is
 * a pure widening.
 *
 * It folds INSIDE the strip rather than in two passes of its own, and that is a
 * measured decision, not a style one. The obvious form —
 * `.replace(/œ/g, "oe").replace(/æ/g, "ae")` before the strip — costs **+39.6%** on
 * this function over the 2974 real names, because it adds two whole-string regex
 * passes to the hottest function in the package: `searchSkills` normalises every
 * name, `resolveNamedBuild` eight, every lookup one. CodSpeed caught it on the PR
 * that introduced it (six regressed benchmarks, all of them downstream of this).
 * Both ligatures are already outside `[a-z0-9 ]`, so the strip visits them anyway;
 * a replacer function turns three passes back into one for **+2.3%**, with output
 * verified identical on all 2974 names plus the ligature and punctuation edge cases.
 */
export function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, (c) => (c === "\u0153" ? "oe" : c === "\u00e6" ? "ae" : ""))
    .replace(/\s+/g, " ")
    .trim();
}
