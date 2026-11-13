# Audit history

Every audit this project has been through, what each found and what was deliberately not fixed, plus the dated status entries that used to open CLAUDE.md. Newest status first. This is history: the rules that came out of it live in CLAUDE.md.

## Status log (newest first)

**2026-11-13: a SIXTH audit, six parts run in parallel (CI/supply chain, runtime
code, documentation drift, game rules and freshness, clean code, C++ plugin and
test quality), plus the live server used as a client would.** The game logic held
again: 38 realistic bars against the validator with zero disagreements, 18 recently
patched skills identical to their wiki infoboxes, every skill change of the last
game updates present (the last one touching skills is 2026-09-01), the C++ core
clean under ASan/UBSan. What it found, in the order it mattered:

- **The two-job split of `update-data.yml` had a door in it.** The import job runs
  unpinned upstream code and hands `open-pr` a patch; `open-pr` applied it with a
  bare `git apply` and then EXECUTED `description-growth.ts` from the patched tree,
  in the job holding contents:write and the app token. A hostile patch could
  rewrite the gate, have it print `changed=false` and auto-merge arbitrary source.
  The patch is now treated as what it is, attacker-controlled input: only content
  edits to the eight generated data files, the hero header and README, judged by
  git's own `--numstat`/`--summary`, failing closed on an empty allowlist. The
  isolation protected the secrets FROM the import and never asked what the import
  could send back.
- **`decode_pawned_team` was quadratic on hostile input** — `/>([^<]*)</s` over
  16 KiB of `>` cost 92 ms. Same family as the slot-count bug: something unbounded,
  invisible to a correctness suite. Two `indexOf` calls now, with a benchmark.
- **Two forwarded descriptions contradicted the validator** (`forPvp`, and the
  English-only claim on build skill names). See debt #10.
- **Mutation testing found the suite blind in places it looked covered.** Hard-coding
  `forHero: false` in a handler, deleting the attribute filter of `search_skills`,
  changing `> 200` to `>= 200`, swapping energy and recharge in a decoded bar,
  anchoring the batch check on a literal `[`: 451 tests stayed green through every
  one. Three tests could not fail at all (one asserted on `warnings` for a rule
  that only emits errors; one looped over zero matches). `contract.test.ts` now
  checks answers against the DATA, exactly, and each of those mutants was re-run
  and dies. Line coverage said 97%; coverage counts lines executed, not claims
  checked.
- **Using the server found what reading it did not**: `get_hero` on a typo returned
  nothing to retry on. Suggestions added.

New and worth knowing: `scripts/smoke.ts` runs 22 HTTP checks against real workerd
on every PR; there are NO dependency overrides left (the lockfile alone resolves
patched versions, `pnpm audit` at zero); vitest 5 moved `bench` to a fixture; the
plugin build runs on PRs that touch `pins.env`.

Process note, because it cost twenty minutes: two audit sub-agents working in /tmp
copies had symlinked `node_modules` back into this repo, and a `pnpm` run in the
copy repointed the REAL workspace links at /tmp. Typecheck then failed on a symbol
that plainly existed. A scratch copy needs its own `node_modules`.

**2026-10-05: weekly run #26 (2026-09-28) failed because upstream RENUMBERED its
non-template attribute ids, and the npm fallback then tried to downgrade the data.**
Luxon/Kurzick moved 104/105 -> 906/905, so the faction rule stood down and the
collision gate refused the Pages import — correctly. The fallback then imported npm
2.0.0, 31 skills behind Pages, over Pages-sourced data, and the job died on a French
table assertion that named neither cause (issues #74/#75). Two fixes: the import maps
upstream ids back onto ours (see Data maintenance), verified against the live Pages
bytes (every data file byte-identical), and the fallback now discards its own output
whenever the committed record came from Pages, so it can never downgrade — locked by
a test that EXECUTES the workflow's inline predicate (sabotage-verified). A third
guard for the same family: the CAMPAIGNS/PROFESSIONS tables are positional, so the
normaliser now refuses ids that are not exactly 0..n-1 — a -1 there would have
shifted every profession id with every foreign key still resolving.

Same day, dependencies: `pnpm audit` went from 20 advisories to 1 (hono, fixed by
the pending Dependabot PR) by re-resolving `fast-uri`, `ip-address` and `axios` in
the lockfile — and SIX override floors were then DELETED, not raised, because every
one of their parents declares a caret range that already admits the fix. A floor on
such a package buys nothing and must be raised by hand at every new advisory; it also
appears to block Dependabot's transitive security updates (on 2026-09-29 it called
fast-uri 3.1.6 "latest resolvable" while our `^3.1.6` floor permitted 3.1.7, out 27
days — an inference, not a confirmed Dependabot behaviour). The rule now heads the
`overrides:` block in pnpm-workspace.yaml: an override only where the parent's range
CANNOT reach the fix (an exact pin, or a range admitting a vulnerable major). Four
remained on that basis until 2026-11-13, when their parents had caught up and the
whole block was deleted: the lockfile resolves to the same patched versions without
it. There are now NO overrides; the rule stays as a comment in that file.

