# Game data and the weekly import

Where the data comes from, the three import modes, the French names decision, and the incident history of the weekly job (runs #18 to #26). Read this before touching update-data.yml or scripts/import.

## Game data

Source: https://github.com/build-wars/gw-skilldata. Its code is MIT, but the
skill descriptions it aggregates come from the Guild Wars community wikis
under GFDL / CC BY-NC-SA — see THIRD_PARTY_NOTICES.md, keep both notices, and
credit both in README. (The older build-wars/gw1-database SQL dumps are dead
since 2019; see Data maintenance.)

- Imported by a script into `packages/gw-data/data/*.json` (skills, professions, attributes, heroes, campaigns).
- The import script is committed and re-runnable; the generated JSON is committed too (the server must not fetch anything at runtime).
- Repository layer exposes typed lookups: `getSkillById`, `getSkillByName` (exact + case/diacritics-insensitive, English names then French — see below), `searchSkills({ profession?, attribute?, elite?, campaign?, nameContains? })`, `getHero`, `listHeroes`, `getProfession`, `listAttributes(profession)`.
- Skill names: canonical English names are the primary key. **FRENCH NAMES NOW
  RESOLVE (2026-08-31)** — this entry said the opposite until then, and the
  reversal is the trigger it wrote for itself firing, not a change of mind.
  The 2026-07-13 decision was DECIDED AGAINST on a fact ("@buildwars/gw-skilldata
  ships English and German only"), with the escape clause "revisit only if a
  machine-readable FR source appears". One appeared: upstream now serves
  `json/skilldesc-fr.json`, same shape as the English file, French names for
  100% of skills. So the premise expired rather than the reasoning being wrong,
  which is the whole reason a decision is worth writing down with its premise.
  What ships, and what deliberately does not:
  - `data/skill-names-fr.json`, the French name of every skill (generated, ~45 KB,
    +15.5 KB gzipped on the Worker bundle). NAMES ONLY: French descriptions are
    another 262 KB and would reopen the counsel-gated licensing question in
    THIRD_PARTY_NOTICES.md on a new wiki (gwiki.fr), for text an LLM does not need
    to resolve a skill.
  - `getSkillByName` tries English FIRST, always. A French name can add a way to
    reach a skill, never change which skill an English name reaches; a
    whole-dataset sweep in `repository.test.ts` is what makes that a fact.
  - `searchSkills({ nameContains })` stays English-only, and `nameContains`'
    own description says so — a French substring silently matching nothing is
    exactly the trap the audit L-series said to document on the forwarded field.
  - The passive nameDe fields stay cut. German has a machine-readable source too
    and nothing consumes it, so it is still speculative locale data; French is not,
    because French-speaking players are the maintainer's own use case.
- Two French limitations, both measured and both accepted (details in
  `repository.ts` and `transform.ts`):
  - 2 skills lose to English. "Récupération" is the French name of Recovery
    (1748) but normalises to `recuperation`, the English name of Recuperation
    (981) — so it resolves to 981. A single-answer lookup cannot serve both, and
    silently redefining an English name is the worse failure.
  - 5 French names are claimed by two skills each ("Rafale" is both Flurry and
    Gust). These do not resolve at all; the suggester returns BOTH English names,
    so the caller picks instead of the server guessing.

## Data maintenance & Reforged

- Upstream: build-wars/gw-skilldata (code MIT, npm @buildwars/gw-skilldata;
  the skill descriptions it packages are GFDL/CC-BY-NC-SA — see
  THIRD_PARTY_NOTICES.md, not MIT) —
  ACTIVELY MAINTAINED and tracks Guild Wars Reforged balance updates within
  days (verified: Feb 2026 Beguiling Haze 15->10; Reforged-added skills like
  Vow of Revolution id 3430 are present). The npm release may lag the repo
  tip; the update workflow therefore imports from a git clone.
- Old upstream build-wars/gw1-database (SQL dumps) is dead since 2019 and no
  longer used.
- Attribute ids are OURS, and since 2026-09 no longer upstream's: 0-44 are
  template attributes; 101 = No Attribute; 102-109 = PvE title tracks (NOT
  templatable). Upstream renumbered the non-template ones (101 -> -1, title
  tracks -> game ids 905/906/917/920/938-941, and the "No Skill" type 0 -> -1);
  `canonicaliseUpstreamIds` in transform.ts maps them back by English name in
  every source mode and refuses a non-template attribute it has no id for.
  `attributeId` ships in tool output, so these stay frozen like the boolean trio. Skills
  carry isPvpVersion/splitId for the separate "(PvP)" variants; searchSkills
  excludes PvP versions by default.
- Provenance in packages/gw-data/data/_meta.json, exposed via gw1://meta.
- .github/workflows/update-data.yml re-imports the upstream repo tip weekly
  and opens a PR when the data changes (golden-fixture tests gate the merge).
  The import validates the upstream files against the JSON Schemas they
  publish (draft 2020-12) so upstream format drift fails loudly.
- Import source modes (scripts/import.ts argv[2]): none = npm package (local
  dev); an https URL = the upstream's published GitHub Pages release files
  (what the workflow uses: https://build-wars.github.io/gw-skilldata — the
  author's public distribution interface, rebuilt by their CI on every push
  to main, so tip-fresh without cloning or coupling to internal repo layout);
  a path = a local git clone (offline use). In URL mode the constant tables
  (SKILLTYPES evolves!) come from the Pages-served node bundle built from the
  same commit, and provenance records the tip sha via git ls-remote.
- **The three modes are NOT equivalent any more: only two of them serve French.**
  `json/skilldesc-fr.json` exists on Pages (and in a clone) but npm 2.0.0 — the
  latest published version — exports `SkillLangEnglish` and `SkillLangGerman`
  only. So the French names are optional in the loader, a 404 on that one file is
  "this channel has no French" rather than a broken deploy, and the npm path asks
  `typeof SkillLangFrench === "function"` so it starts working the day upstream
  publishes. Note the Pages file is NOT linked from upstream's index page and is
  served anyway; it is validated against the same `skilldesc.schema.json` as the
  English file and put through `assertCoherentSnapshot`, which matters more here
  than elsewhere: the names are keyed by skill id, so a French file from a
  different build would attach the right name to the WRONG skill — the only
  failure mode in this pipeline that produces a confidently wrong lookup instead
  of a missing one.
- **All THREE modes go through `normaliseConstantTables`, and this is not
  optional.** @buildwars/gw-skilldata 2.0.0 replaced the flat
  ATTRIBUTES/CAMPAIGNS/PROFESSIONS/SKILLTYPES tables with classes carrying
  id-keyed statics (`Profession.NAME`, `Attribute.MAX_VALUE`, …). The normaliser
  accepts both majors, but it was wired into the npm path ONLY, so the other two
  broke: URL mode read four `undefined`s off a 2.x bundle and died three frames
  later on `Cannot read properties of undefined (reading 'map')` (weekly run #18,
  2026-08-17), and clone mode imported `es6/constants.js`, which 2.0.0 deletes
  outright. Clone mode now imports `es6/index.js` — the stable entry point across
  both majors (1.x re-exports the flat tables from it). Fixed by normalising in
  all three; verified end to end against real upstream bytes (a localhost mirror
  of the Pages layout serving the genuine `gw-skilldata-node.cjs`, plus a real
  tip clone), both reproducing the committed data byte-for-byte. The upstream
  bundle's shape is decided by upstream's DEPLOY, not by our lockfile, so tests
  stub both shapes; the pre-existing Pages test stubbed a 1.x bundle, which is
  why 376 green tests coexisted with a broken weekly import.
- **A provenance-only change is now COMMITTED when the import CHANNEL changes**
  (2026-08-17, found by re-running the workflow by hand as run #19). The change
  detection reverts `_meta.json` when it is the only diff, and must — every run
  rewrites the import date, so without it the weekly job opens a date-bump PR
  every Monday. The cost only became visible once the Pages path worked again:
  run #19 took it for the first time since the 2.x fix, computed
  `pages@e32dbdc4e0ec` with all five sha256 hashes, and threw it away because
  upstream had touched no skill. So the committed record went on reading
  `npm:2.0.0` — the mode the fallback wrote weeks earlier — and NOTHING in the
  repository showed the importer had recovered. That is the fallback's own
  silence in mirror image: there a green run hid bad news, here a green run
  carried good news that nothing persisted, and a reader three weeks later
  would still have concluded from the repo alone that it was degraded. Now a
  change of KIND (`npm` <-> `pages`) opens a PR on its own, while a date,
  version or hash bump within the same kind still does not. The decision is
  `scripts/provenance-changed.ts` — a unit-tested pure function, not shell
  string-slicing, because it is precisely the sort of logic never exercised
  until it is wrong. **The first version of it broke the weekly job anyway
  (run #20), and not in the logic**: the step called it via
  `pnpm --filter <pkg> exec`, which chdirs into `packages/gw-data`, while
  passing repo-root-relative paths — so `packages/gw-data/data/_meta.json`
  resolved to `packages/gw-data/packages/gw-data/data/_meta.json` and the job
  died with ENOENT. Every unit test stayed green throughout, because they
  import the function and never touch a path or a cwd. Worse, the manual check
  that was meant to catch it passed for the WRONG REASON: the bad path was
  supplied as the BEFORE argument, where a read failure is deliberately
  swallowed as "no record", so it printed `changed` and looked healthy. The
  lesson is the one this file already had from the audit's own false findings —
  check the harness before believing the harness — applied one step too late.
  Three things now hold the line: the invocation is `pnpm exec` from the repo
  root with `$GITHUB_WORKSPACE`-absolute paths, so cwd cannot matter; a missing
  AFTER file is a hard error naming the resolved path and the cwd, so a path bug
  can never masquerade as a data decision; and `provenance-cli.test.ts` runs the
  script as a SUBPROCESS from a foreign cwd and statically asserts the workflow
  still passes absolute paths. That last test was verified non-vacuous by
  restoring the run #20 line and watching it fail.
  **Run #23 (2026-08-31) then found the SAME shape one layer out: the two-job split
  carries changes through ONE path-scoped `git diff`, and README.md was not in the
  path list.** So `syncReadmeSkillCount` rewrote the advertised count in the import
  job, the patch dropped the file, and the open-pr job opened a PR whose data carried
  the new upstream count next to a README still advertising the old one — failing
  `repository.test.ts` three packages from the cause. (Both figures are deliberately
  absent: the sibling lock reads "<number> skills" as a CURRENT claim and fired on
  this very paragraph while it was being written, for the third time in this file's
  history. Naming the numbers here would make the prose stale the moment the next
  import lands, which is the whole point of not hand-keeping derived numbers.) Two details make this worth remembering. The import job was
  **GREEN**: `pnpm -r test` runs there, where the rewrite still exists, so only the
  PR ever sees the loss — the same "green means nothing happened" trap as the npm
  fallback, in mirror image. And it made the 2026-08-10 fix HALF-WIRED for three
  weeks: the generator owned the number, the pipeline did not carry it, and "the
  generator owns it" was true and useless. Fixed by adding README.md to the diff, and
  locked statically by `provenance-cli.test.ts`, which asserts all three generated
  paths reach the open-pr job. The count assertion's failure MESSAGE now names this
  cause too: it has fired twice for a reason three packages away, both times reading
  as a counterproductive lock and both times being right, so it points at the patch
  path list before anything else. When adding a generated output, the path list in
  `update-data.yml` is a second place to update — the artifact boundary is not
  something the unit tests can see.
  Consequence worth knowing: while provenance reads `npm:`,
  the shipped data carries none of the GW1-06 content hashes, deliberately (the
  npm path relies on lockfile SHA-512 integrity instead).
- **The npm fallback in update-data.yml has now masked a persistent Pages break
  TWICE** — the `--` argument bug (masked "for months", see import.ts's docblock)
  and the 2.x tables above. Both times the mechanics were identical and worth
  recognising on sight: the fallback re-imports the version the lockfile already
  pins, which produces a ZERO diff, so no PR opens and the silence is
  indistinguishable from a quiet week upstream. The fallback is kept (a genuine
  Pages outage should not red the weekly job) but is no longer silent: it sets a
  step output and a `notify-degraded` job calls notify-failure.yml with its own
  issue thread. `if: failure()` could never have caught this — the fallback makes
  the job SUCCEED. When a green scheduled run is the failure mode, the
  notification has to hang off the degradation, not off the exit code.
- **Run #25 (2026-09-07) failed on a NAME collision upstream introduced, and the
  fix made the name rules ours.** Upstream dropped its "(Luxon)"/"(Kurzick)"
  suffixes from the ten faction title-track pairs (Shadow Sanctuary, Ether
  Nightmare, "Save Yourselves!", Summon Spirits… — ids 1948-1957 and 2051
  against 2091-2100), which are DISTINCT skills the game gives one name; twenty
  skills landed on ten keys and the import job died on the bijectivity lock in
  `repository.test.ts` with "expected 2091 to be 1948" — the right failure,
  naming neither skill, three steps after the cause. `transform.ts` now applies
  the GWW suffix itself whenever shipped names collide and the faction tracks
  tell every member apart (`disambiguateFactionPairs`, a no-op when upstream
  disambiguates, so the committed names did not move), mirrors it into the
  French table (those pairs were ten of the fourteen "ambiguous" French groups; a
  French caller now gets an exact answer), collapses whitespace runs (upstream
  also shipped "Aegis (PvP)" with two spaces on three PvP names in the same
  deploy), and refuses ANY other collision at import time with both skills named
  (`assertUniqueSkillNames`). Same pattern as "(PvP)" on Mighty Throw: a naming
  rule upstream applies inconsistently becomes one we enforce. Verified against
  the live Pages bytes rather than the stubs: the re-import reproduces every
  committed English name byte-for-byte and the whole suite passes on the
  resulting data, so the next weekly run is expected green. It will carry a
  wholesale description reword upstream made in the same window (every
  description now opens with its skill type — well under the +80 growth gate,
  which answered `changed=false` on it locally).
- Pages also serves combined JSON, paw-ned2 CSVs, and per-skill JSON at
  /json/skills/[SKILL_ID].json should a lightweight runtime lookup ever be
  wanted. npm release may lag the Pages/tip by a release.
- Skill ids/names/professions/attributes/elite flags are stable across
  balance patches — the codec and validator never go stale; only stats and
  descriptions move, and the upstream now keeps those fresh too.
