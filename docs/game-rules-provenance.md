# Where each validated game rule comes from

This exists because the rules were originally asserted from knowledge, not from
sources, and two of them turned out to be wrong once checked. A build compiler that
enforces a rule the game does not have is worse than one that misses a rule: it
rejects legal builds, and the user has no way to tell it is the tool that is wrong.

**Status: 15 verified, 0 partial, 0 unverified, 9 that are not game rules.** Nine were
settled by testing in game, which outranks the wiki wherever the question is about what the
client does rather than what a character may have. Sources are cited inline at each rule in
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

## Settled in game 2026-08-01: the split-version rules were wrong

A PvP-only Mesmer equipped **Fragility** and **Empathy**, both split skills, and saved a
skill template. The code `OQBDAowjCXoyJEhyEaIA` decodes to skills
`[23, 42, 39, 68, 40, 19, 26, 2]` — **ids 19 and 26, the PvE versions.** The PvP ids
2998 and 3151 are absent. The client normalises when writing, on a PvP character, in
2026 under Reforged.

This is primary evidence and it outranks everything else we found: a 2009 talk-page
comment said so, a second model agreed at LOW confidence citing that same comment, and
neither was enough. The game settled it.

Two consequences, both applied:

- **`PVE_VERSION_ON_PVP_BUILD` deleted.** Run against that exact template with
  `forPvp: true`, it produced two errors telling the player to use ids the game had
  deliberately not written. It rejected the normal case for all 156 split skills.
- **`PVP_VERSION_ON_PVE_BUILD` replaced by `PVP_VERSION_IN_TEMPLATE`, an ERROR
  independent of `forPvp`.** The client does not merely dislike a PvP id, it refuses the
  **entire template**: three hand-built codes — both split skills as PvP ids, then
  Fragility alone, then Empathy alone — all failed to load, showing eight empty slots,
  professions as "...", and a greyed Load button. No message. One such id costs the user
  the whole bar. Isolated from a format problem rather than assumed: the same bar with a
  legitimate high id (Psychic Distraction, 1053) needs the same wide
  `bits_per_skill_id` field and loads perfectly, so the width is fine and the ids are
  the cause. The original rule had the severity right and the condition wrong.

The template is now a test fixture, so the false positive cannot return.

## Partial: mechanism sourced, exact wording not

- `ATTRIBUTE_NOT_TEMPLATABLE` — title tracks are not attribute-point attributes, which
  follows from GWW Title but is not stated as a template restriction.

## A constraint we cannot check, worth knowing

GWW Skills_and_Attributes_Panel: "If a template has been saved with a primary and/or
secondary profession you do not have access to on that specific character you will not
be allowed to load it." So a code can be perfectly legal and still fail to load for
the person pasting it. Nothing to validate — we do not know the character — but it is
the right answer when someone reports "your code will not load".

## Not game rules

`DUPLICATE_ATTRIBUTE`, `NO_PRIMARY`, `UNKNOWN_SKILL`, `UNKNOWN_ATTRIBUTE`,
`UNKNOWN_PROFESSION`, `UNKNOWN_CAMPAIGN`, `UNKNOWN_PRIMARY`, `UNKNOWN_SECONDARY`,
`BAD_REQUEST`, `NOT_FOUND`, `SKILL_NOT_UNLOCKED`, `UNUSED_ATTRIBUTE`,
`UNALLOCATED_ATTRIBUTE`. These check request coherence, name resolution, or build
quality. `SKILL_NOT_UNLOCKED` depends on the caller's own account state.

`UNKNOWN_PROFESSION` was the one code in `src` this list had never mentioned, while
both its siblings were here — found by diffing the declared codes against this file
on 2026-08-11. Every resolution error now carries the `suggestions` field
`issueSchema` documents, in every tool that can raise it.

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

## Two elites: verified in game, and the failure is silent

`MULTIPLE_ELITES` was listed as verified from GWW Skill — "to a maximum of 8 skills
(including at most one elite skill) at a time" — but that sentence is about EQUIPPING and
says nothing about loading a template. Tested on 2026-08-01, and the answer matters:

**The client loads the template and silently drops the second elite, leaving an empty
slot.** The load dialog shows all eight skills with the button enabled, unlike a
PvP-version id which greys it out. Pressing Charger produces a seven-skill bar.

So the user gets a bar that does not match the code, with no message. That is worse than
a refusal — a refusal is visible — and it is why the rule is an error and why the message
now says what will happen rather than only stating the rule.

Raised by accident: the control code used to test wide ids happened to contain two
elites (Energy Surge and Psychic Distraction).

## In-game verdicts, 2026-08-01

A PvP-only Mesmer loaded hand-built codes. Two distinct failure modes appeared, and the
difference between them is the important part.

**Refused outright** — Load button greyed, header shown as "...", eight empty slots. The
template is rejected whole, with no message, but the refusal is at least visible:

