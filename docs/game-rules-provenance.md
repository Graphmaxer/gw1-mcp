# Where each validated game rule comes from

This exists because the rules were originally asserted from knowledge, not from
sources, and two of them turned out to be wrong once checked. A build compiler that
enforces a rule the game does not have is worse than one that misses a rule: it
rejects legal builds, and the user has no way to tell it is the tool that is wrong.

**Status of the 24 validator codes: 12 verified against primary sources, 3 partial, 0
unverified, 9 that are not game rules.** Sources are cited inline at each rule in
`packages/gw-mcp/src/validate.ts`. Prefer wiki.guildwars.com over Fandom where both
cover a point.

## Verified against primary sources

| Rule                             | Source                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `INVALID_SKILL_COUNT`            | GWW Skill — "to a maximum of 8 skills (including at most one elite skill) at a time"                                                                                                                                                                                                                                                                       |
| `MULTIPLE_ELITES`                | same sentence. The exception — several elites transiently after a capture, until zoning — does not apply to a template built in an outpost                                                                                                                                                                                                                 |
| `ATTRIBUTE_POINTS_EXCEEDED`      | GWW Attribute_point — "The maximum is a total of 200 after reaching level 20 and completing both of the quests that reward 15 attribute points each". `RANK_COST` cross-checked on five independent figures: rank 7 = 28, rank 9 = 48, rank 12 = 97, 11→12 costs 20, 6→7 costs 7                                                                           |
| `RANK_OUT_OF_RANGE`              | GWW Skills_and_Attributes_Panel — "Unmodified attribute ranks cannot be raised above twelve or lowered below zero"                                                                                                                                                                                                                                         |
| `TOO_MANY_PVE_SKILLS`            | GWW List_of_PvE-only_skills — "can only equip three PvE-only skills at a time"; GWW Elite_skill dates the cap to 23 August 2007. Signet of Capture COUNTS (Fandom Signet_of_Capture), which this validator got wrong until 2026-07-31                                                                                                                      |
| `PVE_ONLY_ON_HERO`               | GWW Signet_of_Capture — "cannot be equipped for PvP or by heroes"                                                                                                                                                                                                                                                                                          |
| `PVE_ONLY_ON_PVP_BUILD`          | GWW PvP_Access_Kit — "not possible for PvP characters to learn or use these skills"                                                                                                                                                                                                                                                                        |
| `SAME_PROFESSIONS`               | **By arithmetic, which is stronger than a sentence.** Fandom Profession: "30 possible core-profession combinations, 56 if you own Factions or Nightfall, and 90 if you own both". Six professions give 30 = 6x5, eight give 56 = 8x7, ten give 90 = 10x9. Those counts hold only if secondary differs from primary; otherwise they would be 36, 64 and 100 |
| `DUPLICATE_SKILL`                | GWW Signet_of_Capture — "**Unlike other skills**, it is possible to obtain multiple copies of Signet of Capture". The exception states the general rule, and up to three copies of that signet is the documented allowance                                                                                                                                 |
| `ATTRIBUTE_PROFESSION_MISMATCH`  | GWW Attribute_point — "Attribute points are used to improve attributes in **either your primary or secondary profession**"                                                                                                                                                                                                                                 |
| `PRIMARY_ATTRIBUTE_ON_SECONDARY` | Fandom Skills_and_Attributes_panel — "The listed attributes include all of the ones available to your Primary profession, and **all except the primary attribute of your Secondary profession**"; GWW Primary_attribute confirms the mechanism                                                                                                             |
| `PROFESSION_MISMATCH`            | GWW Skill — "only characters of the respective profession can use it"; Fandom Profession — "A character has access to all skills of both chosen professions". Common and PvE-only skills are handled separately in the code                                                                                                                                |

## Pending an in-game test: the two split-version rules

`PVE_VERSION_ON_PVP_BUILD` may reject the NORMAL case. A 2009 comment by the person
who documented the template format says:

> "PvE and PvP versions of skills are different skills and as such have different
> skill ids ... when generating the skill template code in-game, it treats PvP version
> skills as PvE version skills. That way PvE skill templates are the same as PvP skill
> templates ... this makes it impossible to identify if a skill template was meant for
> PvP or PvE."
> — poke, gwpvx.fandom.com/wiki/Talk:PvX_wiki/Archive_12

