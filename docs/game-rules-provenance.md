# Where each validated game rule comes from

This exists because the rules were originally asserted from knowledge, not from
sources, and two of them turned out to be wrong once checked. A build compiler that
enforces a rule the game does not have is worse than one that misses a rule: it
rejects legal builds, and the user has no way to tell it is the tool that is wrong.

**Status of the 24 validator codes: 7 verified, 5 partial, 3 unverified, 5 not game
rules.** The unverified ones are named below rather than quietly assumed. Sources are
cited inline at each rule in `packages/gw-mcp/src/validate.ts`.

## Verified against primary sources

| Rule                        | Source                                                                                                                                                                                                                                             |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `INVALID_SKILL_COUNT`       | wiki.guildwars.com/wiki/Skill — "to a maximum of 8 skills (including at most one elite skill) at a time"                                                                                                                                           |
| `MULTIPLE_ELITES`           | same sentence; the exception (multiple elites transiently after a capture, until zoning) does not apply to a template built in an outpost                                                                                                          |
| `ATTRIBUTE_POINTS_EXCEEDED` | wiki Attribute_point — 200 total, being 170 at level 20 plus two 15-point quests. The `RANK_COST` table is cross-checked on five independent figures: rank 7 = 28, rank 9 = 48, rank 12 = 97, 11→12 costs 20, 6→7 costs 7                          |
| `RANK_OUT_OF_RANGE`         | wiki Attribute_point — "rank 12 is the highest rank obtainable by spending points"                                                                                                                                                                 |
| `TOO_MANY_PVE_SKILLS`       | wiki List_of_PvE-only_skills — "can only equip three PvE-only skills at a time"; wiki Elite_skill dates the cap to the 23 August 2007 update. Signet of Capture COUNTS (fandom Signet_of_Capture), which this validator got wrong until 2026-07-31 |
| `PVE_ONLY_ON_HERO`          | wiki Signet_of_Capture — "cannot be equipped for PvP or by heroes"; Talk:List_of_PvE-only_skills for the general case                                                                                                                              |
| `PVE_ONLY_ON_PVP_BUILD`     | wiki PvP_Access_Kit — "not possible for PvP characters to learn or use these skills"                                                                                                                                                               |

## Partial: the mechanism is sourced, the exact wording is not

- `PRIMARY_ATTRIBUTE_ON_SECONDARY` — wiki Attribute establishes that primary
  attributes belong to the primary profession, but no sentence states the template
  consequence directly.
- `PROFESSION_MISMATCH` — wiki Skill: "only characters of the respective profession
  can use it". Sufficient for the rule, silent on common and PvE-only skills, which
  the code handles separately.
- `ATTRIBUTE_NOT_TEMPLATABLE` — title tracks are not attribute-point attributes, which
  follows from wiki Title but is not stated as a template restriction.
- `PVP_VERSION_ON_PVE_BUILD`, `PVE_VERSION_ON_PVP_BUILD` — wiki Skill describes split
  versions that "update automatically when in each respective zone". That supports
  treating them as distinct, not the strictness of rejecting the wrong one.

## Unverified — treat with suspicion

- **`SAME_PROFESSIONS`** rejects primary == secondary. Believed correct, no source
  found. If the game permits it (or represents "no secondary" that way in some
  template), this rule rejects a legal build.
- **`ATTRIBUTE_PROFESSION_MISMATCH`** rejects points in an attribute belonging to
  neither profession on the bar. A corollary of `PROFESSION_MISMATCH` rather than a
  sourced rule.
- **`DUPLICATE_SKILL`** rejects the same skill twice. Correct for ordinary skills as
  far as anyone reports, and the one documented exception — up to three copies of
  Signet of Capture — is handled. But the general prohibition is not sourced.

## Not game rules

`DUPLICATE_ATTRIBUTE`, `NO_PRIMARY`, `UNKNOWN_SKILL`, `UNKNOWN_ATTRIBUTE`,
`UNKNOWN_PRIMARY`, `UNKNOWN_SECONDARY`, `SKILL_NOT_UNLOCKED`, `UNUSED_ATTRIBUTE`,
`UNALLOCATED_ATTRIBUTE`. These check request coherence, name resolution, or build
quality. `SKILL_NOT_UNLOCKED` depends on the caller's own account state.

## What is NOT a hallucination risk

Skill statistics, hero ids, professions, campaigns and attribute links all come from
upstream (`@buildwars/gw-skilldata` and GWToolboxpp's `Constants.h`), not from
anyone's recollection. Their risk is provenance and licensing, which is tracked
separately, plus upstream defects — one of which we found and fixed (the enum comment
that shifted every hero id).

Measurements in this repository are measurements: CPU times, bundle sizes and
benchmark figures were taken, not estimated. Where a number came from Node rather
than workerd, that is stated at the number, because the gap has been material twice.

## How to close a gap

Cite a primary source at the rule in `validate.ts`, prefer wiki.guildwars.com over
Fandom where both exist, and add a test that fails when the rule is disabled. If a
source contradicts the code, the source wins — that is how the Signet of Capture
defect was found.
