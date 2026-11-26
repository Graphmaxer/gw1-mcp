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
 * French name table is built by asserting that no French name collides with an
 * English one under this normaliser; a second implementation that drifted by one
 * character would make that guarantee a lie while every test still passed. That is
 * also why the œ decision below is resolved HERE and not by adding a second,
 * query-only normaliser.
 *
 * NO LIGATURE FOLD, and this is the deliberate part. NFD does not decompose `œ`, so
 * the strip below deletes it: a French speaker typing "Vœu de piété" — the
 * typographically correct spelling — normalises to "vu de piete" while upstream
 * writes "Voeu de piété", so the exact lookup MISSES. Folding œ -> oe fixes that and
 * was shipped for exactly one commit, until CodSpeed measured what it cost: about
 * 10% on this function, whichever form it takes (an inline replacer in the strip,
 * +10.3%; a guarded pre-pass, +7.9%, interleaved medians over the 2970 real names).
 * This is the hottest function in the package — `searchSkills` runs it on every
 * name, `resolveNamedBuild` eight times, every lookup once — so that is a permanent
 * tax on every caller, including the ~97.5% of traffic that never types a French
 * word.
 *
 * For names containing the ligature, `suggestSkillNames` folds it before testing
 * exact French aliases. This finds the correct English name before unrelated fuzzy
 * matches and keeps the cost on the suggestion path. With the digraph, such as
 * "voeu de piete", exact lookup already works.
 *
 * Reopen the fold HERE only with a measurement, not a preference: a fold that is
 * genuinely free on this function, or evidence that the suggestion round trip
 * costs something. The original measurements are in docs/handbook/audits.md.
 */

/** Lowercase, strip diacritics and punctuation — tolerant name matching. */
export function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