**2026-09-08: weekly run #25 failed because upstream renamed twenty skills onto ten
names, and the import now owns the Luxon/Kurzick suffix** the way it already owned
"(PvP)" — plus an import-time uniqueness gate that names both skills, so the next
collision fails at the import step instead of in a test three steps later. Details
under Data maintenance, run #25. The data itself was deliberately left to the weekly
job (its gates, its PR); the code fix was verified against the live upstream bytes.

**2026-08-31: French skill names resolve, and a Dependabot PR earned the tools/list
lock its keep.** Two unrelated things landed together.

The dependency bump (zod 4.4 -> 4.5 among eight) failed CI on the `tools/list`
character lock, which is exactly the case that lock was added for: zod 4.5 writes a
nullable field as `{"type":["string","null"]}` where 4.4 wrote an `anyOf` pair,
-323 characters across 17 output fields, and nobody chose it. Accepted after
normalising both notations and finding the schemas deep-equal — the bar for a
dependency-driven move is proving the delta is cosmetic, not re-baselining the
constant because CI is red.

French: upstream started serving `json/skilldesc-fr.json`, so the trigger the Game
data section wrote for itself in July fired. Names only, English always wins, the
merge policy lives in one place (`repository.ts`) and the generated table is the
unfiltered fact. Three things worth carrying forward:

- **Two tests asserted the OLD decision and one asserted it twice.** `repository.test.ts`
  demanded `[]` for every French query, and both the gw-mcp and gw-worker analytics
  tests used "Régénération mystique" as their example of an unresolvable name — one
  of them with a comment saying the counter existed to decide whether French was
  worth building. Landing a feature meant rewriting the tests that recorded the
  reasons not to. That is the good case: the tests failed loudly instead of the
  decision quietly rotting.
- **A sabotage pass corrected a comment.** The runtime filter that drops a French
  name colliding with an English one turned out to be redundant — the lookup order
  (`English ?? French`) is what enforces "English always wins", and removing the
  filter breaks no test. It stays as defence in depth, but the comment now says
  which of the two actually holds the line, and the whole-dataset sweep that DOES
  catch an order flip was verified by flipping it.
- **Upstream is 31 skills ahead of our committed data** (ids 3443-3473, plus a
  balance patch), and the weekly job has not opened a PR for them. Not touched
  here on purpose: a data refresh belongs to `update-data.yml` with its own gates,
  so the French table was generated against the committed `skills.json` and the
  next weekly run regenerates both together. Worth checking that run.

A FIFTH audit ran on 2026-08-17, in this repo with a working npm and a real
network — the "re-audit in a working environment" the first audit asked for, and
the first to combine that with live probing. ~53 000 generated cases across ten
surfaces: 20 000 codec round-trips, 28 437 malformed codes, whole-dataset data and
validator sweeps, 41 MCP contract assertions against a PRIMED client, 400 name-level
encode/decode round-trips, 40 HTTP assertions under real workerd, and the C++ core
compiled under g++ as a second compiler. It found **zero defects in code, data or
configuration** — every previous audit's fix confirmed still applied, and the rate
limiter, the body limits, the batch refusal and the pwnd slot cap all verified live.

