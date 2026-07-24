/**
 * Does an incoming data import change descriptions in a way that deserves human
 * eyes? (audit C1, calibrated against upstream history 2026-07-24.)
 *
 * The first version of this check withheld auto-merge whenever any description
 * line changed. Measuring build-wars/gw-skilldata proved that unworkable: 97% of
 * descriptions embed the numbers a balance patch edits, and legitimate upstream
 * commits reword text wholesale — 6e05969 changed 301 description fields in one
 * go ("spells does not" -> "spell[s] do[es] not"). A gate that fires every week
 * is not review, it is rubber-stamping.
 *
 * What an injected instruction looks like instead is ADDED TEXT. Across the
 * whole upstream history the largest growth of any single description in a
 * legitimate commit is +56 characters (distribution: 0, 0, 1, 10, 19, 53, 56
 * over the 7 commits that touch descriptions). 80 keeps a 1.4x margin over that
 * maximum while still catching a payload of ~81 characters or more; 120, tried
 * first, let a realistic 97-character injection through for no gain in false
 * positives, since every threshold from 60 upward fires 0/7 on real history.
 *
 * Second net, not the first: assertPlausibleDescription() in transform.ts
 * hard-fails the import on URLs, unexpected tags, over-length text and
 * instruction-shaped phrasing. This catches the shape such a payload has if it
 * dodges those patterns.
 *
 * Plain .mjs with no dependencies on purpose: this runs in the privileged
 * open-pr job, which has no pnpm install and must never gain one — that job
 * holds contents:write, and the whole point of the split is that it never
 * executes third-party code. Bare `node` can run this file as-is.
 *
 * @typedef {{ id: number, name: string, description: string }} SkillDescription
 * @typedef {{ id: number, name: string, growth: number, before: string, after: string }} GrowthFinding
 */

export const MAX_DESCRIPTION_GROWTH = 80;

/**
 * Descriptions that grew by more than the threshold, worst first.
 * @param {readonly SkillDescription[]} before
 * @param {readonly SkillDescription[]} after
 * @param {number} [threshold]
 * @returns {GrowthFinding[]}
 */
export function findDescriptionGrowth(before, after, threshold = MAX_DESCRIPTION_GROWTH) {
  const previous = new Map(before.map((s) => [s.id, s]));
  const findings = [];
  for (const skill of after) {
    const old = previous.get(skill.id);
    // A brand-new skill has no baseline to grow from; its text still goes
    // through the plausibility gate at import time.
    if (!old) continue;
    const growth = skill.description.length - old.description.length;
    if (growth > threshold) {
      findings.push({
        id: skill.id,
        name: skill.name,
        growth,
        before: old.description,
        after: skill.description,
      });
    }
  }
  return findings.sort((a, b) => b.growth - a.growth);
}
