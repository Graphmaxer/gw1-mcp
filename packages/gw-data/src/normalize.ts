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
 * What it bought was measured too: 18 French names carry the "oe" digraph (Vœu,
 * Cœur, Chœur, Œil, bœuf, Mœbius), upstream spells all 18 with "oe" and none with a
 * ligature, and WITHOUT the fold every one of them lands at edit distance 2 from its
 * own French name — far inside MAX_SUGGEST_DISTANCE. So the suggester answers all 18
 * with the correct English name. The degradation is one round trip on 18 skills for
 * a caller who types the ligature, against ~10% forever for everyone; the suggester
 * exists precisely so a near-miss self-corrects in one round trip.
 *
 * Reopen only with a measurement, not a preference: a fold that is genuinely free,
 * or evidence that the round trip actually costs something. `getSkillByName` also
 * still accepts the id, and the unaccented "voeu de piete" resolves exactly.
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
