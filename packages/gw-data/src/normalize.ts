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
 * The ligature fold is not decoration. NFD does not decompose `œ`, so the final
 * `[^a-z0-9 ]` strip DELETED it: "Vœu de révolution" normalised to "vu de
 * revolution" and missed, while upstream spells the same name "Voeu de révolution".
 * Folding to the digraph makes both spellings meet. It cannot change any English
 * lookup — no English skill, hero, profession, attribute or campaign name contains
 * either ligature — so this is a pure widening.
 */
export function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\u0153/g, "oe")
    .replace(/\u00e6/g, "ae")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