| Code tests                                                  | Rule confirmed                                                                                                                                                                                                             |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| a PvP-version skill id (any single one)                     | `PVP_VERSION_IN_TEMPLATE` — error                                                                                                                                                                                          |
| a title track in the attributes (Sunspear, id 102)          | `ATTRIBUTE_NOT_TEMPLATABLE` — was the last partial rule, now verified                                                                                                                                                      |
| an attribute rank of 15                                     | `RANK_OUT_OF_RANGE` — the 0-12 bound holds at the loader, not only in the panel                                                                                                                                            |
| an attribute of a third profession (Fire Magic on a Mesmer) | `ATTRIBUTE_PROFESSION_MISMATCH`                                                                                                                                                                                            |
| primary equal to secondary                                  | `SAME_PROFESSIONS` — and elegantly: the dialog prints "Envoûteur/**Envoûteur**" with the second in RED, so the client names the offending field. Better than any wiki sentence, and it confirms the combination arithmetic |

**Accepted, then silently altered** — dialog shows all eight skills with Load enabled, and
the loaded bar differs from the code. This is the dangerous mode: a refusal is visible, a
substitution is not.

| Code tests                 | Rule confirmed                                                                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| two elite skills           | `MULTIPLE_ELITES` — the later elite is dropped, leaving an empty slot                                                     |
| the same skill three times | `DUPLICATE_SKILL` — the extra copies are dropped, leaving empty slots. No source states this rule; observation settled it |

Both messages now state the consequence, not only the rule, since "at most one elite" does
not tell a caller it will silently lose a skill.

`PROFESSION_MISMATCH` joins the refusal group: Protective Spirit (Monk, non-elite) on a
Mesmer with no secondary is refused outright. So skills and attributes behave alike.

## The pattern, and what it predicts

The two groups do not split by severity but by **kind**:

- **What is IMPOSSIBLE is refused outright.** A skill id the character cannot have, a
  profession that does not fit, an attribute outside the two professions, a rank above 12,
  a duplicated profession. Visible: the button greys and the header shows "...".
- **What merely EXCEEDS a limit is trimmed silently.** A second elite, a repeated skill.
  The template loads and the offending slots come up empty, with no message.

**The pattern made a prediction and the prediction held.** `ATTRIBUTE_POINTS_EXCEEDED` is
a limit, so it should trim rather than refuse — and it does: a 12/12/12 Mesmer template
(291 points) loads, and the client silently lowers the ranks to fit, leaving unused points.
Tested 2026-08-01.

That is the most dangerous case in the whole series. An emptied skill slot is visible; a
quietly different attribute spread is not, and it changes the numbers on **every** skill in
the bar. The message now says so.

**Tested 2026-08-01 on a roleplaying Dervish, and the prediction held again.**
`TOO_MANY_PVE_SKILLS` is a limit, and a template with four PvE-only skills loads with one
silently dropped. A control with exactly three loads intact, which also confirms the
character owned all three — without that control the result would have been ambiguous.

**The same test confirmed this morning's Signet of Capture fix.** Three PvE-only skills plus
a capture signet is four, and the client drops one, so the signet does consume the
allowance. That correction had been made on a Fandom quote alone; the game agreed with it.
Worth noting because the change was to REMOVE an exemption, i.e. to make the validator
stricter — the direction where being wrong rejects legal builds.

So every limit rule now behaves the same way, and the pattern has made three correct
predictions: elites, duplicates, the attribute budget, and the PvE cap all load and trim
silently, while every impossibility is refused outright.

Consequence for messages: the trimming rules must say so, because a caller cannot see it.
`MULTIPLE_ELITES` and `DUPLICATE_SKILL` now do. The refusal rules say the whole code will
not load, which is more useful than naming the rule.

## Hero bars load

Reported by the maintainer from earlier testing: codes produced by this project load
correctly onto heroes. That closes the widest verification gap before 1.0 — hero bar
construction is the project's primary use case, and until then it had only unit tests
behind it.

## The citations are now locked, because seven were missing

Asked whether the links were properly noted, I audited instead of answering. **They were
not.** Four citations had silently failed to land — the scripted edits that were supposed
to add them had aborted mid-run — so rules with real, known sources carried no reference
in the code.

Worse, the first version of the lock I wrote to prevent this was **vacuous**: it looked
1500 characters back from each rule, which catches the NEIGHBOURING rule's citation.
Removing a citation left it green. Found by trying it, which is the only way to find that.

The strict version looks only at each rule's own territory — the span between the previous
`code:` and this one — and it immediately found **three more** omissions the loose window
had masked: `PVE_ONLY_ON_HERO`, `ATTRIBUTE_NOT_TEMPLATABLE`, `RANK_OUT_OF_RANGE`.

All fifteen game rules now carry a wiki URL or an in-game observation in their own span,
enforced by `conventions.test.ts` and verified failible by removing one.

## Did the sources turn out right?

**About the rules, yes — every one of them.** Nothing the wiki stated was contradicted in
game, including the arithmetic inference for `SAME_PROFESSIONS` and a **2009 talk-page
comment** about template normalisation that held up seventeen years later.

**About the consequences, they were silent.** No source anywhere says what the client does
with an invalid template, and that turned out to be the most useful thing learned:
impossibilities are refused visibly, limits are trimmed in silence. Four rules had their
messages rewritten because of it — a caller needs to know it will lose a skill or a rank
without being told, not merely that a rule exists.

**One source actively misled**: a GWW talk page saying a duplicate-skill template "does
load". True, and useless — it loads and drops the duplicates.