If that still holds, every genuine PvP template carries PvE ids for all **156** split
skills, and this rule rejects any real PvP build containing one. But a 2009 talk-page
comment is not enough to delete a rule, and Reforged may have changed it. **The rules
are unchanged pending the test below.**

### The test that settles it

1. On a PvP character, equip **Fragility** (Mesmer, Domination Magic), save a skill
   template, and decode the code. Does it contain id **19** (PvE) or **2998** (PvP)?
   - `19` → the game normalises, and `PVE_VERSION_ON_PVP_BUILD` must go.
   - `2998` → the rule is right and the 2009 comment is stale.
2. Encode a bar containing id **2734** (Mind Wrack (PvP)) and load it in-game on a PvE
   character. Refuses to load → error is the right severity. Loads as normal Mind
   Wrack → a warning is enough. Loads as the PvP version in PvE → error, clearly.

Test 1 works on a roleplaying character too: the question is what the game WRITES, not
what it displays.

## Partial: mechanism sourced, exact wording not

- `ATTRIBUTE_NOT_TEMPLATABLE` — title tracks are not attribute-point attributes, which
  follows from GWW Title but is not stated as a template restriction.
- `PVP_VERSION_ON_PVE_BUILD`, `PVE_VERSION_ON_PVP_BUILD` — GWW Skill describes split
  versions that "update automatically when in each respective zone". That supports
  treating them as distinct; the strictness of rejecting the wrong one is inferred.

## A constraint we cannot check, worth knowing

GWW Skills_and_Attributes_Panel: "If a template has been saved with a primary and/or
secondary profession you do not have access to on that specific character you will not
be allowed to load it." So a code can be perfectly legal and still fail to load for
the person pasting it. Nothing to validate — we do not know the character — but it is
the right answer when someone reports "your code will not load".

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

## Cross-checked by a second model (2026-07-31)

The rule list above was run through ChatGPT for an independent check. The prompt itself
is deliberately not kept: generated from `validate.ts`, it would drift as rules change
and then verify assertions the code no longer makes — the same failure as a pre-push hook
with its own hardcoded list. Regenerate one from the current source if the exercise is
worth repeating, and demand a full URL plus a verbatim quote per verdict, with NOT FOUND
presented as an acceptable answer. It agreed on
ten rules with HIGH confidence and found one better source than ours — the Hero page
states the PvE-only restriction directly, which we had been sourcing from the Signet of
Capture page. That quote was verified by fetching the page.

**What it could not find**, returning NOT FOUND rather than inventing: `SAME_PROFESSIONS`,
`DUPLICATE_SKILL`, `ATTRIBUTE_NOT_TEMPLATABLE`. That is consistent with there being no
direct sentence for any of the three, which is exactly why `SAME_PROFESSIONS` rests on
the combination arithmetic (30 = 6x5, 56 = 8x7, 90 = 10x9) instead — an argument it did
not find. A second reader failing to find a sentence strengthens the case for keeping
the arithmetic proof, not for weakening the rule.

**On the two split-version rules it said WRONG, at LOW confidence, citing the same 2009
comment we had already found.** That is not corroboration: two readers of one page are
one piece of evidence. The in-game test below remains the decisive step and the rules
stay unchanged.

**One of its citations did not survive checking.** For `PROFESSION_MISMATCH` it quoted
"The Skills section allows you to customize the skills allocated to you and your heroes'
primary and secondary attributes" from the Skills and Attributes Panel page. The actual
sentence is about the **Attributes** section and attribute points, not skills — the
quote had been reshaped to fit the rule. The rule is still correct on the GWW Skill page
("only characters of the respective profession can use it"), but that citation is
discarded. Calibration worth keeping: of the citations spot-checked, one in a handful was
altered, which is why the prompt tells the reader to open every link.

**One of its warnings was checked and does not apply.** It flagged that requiring eight
non-empty skills would be too strict, since template id 0 is "No Skill". Tested: a bar
with one skill and seven empty slots validates, eight empty slots validate, and a
seven-element array is rejected by the schema. No change needed.