All three findings were DOCUMENTATION drift, and the pattern is worth keeping: none
of them was reachable by reading code, and two were caused by things working exactly
as designed. `tools/list` had grown 549 characters since the figure here, 312 of them
an SDK field nobody chose (now locked exactly by a test); the coverage reference
levels had drifted far enough low that a real regression would still read as
on-target (remeasured); and provenance could not commit itself (fixed — see the data
maintenance section on run #19). This file is the source of truth, so a number in it
that only a human updates is a number that goes stale — prefer a lock.

Method note, since it cost real time: two of my own sweeps produced 313 false
findings before yielding a true one — a degenerate PRNG that collapsed 30 000 fuzz
inputs to 562 distinct values, and reading `pvpSplit` as symmetric when the type doc
says it flags the PvE side only. Check the harness before believing the harness.

On 2026-08-17 the weekly data import was found broken for the SECOND time in the
same way, and the second finding is the one that matters: not the code defect
(upstream 2.x constant tables reaching only one of three source modes — see Data
maintenance) but that the npm fallback reported success both times, so nothing
ever said so. That pattern now has a name and a notification path; look there
first when a scheduled job has been quiet.

Everything through distribution is DONE and live: codec (four verification
layers), skills Reforged-current (count lives in the data, not in prose —
see the doc-count locks in gw-data/test/repository.test.ts), 8 MCP tools + 3
resources, worker deployed on Cloudflare (auto-deploy per push), published on
the official MCP Registry, releases automated (changelog + DLL + registry in
cascade), plugin compiled clean in CI (/W4 /WX). Bundle size: whatever
`pnpm --filter @gw1-mcp/gw-worker check` prints — do not hardcode it here.

A three-part external audit was worked through on 2026-07-24..29 and closed 24
of its actionable findings. What changed structurally, so the shape of the code
is not a surprise:

- `parseHeroEnum` strips comments BEFORE splitting — an upstream `//` used to
  swallow the next hero and shift every HeroID after it.
- Suggestions: an EXACT French name first, then token-prefix match, then bounded
  edit distance capped at 5 (calibrated on measured distances, see the comment).
  Abbreviations resolve. The French pass replaced this bullet's old claim that
  "French names return nothing rather than a confident wrong answer" — true and
  correct while nothing here knew any French, and obsolete since 2026-08-31.
  Ordering matters more than it looks: "Rafale" is 2 edits from "Gale", so ranking
  English first answered ["Gale", "Recall", "Impale"] for a query whose real
  meaning was sitting in the French table. Exact evidence outranks a fuzzy match.
  Note the cap's calibration lost its boundary case in the process — 5 was the
  widest value that kept "Vœu de piété" -> Vow of Piety (d=5), and that query now
  matches the FRENCH name at d=2 instead — and it was deliberately NOT re-picked
  from that one obsolete datum. The
  distance kernel is `fastest-levenshtein` — gw-data's first and only runtime
  dependency, taken on purpose to delete a hand-written banded matrix.
- **No œ -> oe fold in `normalizeName`, decided by measurement.** The ligature is
  what a French speaker actually types ("Vœu", "Cœur", "Œil"), NFD does not
  decompose it, so the strip deletes it and the exact lookup misses. Folding it
  shipped for one commit and CodSpeed priced it: ~10% on the hottest function in
  the package, whichever form (+10.3% inline in the strip, +7.9% guarded), paid by
  every caller forever including the ~97.5% of traffic that never types French.
  What it bought: 18 names carry the "oe" digraph and upstream spells all 18
  without a ligature, and every one of them lands at d=2 from its own French name
  WITHOUT the fold — so the suggester already answers all 18 correctly. One round
  trip on 18 skills beats a permanent tax on everyone, and `repository.test.ts`
  asserts the right answer really comes back. Reopen with a measurement, not a
  preference.
- Validator: `forPvp` mirrors `forHero` in both directions; `UNUSED_ATTRIBUTE`
  exists but never fires on a primary attribute (a primary is never wasted).
- HTTP surface: CORS is open (`*`) because the service is public, read-only and
  credential-free; GET and DELETE on /mcp answer 405 because the server is
  stateless. MCP 2026-07-28 makes that stateless core the default model, so this
  aged well. There is deliberately NO `server.close()` in the /mcp handler — see
  the comment; adding it empties every response.
- Upstream data imports pass a plausibility gate, and auto-merge is withheld
  when a description grows more than any legitimate upstream commit ever has
  (+80 chars; largest observed is +56). Since 2026-08-11 the gate also covers
  NAMES and all five constant tables, and it no longer fails open on a git
  fault.

A third external audit (2026-08-08, plus a from-scratch v1.0.0 pass) was worked
through on 2026-08-11: no High findings, and every actionable one is closed. See
its entry in the debt register for what changed. Four things about the shape of
the code, so they are not a surprise:

- Tool INPUTS are `.strict()`. An undeclared argument is a tool error naming the
  key, not a silently ignored filter.
- The worker refuses JSON-RPC batches, and `useOnMcp` is mandatory for anything
  registered on `/mcp` — one middleware that skipped it is the reason.
- The suggesters and `searchSkills` return nothing for a query that normalises
  to nothing, instead of the whole dataset or three plausible wrong names.
- Suite is 475 tests (107 / 133 / 157 / 78) as of 2026-11-13.

A SELF-audit followed on 2026-08-11 — probes and sweeps rather than reading — and
its lesson is where to look next. The core did not yield: ~1900 generated cases
(375 adversarial tool calls against a primed client, 1500 legal builds round-tripped
by NAME through encode/decode, whole-dataset validator and codec sweeps, the C++
plugin read in full) produced ZERO findings in the codec, the validator, the data
or the plugin. Both real findings were in the automation meant to watch the source,
and both were failing silently: the pin tripwire (see the manual-pin registry) and
the importer's phantom snapshot (see the data-provenance paragraph). Two smaller
ones were contradictions between enforced rules and LLM-facing prose — heroes
"cannot use most PvE-only skills" against a hard error on every one of them, and
the campaign-filter caveat living only in server `instructions`, which many clients
never forward, while the parameter description that IS always forwarded said
nothing.

Two things verified end to end for the first time, worth trusting now: the
production RATE LIMITER really engages (first 429 at request #102 against a
documented 100/min/IP), and response hardening survives the lazy body — `no-store`,
`nosniff` and CORS are all present on a real `text/event-stream` `/mcp` answer,
despite the same laziness making `server.close()` empty a response.

On a repository this well tested, look at whether the automation RAN before looking
for a wrong line of code.

A FOURTH external audit (ChatGPT, 2026-08-11, snapshot without `.git` and with no
npm access, so no suite run) rated the code 7.4/10 and raised three "P1"s. One was
real and its sharpest form was not the one reported: `gw1://meta` served
`_meta.json` alone while the README promised four reference tables AND
`UNKNOWN_ATTRIBUTE` told the caller to enumerate title tracks there — a dead
pointer in an LLM-facing error, which is worse than a wrong README line. The
resource now composes provenance + professions + attributes (title tracks
included) + campaigns + skill types at module scope, tables read from gw-data
rather than written into `_meta.json` (that would be an unmanaged copy), and a
test asserts each table. Two prose fixes followed: the privacy policy said "no
personal data is collected" absolutely while recording a CALLER-CONTROLLED client
name — the blob stays (it is what proved 63% of traffic was one uptime monitor),
the absolute claim goes, replaced by naming who supplies the value and that
Analytics Engine has no per-row deletion; and the README now says `/exportaccount`
copies your character name.

Rejected, with reasons, so nobody re-derives them: the README `pnpm --filter
@gw1-mcp/gw-data update` command was reported broken because no `update` SCRIPT
exists — `update` is a pnpm builtin (verified, pnpm 11.11.0), the command is
correct; dropping the client-name dimension was the audit's recommended fix and
would delete the capability that answers "does any directory listing send real
clients"; the data-import auto-merge critique restates debt already gated
(upstream JSON Schemas, name gate over all five tables, `assertCoherentSnapshot`,
growth gate, golden fixtures) and its "measure a word-diff threshold" successor
was already tried and rejected; licensing is the counsel-gated register entry and
the audit added nothing to it. Method note: this pass never ran the suite, so its
strongest claims were about prose consistency — and that is exactly where its one
real finding was.

NEXT (maintainer-gated only): file the upstream bug report (debt #4, report
ready in docs/), submit to the ChatGPT and Claude directories (kits in docs/,
refreshed 2026-07-29 against the current forms). Debt #9 was CLOSED 2026-07-29
by reading the Workers dashboard: 2k invocations in 24h, 0 errors, 7.66 ms mean
CPU against the 10 ms Free cap. Debts #2 and #3 were CLOSED 2026-07-16: the DLL
exported a real account in production (hero names from the generated table,
export fed validate_build end-to-end) and nine in-game codes settled every
codec question.

## External audits 1 to 3

Everything below is a KNOWN compromise, kept deliberately, with its trigger
for action. Nothing else in the repo is knowingly imperfect.

External audit (2026-07-20): an independent GPT-driven audit of the v0.6.0+
snapshot raised 15 findings (3 High, 5 Medium, rest Low/Info). ALL 15 were
addressed — bit-array amplification removed (GW1-01), strict codec tail
(GW1-02), C++ UTF-8 OOB write fixed (GW1-03), supply-chain surfaces pinned &
isolated (GW1-04/05), provenance hashing (GW1-06), C++ header in the weekly
patch + sync test (GW1-07), rate limiter truly fail-open (GW1-08), name/id
exclusivity (GW1-09), split result schemas (GW1-10), Node 22 CI job
(GW1-11), parsed Origin + loopback default (GW1-12), data invariants
(GW1-13), fixed pwnd test (GW1-14), README meta (GW1-15). The auditor could
NOT run the suite (no pnpm/DNS), so its code-reading findings were reliable
but its execution claims were neither confirmed nor denied — re-audit in a
working npm environment before declaring fully verified.

Second external audit (2026-07-21, v0.7.0): a deeper GPT audit that mounted
the MCP and exercised all 8 tools live, so it caught business-rule bugs a
read-only pass missed. 14 findings. Addressed: core GW1 validator rules
(AUD-03 — is_rp threaded as isRoleplay, Signet-of-Capture-x3, PvE-only via
flag not attribute heuristic, hero-illegal is now a hard error, 3-PvE cap);
DoS hardening (AUD-01 — 64-char name bounds, capped unlockedSkillIds,
Levenshtein length guard, 512 KiB body limit); data licensing (AUD-02 —
THIRD_PARTY_NOTICES.md: descriptions are GFDL/CC-BY-NC-SA, not MIT — LEGAL
SIGN-OFF STILL OWED before any commercial redistribution, and note that
submitting to a public directory is arguably the distribution event that
trigger names. TRACED from upstream code 2026-07-29. The CC BY-NC-SA
attribution pointed at guildwars.fandom.com, which is NOT in the pipeline:
build-wars/gw-skilldata has two fetchers, English from wiki.guildwars.com (official,
GFDL 1.3, which PERMITS commercial use) and German from guildwiki.de (BY-NC-SA), and
all English text we ship comes from the former. So the NonCommercial clause this
sign-off was feared for does not appear to touch the text at all. The sharper
question, and the one for counsel: both wikis state that in-game names and texts are
ArenaNet/NCsoft copyright used under the Community Fansite Program and NOT covered by
their own licence — and a skill description is a verbatim in-game string, not editor
prose, evidenced by 34 `<sic/>` markers and 403 `<gray>` tags mirroring the game's own
presentation. Full reasoning in THIRD_PARTY_NOTICES.md. No CC text is
vendored under LICENSES/ because it is not established that a CC license
applies to anything we ship as prose); privacy/security
text accuracy (AUD-06); provenance hashes all 5 artifacts (AUD-05); export
doc learned-vs-unlocked (AUD-10); encode schema honesty (AUD-04); pagination
offset + fixture-count drift (P2). Two findings kept as documented
decisions, NOT fixed: AUD-09 (Cloudflare deploy not IaC) is debt #1, already
assumed; AUD-07 (plugin not compiled on every PR) is deliberate — a Windows
vcpkg build on each PR touching the plugin is disproportionate; the pinned
GWTOOLBOX_COMMIT + release-time build cover it. Caveat: isRoleplay was
reconstructed from title-track attrs + Signet of Capture (network-blocked
import); a real `pnpm import` repopulates it authoritatively from upstream
is_rp.

Third external audit (2026-08-08 + a from-scratch v1.0.0 pass, worked through
2026-08-11). No High findings; `pnpm audit --prod` clean; the previous two
audits' fixes confirmed as really applied. Every actionable finding is now
CLOSED — three Mediums, one Low-Medium, ten Lows and the actionable info notes
— plus one finding the maintainer's own manual pass had raised. The pattern
worth remembering: this pass found nothing wrong with the game logic. All four
substantive findings were about a guard that reasoned per REQUEST while
something else counted per OPERATION, or a check registered on one of two
equivalent paths.

- **M1 — the body limit had drifted off `/mcp/`.** `bodyLimit` was the ONE
  middleware still registered with `app.use("/mcp", ...)` instead of the
  `useOnMcp()` helper, whose comment claims "the two paths cannot drift apart".
  600 KiB answered 413 on `/mcp` and 400 on `/mcp/` after being fully buffered
  and parsed — twice, when `MCP_ANALYTICS` is bound. Both spellings are now
  tested for both body-limit cases. When adding a `/mcp` middleware, `useOnMcp`
  is not a style preference.
- **N1 — JSON-RPC batching was the last amplification path.** One 508 KiB POST
  carrying 3100 `get_skill` calls fits under the body limit, returns 3100
  results, and costs ONE unit of the 100/min/IP quota — the rate limiter counts
  HTTP requests. Now refused with -32600. Refusing is also the conformant
  answer: MCP 2025-06-18 removed batching and every later revision keeps it
  removed, but the SDK still lists 2025-03-26 as supported and @hono/mcp still
  parses top-level arrays, so it has to be refused HERE rather than assumed
  absent. Unconditional, because gating it on a negotiated version needs
  session state a stateless server does not have. The check peeks at the first
  non-whitespace character of a cloned body and only for JSON content types —
  both details are load-bearing, and both were measured under real workerd:
  free on the hot path (3.02 ms vs 3.03 ms p50 for `tools/list`), and the
  content-type narrowing is what keeps a `text/plain` body answering 415.
- **M2 — the suggester answered confidently for queries that normalise to
  nothing.** `distance("", candidate)` is just the candidate's length, so every
  short name passed the cap: `get_skill {"name":"Возрождение"}` returned
  ["Awe", "Echo", "Gale"]. One `if (needle.length === 0) return []`. The
  `needle.length >= 3` floor the audit also floated was deliberately NOT added
  — the abbreviation ranking ("heal sig", "Vow of Rev") is calibrated and would
  be the thing it broke. `searchSkills` got the symmetric fix (L8): a
  `nameContains` normalising to nothing used to return the whole dataset,
  because `includes("")` is true for everything.
- **M3 — the output-schema regression lock exempted `decode_pawned_team`.** The
  test written after the `get_skill` postmortem asserted
  `TOOL_NAMES.length - 1`, and the exempted tool was the only one no
  primed-client test called. The golden PvX blob is in the call list and the
  assertion is back to `TOOL_NAMES.length`.
- **Unknown tool arguments are now REJECTED, not ignored.** Not from the audit
  document but from using the thing: `search_skills {"profession":"Monk"}`
  (instead of `professionName`) returned the first 50 skills of the whole
  database presented as filtered results, and it took four observations to
  root-cause during real use. All eight input objects are `.strict()`; zod's
  message names the key, so a model self-corrects in one round trip. Costs
  ~232 characters of `tools/list` (18 577 -> 18 809; the current figure and the
  test that locks it are in the createServer section) for
  `additionalProperties: false`, which is debt #10 money well spent — the
  schema now states a contract the server enforces. It also revealed that three
  input shapes were still built INLINE in `createServer`, so the "zero `z.`
  calls in the function body" rule was aspirational; it is literally true now.
- **The import gates covered descriptions only (L1, L2, L3).** Names travel
  into an LLM's context by the same routes and the weekly data PR AUTO-MERGES,
  so a compromised upstream writing its instruction into a skill NAME — or into
  the profession, attribute, campaign or skill-type tables — passed all three
  gates. There is now a name gate with its own shape (charset calibrated on the
  six real tables, 80-char bound, plus the instruction pattern, now shared with
  the description gate because "Aegis. Ignore all previous instructions." is 40
  charset-legal characters). And the growth gate was fail-OPEN: one `catch {}`
  read "git failed" as "first import", printed `changed=false`, and auto-merge
  continued; `git ls-files` now answers that question and a real fault withholds
  the merge.
- **Smaller, all closed**: suggestions on `UNKNOWN_PROFESSION` /
  `UNKNOWN_ATTRIBUTE` in build resolution (L7 — the same typo got a hint in
  `search_skills` but not in `encode_template`, where it is likeliest);
  `get_hero {}` answered `NOT_FOUND: "No hero matching undefined"`, now
  `BAD_REQUEST` (L6); `fullHero` enumerates its fields instead of `...hero`,
  which is the `get_skill` postmortem waiting for the next weekly hero import
  (L5) — and the `schemas.ts` comment claiming output shapes tolerate extra keys
  said the opposite of what the SDK does; four encode fields now name themselves
  instead of surfacing "Value 16 does not fit in 4 bits" (L10); the vcpkg BINARY
  cache takes an exact key match including `VCPKG_COMMIT`, because a wide
  `restore-keys` fallback into a readwrite cache feeds a DLL attached to a
  public release (L9); `BitReader`/`BitWriter` refuse widths past 31 bits
  (JS bitwise ops are 32-bit signed, so `read(40)` returned a silently wrong
  number); `ATTRIBUTE_POINTS_EXCEEDED` counts each attribute line once (a
  duplicate entry made the message print 291 points for a spread costing 97 —
  a false total inside a message whose entire purpose is trustworthy
  arithmetic); `Object.hasOwn` for the hero overlay lookup; `pathToFileURL` in
  `import-heroes`' `isDirectRun`; and one test title that asserted the opposite
  of the behaviour ("surfaces resolution errors with isError" against a handler
  returning them as content, with no assertion either way).
- **Three invariants the audit verified by script are now tested**: PvP split
  reciprocity (the existing test said "bidirectionally" and only checked the
  target existed), `typeId` as a foreign key, and "the decoder throws nothing
  but `TemplateError`" over 3000 mutated golden codes.

TWO NOT FIXED, deliberately, with the reasoning so nobody re-derives it:

- **L2, an equal-length description swap dodging the growth gate.** The
  `MAX_DESCRIPTION_GROWTH = 80` docblock is explicit that the number came from
  measuring seven upstream commits and that 120 was tried and rejected. A
  word-diff percentage invented here would either fire on the next legitimate
  reword — recreating the rubber-stamping that docblock warns about — or be
  loose enough to be theatre. The residual risk narrowed anyway: the shared
  instruction pattern now applies regardless of length, so a bypass needs text
  that is instruction-shaped to a reader but matches neither the pattern nor a
  length change. Reopen by MEASURING against upstream history, not by guessing a
  threshold.
- **N3, `pnpm knip` needs ~6 GiB.** knip 6 parses via oxc-parser, which
  reserves a single 6 GiB `ArrayBuffer` by design, so `pnpm verify` (and the
  pre-push hook) cannot complete on a machine with less free. Already handled —
  the hook says to use `git push --no-verify` and that CI is authoritative —
  but it means "green local = green CI" carries a hardware asterisk. It ran
  fine on this machine.

Method note from this pass, worth keeping: the audit's own line numbers and
one of its version claims were stale (it reported the server negotiating
2025-06-18; the SDK's `LATEST_PROTOCOL_VERSION` is 2025-11-25). Both findings
were still real. Check the claim, not the citation.

## Method note

Three of my four initial "gaps" were my own bad fixtures — a wrong attribute name, a
skill that does not exist, a Ranger skill on a Dervish bar. And the two real defects
came out only after checking sources, not after reading code. Reading the
implementation cannot tell you the rule is wrong; it can only tell you the code does
what it says.
