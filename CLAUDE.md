# CLAUDE.md — gw1-mcp

## What this project is

An MCP (Model Context Protocol) server that gives any compatible LLM client (Claude, ChatGPT, Cursor…) reliable, deterministic knowledge of **Guild Wars 1** builds: skill data lookup, template code encoding/decoding, and build validation.

**Core design principle — the MCP is a compiler, not a brain.**
The LLM does all strategic reasoning (which skills to pick, team composition, meta knowledge, reading guides). This server only does things that must be _exact_:

- know the canonical game data (skills, professions, attributes, heroes, IDs)
- encode/decode official in-game template codes
- validate builds against game rules
- report precise, structured errors

Never add a tool that "reasons" or "generates" a build from vague intent. If a tool needs intelligence to work, it belongs in the LLM, not here.

## Commands

```bash
pnpm install                      # Node >= 22, pnpm 11
pnpm -r typecheck && pnpm -r test # must pass from a clean clone
pnpm lint && pnpm fmt             # oxlint / oxfmt (CI runs fmt:check)
pnpm test:coverage                # reference levels: see Coverage section
pnpm bench                        # vitest bench in every package (see Performance)
pnpm --filter @gw1-mcp/gw-worker dev        # local worker
npx wrangler deploy --dry-run               # bundle check (in gw-worker)
```

Nothing is ever built to dist: exports point at .ts sources; the worker
bundles via wrangler.

## Architecture

pnpm monorepo, TypeScript everywhere.

```
gw1-mcp/
├── CLAUDE.md              ← you are here
├── packages/
│   ├── gw-data/           ← game data (JSON from build-wars/gw-skilldata) + repository layer
│   ├── gw-template/       ← template code codec (encode/decode) — ZERO dependencies, pure functions
│   ├── gw-mcp/            ← MCP server exposing tools; depends on gw-data + gw-template
│   └── gw-worker/         ← Hono transport: Cloudflare Workers + Node (same app)
└── gwtoolbox-plugin/      ← AccountExport C++ plugin (built in CI on a GWToolboxpp checkout)
```

Dependency direction is strict: `gw-mcp → gw-data, gw-template`. Neither `gw-data` nor `gw-template` may import from `gw-mcp` or make network calls. Everything must work fully offline.

## Tech stack

- Node 22, TypeScript strict mode (`"strict": true`, no `any`, no `@ts-ignore` without a comment explaining why)
- pnpm workspaces
- Vitest for tests
- Zod for all tool input/output schemas
- `@modelcontextprotocol/sdk` (official TypeScript SDK)
- Transports: stdio first (local dev/testing), then Streamable HTTP
- Deployment target: Cloudflare Workers — keep `gw-mcp` free of Node-only APIs (no `fs` at runtime; game data is bundled/imported as JSON)

## Guild Wars 1 domain rules (the validator must enforce these)

A **build** (skill bar) consists of:

- a primary profession and an optional secondary profession
- attribute allocations (attribute id → rank)
- exactly **8 skill slots** (an empty slot is valid and encodes as skill id 0)

Validation rules:

1. **At most one elite skill** per bar.
2. Every skill must belong to the primary profession, the secondary profession, or be profession-less (common / PvE-only skills).
3. A skill's attribute must belong to one of the two professions (or be no-attribute).
4. The **primary attribute** of a profession (e.g. Divine Favor, Mysticism, Soul Reaping) is only available if that profession is the _primary_ one.
5. Attribute ranks in a template are **base ranks 0–12** (runes/headgear are not part of the template code).
6. No duplicate skills on one bar — except Signet of Capture, which may
   appear up to 3 times.
7. **Errors** (not warnings) for PvE-only skills on a hero bar — heroes
   cannot equip them at all; a player bar caps at 3 PvE-only skills.
   Warnings remain for milder advisories like skills from a campaign the
   player may not own.

Distinguish `errors` (build cannot exist / template cannot be generated) from `warnings` (build is encodable but suspicious). Always return both lists.

## Template code format — source of truth

The codec in `packages/gw-template` is implemented and round-trip tested. Do **not** change the bitstream layout from memory. The authoritative references are, in order:

1. The golden test fixtures (below) — real codes; extend them, never edit them.
2. The verification corpus itself — 27 golden fixtures from four independent
   encoders (the pre-2007 game client, PvXCode, @buildwars/gw-templates, a
   GWW player page), differential + fuzz + malformed-input tests. The maintainer's
   historical Python codec, once planned as a reference oracle under
   reference/, is no longer needed for correctness; welcome as an optional
   extra cross-check if it ever surfaces.
3. Guild Wars Wiki: https://wiki.guildwars.com/wiki/Skill_template_format

The codec must be perfectly **round-trip stable**: `encode(decode(code)) === code` for every fixture, and `decode(encode(build))` deep-equals `build`.

## Codec verification layers

1. Golden fixtures (below) — game/PvX-generated codes, character-exact.
2. Round-trip fuzz (2000 random UNCONSTRAINED builds — roundtrip-fuzz.test.ts:
   equal professions, duplicate attribute ids, ranks 13-15, skill ids to
   65535 crossing every bit-width class; legality is out of scope here).
3. Differential fuzz vs @buildwars/gw-templates (independent implementation,
   production-tested on gw1builds.com): their decoder must reproduce our
   encoder's input on every legal build. Known upstream deviations are
   documented in test/differential.test.ts (24-bit padding quirk, width
   floors, silent normalization of illegal inputs) plus one real upstream
   BUG (lone high skill id truncation — sentinel test + report in
   docs/upstream-gw-templates-bug.md; consider filing it upstream).
4. @buildwars/gw-templates is also a runtime dependency of gw-mcp for the
   paw-ned2 team container format (decode_pawned_team tool); individual bars
   are decoded by OUR codec.

## Attribute order in template codes (learned from wild codes)

Real-world codes do NOT share a canonical attribute order: most tools emit
ascending ids, but e.g. the PvX Imbagon code stores [Leadership 40, Spear 37,
Command 38]. The game's decoder accepts any order. Our encoder canonicalizes
to ascending ids (deterministic output, matches the majority of wild codes);
consequence: string-exact round-trip is only guaranteed for ascending-order
codes, semantic round-trip always holds and is asserted for every fixture.

## Codec questions settled with in-game codes

1. Zero-attribute bars: which filler value the game writes in the unused
   attribute bit-length field.
2. Attribute width floor: with all attribute ids < 16 (e.g. any Mesmer
   FC/Dom/Insp bar), does the game emit the spec-minimal 4 bits or pad to 5
   like PvXCode and @buildwars/gw-templates do (shared authorship)? Our
   encoder emits the minimum; both forms decode identically everywhere.
   Corpus coverage (27 fixtures, incl. nine live in-game emissions): ALL 10 primary professions, 8 secondaries, skills from all 5 campaigns (Core, Prophecies,
   Factions, Nightfall, EotN), all 64 charset chars exercised ('+' and '/'
   included), both header formats, sorted and unsorted attribute orders, three
   independent third-party encoders (the game pre-2007, PvXCode, and
   @buildwars/gw-templates via gw1builds.com whose icon URLs expose skill IDS
   for id-level verification, plus a GWW player page whose Ranger codes are
   byte-identical to our encoding except one trailing zero-padding char).
   The fixture wishlist was FULLY SERVED on 2026-07-16 (nine live client
   emissions including the empty bar and all-low-attribute-id bars, four
   byte-exact) — every question it was written to arbitrate is settled; see
   the "in-game emission" fixture class and the codec.ts dialect note.

## TypeScript configuration philosophy

tsconfig.base.json is intentionally minimal on top of TypeScript >= 7
defaults (strict, modern targets and consistent casing are now built in —
verified by probing tsc 7.0.2 with a bare config). Only options that
provably change behavior for this codebase remain, each with a
justification comment. Before adding an option, probe whether the default
already covers it; before removing one, know which file relies on it (e.g.
`module: ESNext` exists for the single `with { type: "json" }` import).

## Linting and formatting: oxlint + oxfmt

`pnpm lint` (oxlint, ~10ms, zero config) and `pnpm fmt` / `pnpm fmt:check`
(oxfmt); both run in CI. The earlier no-linter stance was revisited once
the Rust toolchain made the cost negligible — adoption found exactly one
real finding (an ambiguous `new Array(n)`), confirming the code was clean
but the guard is free. CRITICAL: .oxfmtrc.json ignores generated files
(packages/gw-data/data/**, gw-template test fixtures, .release-please-manifest.json and CHANGELOG.md, both rewritten by release-please in its own style) — formatting them
would fight the scripts that emit them and pollute every weekly data PR.
Keep that list in sync when adding generated outputs.

## Coverage expectations

Codecov incident register: bot-pushed commits (gw1-mcp-bot release PRs) get
their uploads PROCESSED but the notification layer stays silent under the
default config — no statuses, no PR comment ("No Status" in their UI).
`codecov: notify: wait_for_ci: false` in codecov.yml fixes it; the removal
experiment (2026-07-15) confirmed the correlation 2/2 (the very next bot PR
#13 got zero statuses again), so the setting is PERMANENT. Do not remove it
without a Codecov support resolution (evidence: run 29372114225). The admin
bypass merge stays the legitimate unblock if it ever regresses (release PRs
have 0 coverable lines).

`pnpm test:coverage` (provider @vitest/coverage-v8, version-locked to the
workspace vitest). Reference levels, REMEASURED 2026-08-17 (the previous
figures — ~92 / ~93 / ~93 / 100 — had drifted low enough that a real
regression would still have read as on-target, which is the opposite of what
a reference is for): gw-template 99.3% statements (uncovered: internal-bug
guards in bitstream/base64 unreachable from valid inputs), gw-data src 98.2%
(scripts/import.ts intentionally untested — validated by upstream schemas at
run time and golden tests downstream; the scripts/ tree as a whole sits ~83%),
gw-mcp 96.8% with validate.ts and build-io.ts at 100% lines and server.ts
~95%, gw-worker app.ts 99.0% (index/node/stdio are entry-point shims).
These are a REFERENCE, not a gate: the mechanical guard against a coverage
regression is `codecov/project` at a 1% threshold on every commit, so do not
add vitest thresholds that would duplicate it. Every validator rule and
resolution error code MUST have a test that triggers it — and this rule is
MECHANICALLY ENFORCED by test/conventions.test.ts in gw-mcp, which scans
the src for `code: "..."` declarations and fails if any code never appears
in the test corpus. Tool failures use
the MCP isError flag via the jsonError helper — keep new tools consistent.

## Performance benchmarks (CodSpeed)

`pnpm bench` runs `vitest bench` in every package; CI runs the same command
once through the CodSpeed action (.github/workflows/codspeed.yml, simulation
mode, OIDC — no token secret) and comments the diff on the PR. Each package
carries a `vitest.config.ts` whose only job is registering
`@codspeed/vitest-plugin`; the plugin is inert unless CODSPEED_ENV is set, so
`vitest run` behaves exactly as it did when the packages had no config at all.

What is measured, and why those and not others — every one of them is a path
this file already argues about in prose:

- gw-template `bench/codec.bench.ts`: decode/encode/round-trip on the golden
  corpus, plus the zero-tail scan on a 10k-char padded code (the GW1-01/GW1-02
  hardening).
- gw-data `bench/repository.bench.ts`: name lookup, the three search shapes,
  and the fuzzy suggester — including the padded worst case that GW1-AUD-01
  bounded (the 109 ms -> 1.4 ms fix has a regression guard now).
- gw-mcp `bench/build.bench.ts`: resolve -> validate -> describe, then the
  same tools through the SDK over InMemoryTransport.
- gw-worker `bench/startup.bench.ts`: `createApp` — route registration only,
  NOT the MCP server (see the CodSpeed section: it is the noise floor). The
  `bench/http.bench.ts` this list claimed until 2026-08-11 does not exist; the
  async JSON-RPC benchmark that reported 221 ms was removed and the entry was
  never updated. So there is NO committed benchmark of the `/mcp` request path,
  and a change to that hot path has to be measured against real workerd by hand
  (`wrangler dev --local`, time N sequential POSTs, compare medians against the
  same run on main — that is how the batch middleware was cleared: 3.02 ms vs
  3.03 ms p50 for `tools/list`, i.e. free).

Benchmarks are measured, not asserted: nothing fails on a slow number, the
report is the signal. Keep them deterministic (no network, no clock, no
random input) — CodSpeed compares runs, so a benchmark that varies by input
is noise, not data.

## Logo and favicon (single source)

SINGLE logo source: assets/brand/icon-1024.png (the scythe + 8-slot skill-bar
badge, from an image model; a 512px copy sits beside it, used in the README header).
Everything derives from it:

- Directory submission forms: upload icon-1024.png directly (forms prefer PNG).
- Worker favicon: assets/brand/favicon-32.png (a 32x32 export of
  icon-1024.png). The PNG is imported ONLY in src/index.ts (the real Worker
  entry point, the sole file wrangler bundles), which passes the bytes to
  createApp(faviconPng). Config lives in two spots: wrangler.jsonc "rules"
  (png as Data) and the ambient declaration types/assets.d.ts. NO vitest
  config is needed: tests call createApp() with no favicon (or fake bytes), so
  the test path never imports a binary. Served at /favicon.ico, /favicon.png,
  /logo.png; the full-res logo is never bundled (~2 MB bundle, ~2.5 KB
  favicon). Refresh by re-exporting favicon-32.png from icon-1024.png with any
  image tool. No SVG logo, no base64 module, no build script.

## Releasing

Single SemVer version for the whole repo (root package.json + server.json,
kept in sync by release-please's extra-files updater; sub-packages are
private and unversioned in practice). Flow: conventional commits on main →
release-please maintains a release PR → merging it creates the tag, the
GitHub release and the CHANGELOG entry → the SAME release-please run then
publishes the new version to the MCP Registry via OIDC (gated on its
release_created output — GITHUB_TOKEN-created events cannot trigger other
workflows, so an on-release workflow would never fire).

Commit-type discipline matters mechanically, not just stylistically:
`type(scope): description` is the ENTIRE grammar release-please's parser
accepts — `feat(mcp)+docs: ...` (mixing a second type after the scope) is
invalid Conventional Commits syntax and release-please silently fails to
credit it as a feat, computing a patch bump instead of the minor one an
additive feature deserves (discovered 2026-07-21: a multi-topic commit for
the search_skills `offset` param used exactly this malformed prefix, and the
pending release PR came out as 0.7.1 instead of 0.8.0 — fixed via a
`Release-As:` footer rather than rewriting pushed history). When a commit
spans multiple concern types, pick the SINGLE highest-precedence type
(feat > fix > everything else) for the prefix and describe the rest in the
body — never concatenate types.
Three workflows are REUSABLE (workflow_call): publish-registry.yml and
build-gwtoolbox-plugin.yml are the single source for the registry publish and
the plugin DLL build, invoked by release-please.yml via uses: on release, and
runnable standalone (dispatch / plugin-path push); notify-failure.yml is the
single source for "a scheduled job broke and nobody is watching", invoked by
both weekly jobs. No build, publish or alerting logic is duplicated across
workflows. Nothing
manual beyond merging the PR. Same GITHUB_TOKEN rule hits the weekly data
PR (update-data.yml): CI never auto-starts on it —
UNLESS the gw1-mcp-bot GitHub App credentials exist (AUTOMATION_APP_ID +
AUTOMATION_APP_PRIVATE_KEY secrets; ephemeral ~1h installation tokens are
minted per run via actions/create-github-app-token — no long-lived PAT
anywhere since 2026-07-15,
Contents RW + Pull requests RW): then the PR is authored by a real
identity, CI and CodeQL trigger normally, and the workflow enables
auto-merge for a fully zero-touch weekly update. The only persistent
credential is the App private key (never expires; a second key of the SAME
app is held by Grafana Cloud for Git Sync — keys are revocable
independently on the app page, one per consumer). The same app token is
handed to release-please, so release PRs are authored by gw1-mcp-bot —
their CI/CodeQL runs start unattended, and the tags and
releases it creates DO emit events (unlike GITHUB_TOKEN ones); the
release-time jobs are wired via needs/if in the same run precisely so this
changes nothing. Each release also
rebuilds AccountExport.dll on a Windows runner and attaches it to the
GitHub release (job attach-plugin-to-release in release-please.yml).

Supply-chain posture (updated 2026-07-20 after an external audit): every
third-party action is pinned by full commit SHA with a trailing # vX comment
— a moved tag can no longer swap the code CI runs; Dependabot understands
this format and bumps the SHAs weekly. packageManager carries the pnpm
sha512 integrity hash (corepack verifies the binary itself). CI also runs
actionlint, so invalid workflow expressions fail a PR check.

pnpm 11 defaults `minimumReleaseAge` to 1440 minutes (1 day) — introduced
platform-wide after the 2025 "Shai-Hulud" npm worm wave — and refuses to
resolve any package version published more recently than that, lockfile
entry or not. We never configured this; it is pnpm's own default and we
deliberately have NOT set `minimumReleaseAge: 0` to opt out. Dependabot's
npm entry carries a matching `cooldown: default-days: 1` (2026-07-22) so it
never even proposes a PR pnpm would immediately refuse to resolve — before
this, `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION` on a Dependabot PR (typically
oxfmt/oxlint's platform-native binaries, which publish very frequently) was
the policy doing its job, not a bug, and the fix was patience. Keep the two
numbers in sync if either changes — a mismatch just brings the same
guaranteed-red-PR problem back.

MANUAL PINS Dependabot CANNOT see all live in **`.github/pins.env`**, and that
location is load-bearing rather than tidy — see the file's own header. They were
job-level `env:` inside the workflows until 2026-08-11, which made
`upstream-pin-bump.yml` structurally unable to do its job: it opens its PR with
the gw1-mcp-bot App token, and GitHub refuses ANY App push touching
`.github/workflows/**` without `Workflows: write`. So it detected drift and died
at "Open pull request" on 2026-08-03 and 2026-08-10, having looked green the two
runs before purely for want of drift — while GWToolboxpp fell 4 commits behind and
mcp-publisher a release behind. Granting the App `Workflows: write` was the other
fix and was rejected on purpose: it gives an automated identity the right to
rewrite the CI that reviews everything else. A conventions test now fails if any
pin value reappears inside a workflow file.

Consumers load it with `grep -E '^[A-Z0-9_]+=' .github/pins.env >> "$GITHUB_ENV"`
— the grep is what allows comments in the file. Bump each deliberately:

- GWTOOLBOX_COMMIT: the GWToolboxpp commit the plugin compiles against. Was a
  floating master clone (GW1-04). Build runs contents:read; a separate
  release-upload job holds contents:write. `pins.env` is in the plugin build's
  `paths:` trigger, so a bump rebuilds — which is what makes the tripwire's "CI
  proves it still builds" claim true.
- VCPKG_COMMIT: upstream's pinned vcpkg toolchain commit.
  Deliberately NOT watched by the tripwire (unlike GWToolboxpp/mcp-publisher):
  vcpkg's master moves dozens of times a day and it is a frozen build
  toolchain, not a feature source — auto-PRing it would be pure noise. Bump it
  manually only when a dependency actually needs a newer vcpkg baseline.
- MCP_PUBLISHER_VERSION + MCP_PUBLISHER_SHA256_AMD64/ARM64: pinned release with
  per-arch digest check (GW1-05). To bump: download the new tarballs,
  `sha256sum` them, update the version and BOTH digests together.
  `publish-registry.yml` re-binds them to the short names its script uses instead
  of exporting a job-wide `VERSION`.
  The weekly upstream-pin-bump workflow opens a PR (never auto-merged) when any of these drifts from upstream latest, recomputing mcp-publisher's digests for eye-review — the active tripwire instead of memory. It NOW HAS a notification path (2026-08-14), which it lacked when two weeks of failure went unnoticed: on any failure it calls the reusable `notify-failure.yml`, which opens ONE GitHub issue per workflow and comments on it every subsequent failure. `update-data.yml` calls it too — a zero-touch weekly job whose gates exist to WITHHOLD a merge looks identical from outside whether it withheld or crashed. Three things about it are load-bearing: an issue needs no secret and no dash-side config (debt #1 is the category that caused a silent breakage of its own); it is never closed automatically, because a green run does not mean the cause was understood and the recurrence count is the datum that would justify real alerting; and `issues: write` is granted at the CALL SITE, since a reusable workflow can narrow the caller's token but never widen it, and both callers grant `contents: read` at the top — get that wrong and the alarm about the unnoticed alarm is itself silently denied.

The weekly Pages import stays isolated from all secrets by the two-job split
in update-data.yml; its npm fallback is lockfile-integrity-checked. Data
import provenance now records sha256 of the downloaded bytes (GW1-06).

**The import can be handed a PHANTOM snapshot, and was (2026-08-10).** Pages is a
live, mutable source: five files fetched in sequence from a deploy that can be
rebuilt between requests. That run imported a snapshot one skill SHORT of what
upstream serves before and after — a deploy read mid-rebuild. (Phrased without the
figure on purpose: the doc-count lock reads "<number> skills" as a current claim
and fired on this very paragraph while it was being written, which is the ratchet
demonstrating itself.) The provenance comment in load.ts had
predicted exactly this ("a Pages redeploy between requests could even mix
versions") and answered it by hashing the bytes, which makes an incoherent import
reproducible rather than impossible. `assertCoherentSnapshot` now hard-fails when
skilldata and skilldesc disagree on their id sets, because they are generated
together. Note what does NOT work: a count-delta bound. The count moved by ONE,
which is what a balance patch looks like.

Two things followed from the same incident. The failing check was
`repository.test.ts`'s README count assertion — three packages away, naming the
wrong culprit — and because `update-data.yml` never rewrote README while the test
demands it be exact, the lock was a ONE-WAY RATCHET on the only automated path
that changes the count: the first legitimate count change would red the weekly job
until a human edited prose. The import now owns that number
(`syncReadmeSkillCount`), like every other derived byte ("no unmanaged copies").
And the whole incident self-heals: content matches again, so the next run goes
green and nothing records that the pipeline can ingest a snapshot that never
existed. That is why this paragraph exists.

CodeQL runs via GitHub DEFAULT SETUP: its configuration lives OUTSIDE the
repo (Settings -> Code security), the same out-of-repo category as the
Cloudflare dash settings (debt #1). Verified via the API (2026-07-13):
state configured, default query suite, weekly schedule, and the language
list is broader than one might assume — actions, c-cpp, javascript,
javascript-typescript, typescript — so the C++ plugin AND the workflow
files are scanned, not just the TS. The dynamic CodeQL runs in the Actions
tab are the proof it is active; do not look for a codeql.yml here. If the
default setup is ever disabled by mistake, re-enable it with those same
five languages.

## Internal conventions (uniform on purpose)

- Conventional commits (`feat:`, `fix:`, `test:`, `chore:`, `docs:`, `ci:`…) — release-please reads them; any other type (e.g. `assets:`) silently vanishes from the changelog, so do not invent types.
- Public functions get TSDoc; comments explain _why_, not _what_.
- Language: code, identifiers, docs and commits in **English** (public OSS repo); French is fine in issue/PR discussions.
- Sub-packages are all `"private": true` — @gw1-mcp/* must never reach npm.
- ONE script archetype, and it covers entry shims too (stdio.ts, worker
  node.ts): every executable wraps its flow in main() behind an
  `isDirectRun` guard — importing a module must never trigger I/O
  (network, files, ports, stdin). The description-growth gate was the last
  holdout on both counts until 2026-08-17: it was a `.mjs` PAIR whose entry
  point ran `execFileSync` at module top level, so importing it shelled out to
  git. It is now one `.ts` file in the archetype. Nothing was lost by dropping
  `.mjs` — the privileged `open-pr` job still runs it with BARE `node` and no
  install, because node strips type annotations (unflagged since 22.18) without
  ever checking them; the workflow pins Node 24 via setup-node rather than
  trusting the runner image, since that is now a real requirement. What was
  GAINED is `tsc`: those ~100 lines of a security gate were completely
  untypechecked, verified by planting `const oops: number = "not a number"` in
  the old `.mjs` and watching typecheck pass. Merging the pair also removed the
  cross-file import, so no `allowImportingTsExtensions` was needed — note that
  bare node requires a `./x.ts` specifier and will NOT resolve the usual
  `./x.js`, which is the constraint to remember if this is ever split again. Two deliberate non-violations: pure
  in-memory index building at import time is initialization, not a side
  effect (gw-data repository Maps — required for Workers bundling); and
  gw-worker/src/index.ts exports `createApp()` because the Cloudflare
  Workers module contract demands a default export. Scripts whose logic is unit-tested
  additionally export their pure functions (import-heroes.ts); import.ts
  exports nothing because nothing tests it. (This replaced an earlier
  two-archetype rule: the top-level form was symmetrized once we realized
  the generated files themselves prove such a refactor — byte-identical
  output before/after.)
- Generated data files are always `JSON.stringify(data, null, 1)` plus a
  trailing newline, whatever the concatenation syntax.
- Docblocks: script entry points carry a full header (what, why, how to
  run, failure modes); src modules deliberately carry none — this file,
  the types and the tests are their documentation. Tool failures use
  jsonError (MCP isError); validation reports are plain json.

## Data provenance rule

data/_meta.json records provenance for EVERY generated data file, one key
per pipeline (skills <- @buildwars/gw-skilldata import, heroes <- GWCA enum

- curated overlay). Each generator read-merge-writes only its own key. A
  new generated artifact MUST add its key there — "no unmanaged copies":
  every derived byte in the repo has a generator, a provenance record, and a
  refresh path (the weekly workflow); everything else committed is either
  curated original knowledge (heroes-overlay.json) or a deliberately dated test
  snapshot (fixtures).

## Known debts and risks (the honest register)

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

1. Deployment is LIVE and verified (2026-07-11): Cloudflare Workers Builds
   deploys every push to main to https://gw1-mcp.graphmaxer.workers.dev
   (first production tool calls served the same day). Residual debt: the
   build settings live in the Cloudflare dash, NOT in the repo — Root
   directory `packages/gw-worker`, Build command `pnpm -r test` (never
   deploy red). If the worker ever redeploys wrong from a fresh setup,
   re-apply those two settings first. GitHub CI and Workers Builds both run
   the test suite per push — deliberate redundancy (PR signal vs deploy
   gate).
   **Dash-side config has cost something real.** `GLAMA_MAINTAINER_EMAIL` was
   never set, so `/.well-known/glama.json` 404'd for weeks and Glama's crawler kept
   retrying. Investigating it surfaced the actual question: Glama verifies ownership
   only by an email in that file matching the account's, so claiming the listing
   means publishing an address at a predictable public URL. Declined, the Glama
   account deleted, and the route REMOVED — a test asserts the 404 so nobody
   restores it after reading that 404 as a bug. Nothing was lost: the listing stayed
   live and scored A throughout, because Glama indexes from the MCP Registry.
   Dash-side settings still depended on, so they can be checked:
   Workers Builds root directory, the **Workers Builds API token**,
   `OPENAI_APPS_CHALLENGE` (submission-time only), the `MCP_ANALYTICS` and
   `RATE_LIMITER` bindings, and the Grafana Infinity datasource credentials.
   **Build watch paths were narrowed on 2026-07-31** to `packages/**`,
   `assets/brand/favicon-32.png`, `pnpm-lock.yaml` and `package.json`. They had been
   `*`, so every commit rebuilt and REDEPLOYED: on 2026-07-31, 19 of 26 commits
   touched only documentation and assets, each producing a new Version ID and
   recycling production isolates for a Markdown change. The favicon is in the list
   because `src/index.ts` imports it; the C++ plugin is at the repository root, so it
   is already outside.
   The build token earned its place on 2026-07-31: it silently became invalid
   ("belongs to a user who has left your organization") and every deploy failed
   afterwards, with the reason visible only in the Cloudflare build log. Worse, it
   correlated by coincidence with a performance commit, so the obvious reading was a
   code regression — and I proposed exhausted build minutes, which was also wrong.
   When a Workers Build fails, read the Cloudflare log FIRST; the repository cannot
   tell you anything about a dash-side credential.
2. The C++ plugin compiled clean on the first CI run (/W4 /WX, zero
   warnings — 2026-07-11) but has never been loaded in-game. Trigger:
   the maintainer runs /exportaccount with the artifact DLL.
3. Codec questions, updated 2026-07-16 with two codes copied from a live
   client: trailing padding is SETTLED — the client pads to an
   EVEN number of chars (8/8 live samples; even-minimal codes come out
   byte-identical to our encoder, golden-locked as "in-game emission"
   fixtures including three byte-exact ones); our decoder tolerates arbitrary trailing zeros and
   the game loads our minimal codes (field-proven both ways, dialect rule
   documented in codec.ts). Zero-attribute filler is SETTLED too: the
   client's empty-bar emission is byte-identical to ours (degenerate golden).
   Attribute width shows no disagreement across 9 live samples covering high
   Dervish attribute ids and the zero count — the codec has NO open
   questions left.
4. Runtime dependency @buildwars/gw-templates has a known truncation bug
   (docs/upstream-gw-templates-bug.md, report ready to file). Our sentinel
   test pins the buggy behavior: when upstream fixes it, the sentinel FAILS
   on purpose — update the sentinel and delete this line.
   VERIFIED NOT EXPOSED, 2026-07-29 — do not let this line scare anyone into
   reimplementing the dependency (it nearly did). Three independent reasons:
   the bug is on the ENCODE side (getPadSize is called only from
   SkillTemplate.encode and EquipmentTemplate.encode) and we only ever call
   decode; it lives in SkillTemplate/EquipmentTemplate while we import only
   PwndTemplate, which neither uses getPadSize nor delegates to those
   encoders; and PwndTemplate.decode hands back each slot's skill code as an
   opaque string that OUR codec decodes. Demonstrated on the real PvX fixture:
   slot 0 decodes to 2358,1035,2235,2353 — and 2235 is one of the very ids the
   bug report names as corruptible. The report is still worth filing for other
   consumers; the report itself notes gw1builds.com depends on this library in
   production, where the encode path IS used.
5. heroes.json is GENERATED (scripts/import-heroes.ts): ids/names are
   derived at import time from the GWCA HeroID enum (vendored in GWToolboxpp
   — the standalone gwdevhub/GWCA repo 404s since ~2026, the vendored copy
   IS the living source, and it gains new Reforged heroes within days).
   The same run writes gwtoolbox-plugin/AccountExport/hero-names.generated.h
   (the C++ plugin's HeroID-indexed name table — one pipeline, two consumers,
   nothing to keep in sync; the hand-kept table it replaced had silently
   drifted, ids 36-39 exported "Unknown").
   Never edit heroes.json or the generated .h by hand. The only curated file is
   data/heroes-overlay.json (professionId/campaignId/unlock — knowledge that
   exists in no machine-readable source). The weekly workflow regenerates;
   a new upstream hero makes the run fail listing the identifiers to add to
   the overlay, then the regenerated hero rides the weekly PR. Trigger:
   that failing run; curate the metadata from GWW.
6. The worker URL is public DE FACTO (public repo + guessable workers.dev
   name) with no auth. A per-IP rate limiter (100 req/min) is in place
   (added after this entry was first written — see wrangler.jsonc), so the
   residual risk is narrower: free-tier quota burn from many distinct IPs,
   not a single client hammering it. Accepted: the server holds no secrets
   and mutates nothing. Trigger: unusual traffic in the Cloudflare
   analytics, or wanting to share the URL deliberately → add a Cloudflare
   WAF rate-limiting rule or a bearer check in app.ts.
7. Early-adopter stack: TypeScript 7.0.x and vitest 4 are young majors and
   oxfmt is pre-1.0 (0.58.x, formatting may shift between minors);
   pin-and-wait is the policy if a toolchain regression appears.
8. Single-maintainer bus factor — mitigated by this file being the actual
   source of truth (kept aligned by the doc-audit habit).
9. ~~The Cloudflare Free CPU budget has never been measured IN PRODUCTION.~~
   CLOSED 2026-07-29, measured in the dashboard: over 24h, **2k invocations,
   0 errors, CPU Time 7.66 ms** against the Free cap of 10 ms per request. No
   "Exceeded CPU Time Limits" events, so the README's "Free plan is plenty" is
   correct and this drops to info.
   Two things worth keeping from the exercise. First, the method caveat was
   right: local measurements (Node + tsx, not workerd) put tools/list near
   17 ms, and real workerd averages 7.66 ms — do not size Workers decisions on
   Node numbers. Second, 7.66 ms is a MEAN, not a maximum, and it sits at 77%
   of the cap: individual heavy requests may still approach it, and Cloudflare
   allows some flexibility for infrequent overages. Re-read the counter if the
   tool surface grows or if a hot path gains work — the suggestion path got ~4x
   cheaper on 2026-07-31 (lazy search index plus a length-based early exit), so
   the margin improved rather than eroded. `limits.cpu_ms` stays unset
   deliberately: it has no effect under Free and a rejected value would fail a
   deploy.
10. tools/list costs 19 418 characters (~4 900 tokens) of FIXED context
    in every conversation, outputSchemas being ~42% of it (8 128 chars). That is
    a deliberate trade — the schemas carry real contracts locked by the golden
    fixtures — but it is paid by every session, including ones that call a
    single tool. decode_pawned_team was slimmed (3 192 -> 1 936 chars); the
    forPvp parameter then took back about half the win, and strict inputs
    (2026-08-11) added ~232 characters of `additionalProperties: false`.
    The number is now LOCKED EXACTLY by conventions.test.ts, because the
    largest single move it ever made was one nobody chose: an SDK bump added
    `"execution":{"taskSupport":"forbidden"}` to all eight tools, +312
    characters, and this entry went stale without a commit touching it. This
    debt is only trackable if a dependency cannot move it silently.
    Trigger: if a client's
    context budget ever matters, check whether that client forwards
    outputSchema to the model at all before optimising further.

## Golden tests (non-negotiable)

`packages/gw-template/test/fixtures/templates.json` contains real template codes with their expected decoded form:

```json
[
  {
    "code": "<REAL CODE FROM THE GAME>",
    "expect": {
      "primary": "Dervish",
      "secondary": "Monk",
      "attributes": { "Mysticism": 12, "Scythe Mastery": 12 },
      "skills": ["...", "...", "...", "...", "...", "...", "...", "..."]
    }
  }
]
```

<!-- TODO(maintainer): 27 fixtures exist (all professions/campaigns covered, nine
     live in-game). The three codec questions this wishlist was written to
     settle (trailing padding, zero-attribute filler, 4-vs-5-bit attribute
     width) are CLOSED as of 2026-07-16 — see "Open codec questions" above.
     If a genuinely new question arises, add it here with the same
     paste-and-re-copy protocol. -->

Any change to the codec must keep every fixture green. When a bug is found, add the failing code as a new fixture _first_, then fix.

## Game data

Source: https://github.com/build-wars/gw-skilldata. Its code is MIT, but the
skill descriptions it aggregates come from the Guild Wars community wikis
under GFDL / CC BY-NC-SA — see THIRD_PARTY_NOTICES.md, keep both notices, and
credit both in README. (The older build-wars/gw1-database SQL dumps are dead
since 2019; see Data maintenance.)

- Imported by a script into `packages/gw-data/data/*.json` (skills, professions, attributes, heroes, campaigns).
- The import script is committed and re-runnable; the generated JSON is committed too (the server must not fetch anything at runtime).
- Repository layer exposes typed lookups: `getSkillById`, `getSkillByName` (exact + case/diacritics-insensitive), `searchSkills({ profession?, attribute?, elite?, campaign?, nameContains? })`, `getHero`, `listHeroes`, `getProfession`, `listAttributes(profession)`.
- Skill names: canonical English names are the primary key. French aliases
  were WANTED but DECIDED AGAINST (2026-07-13): @buildwars/gw-skilldata ships
  English and German only (SkillLangEnglish/SkillLangGerman), and scraping the
  FR wiki is a non-goal. The passive nameDe fields on the side tables (never
  consumed by any tool) were cut at import for the same reason — no
  speculative locale data. Revisit only if a machine-readable FR source
  appears; LLM callers translate French skill names to English well anyway.

## Current status (update the date when you touch this section — stale status is worse than none; updated 2026-08-17)

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
- Suggestions: token-prefix match first, then bounded edit distance capped at 5
  (calibrated on measured distances, see the comment). Abbreviations resolve;
  French names return nothing rather than a confident wrong answer. The distance
  kernel is `fastest-levenshtein` — gw-data's first and only runtime dependency,
  taken on purpose to delete a hand-written banded matrix.
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
- Suite is 394 tests (107 / 89 / 126 / 72) as of 2026-08-17.

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

## MCP tools (MVP scope — do not add more without discussion)

| Tool                       | In                                                     | Out                                                                                                                                                                                                     |
| -------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get_skill`                | name or id                                             | full skill record, or structured not-found with close-match suggestions                                                                                                                                 |
| `search_skills`            | filters (profession, attribute, elite, campaign, text) | paginated list of skill records                                                                                                                                                                         |
| `decode_template`          | template code (line wraps tolerated)                   | build object (professions, attributes, skills)                                                                                                                                                          |
| `encode_template`          | build object                                           | template code (runs validation first; refuses on errors, returns them)                                                                                                                                  |
| `validate_build`           | build object                                           | `{ valid, errors[], warnings[] }`                                                                                                                                                                       |
| `get_hero` / `list_heroes` | name / campaign filter                                 | hero record(s): professions, campaign, how unlocked (DONE — data curated in gw-data/data/heroes.json, ids aligned with GWCA HeroID; unlock notes are coarse-grained, verify specifics against the wiki) |
| `decode_pawned_team`       | paw-ned2 team blob (`pwnd0001...>...<`)                | per-slot label/notes + each skill bar decoded by our codec (container parsed by @buildwars/gw-templates; tolerates pasted line wraps)                                                                   |

Tool design rules:

- Inputs and outputs are Zod schemas; every tool has a precise `description` written _for an LLM caller_ (state units, enums, exact expected names).
- All failures are structured JSON (`{ error: { code, message, suggestions? } }`), never bare thrown strings.
- Tools are pure/deterministic: same input → same output, no hidden state.
- When a skill name is not found, always return the 3 closest matches (Levenshtein or similar) — LLMs make small spelling errors and must be able to self-correct in one round-trip.

## Where this server is listed (updated 2026-08-14)

| Directory                    | Status                                   | Notes                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Official MCP Registry        | published                                | the source of truth other directories crawl; `publish-registry.yml` cascades on release                                                                                                                                                                                                                                                                                                                                       |
| mcp.so                       | **validated 2026-07-29**                 | https://mcp.so/servers/gw1-e2b8b9                                                                                                                                                                                                                                                                                                                                                                                             |
| Glama                        | indexed, unclaimed, healthy              | https://glama.ai/mcp/connectors/io.github.Graphmaxer/gw1-mcp — claiming needs an email at a public URL, declined, see debt #1. The single "quality A" grade is GONE: Glama now scores each TOOL with its TDQS rubric (2026-08-14: every tool A, 4.0-4.7/5). The ONLY directory that evaluates anything                                                                                                                        |
| LobeHub                      | listed, claimed, **stale**               | badge in README. Serving 0.8.2 and "Unvalidated" on 2026-08-14 — the only listing we control that shows wrong metadata                                                                                                                                                                                                                                                                                                        |
| PulseMCP                     | listed                                   | https://www.pulsemcp.com/servers/graphmaxer-gw1 — classification `community`, reads `server.json` directly. Their SEARCH did not surface it while submissions were paused mid-2026, so absence from a directory's search is not absence from the directory                                                                                                                                                                    |
| mcpmarket.com                | listed                                   | https://mcpmarket.com/server/gw1 — rate-limits fetches (429)                                                                                                                                                                                                                                                                                                                                                                  |
| Safeguard Gold               | listed, **stale at 0.3.2**               | https://gold.safeguard.sh/mcp/io.github.Graphmaxer__gw1-mcp — a security/supply-chain index. Pinned to our FIRST published version because the registry API returns versions oldest-first and their crawler takes `servers[0]`; all 15 are `status: active`. Nothing to fix our side, and their "the registry does not publish the license" note is structural — the 2025-12-11 server schema HAS no license field (verified) |
| PolicyLayer                  | listed (auto-generated)                  | https://policylayer.com/policies/gw1-mcp — an MCP-gateway vendor generating a policy page per registry entry as SEO. Reads 8 tools correctly; recommends a 60/min cap on `decode_pawned_team`, which is the same tool our own DoS work bounded, reached independently                                                                                                                                                         |
| Forge                        | `/.well-known/forge.json` served         | per-directory verification file                                                                                                                                                                                                                                                                                                                                                                                               |
| ChatGPT Plugins              | ready to submit                          | kit, generated JSON, identity verification and icons all done. Demo recorded and assembled 2026-08-05 (web + Android, one 2 min 51 file). Remaining: host the video at a login-free URL and press submit                                                                                                                                                                                                                      |
| Claude community marketplace | **submitted 2026-07-31, pending review** | validated locally (passed with the expected CLAUDE.md-at-root warning). On approval the plugin is pinned to a commit SHA in anthropics/claude-plugins-community, CI bumps the pin as commits land, and the public catalog syncs nightly, so installability lags approval                                                                                                                                                      |

Eight listings, ONE audience question. Six of the eight are crawlers of the
registry entry — they cost nothing and prove nothing, and every one of them ranks
by GitHub stars, of which there is 1. Reach is not gated on another directory; it
is gated on the two maintainer-held items (ChatGPT submission, Claude marketplace
review) and on telling actual GW1 players the thing exists. Do not read a new
crawler listing as progress.

Worth watching rather than assuming: the client-attribution dimension added the
same day means the `Connections per client` panel will show whether any of these
listings sends real clients or only health checks. Before it existed, 65% of all
traffic was one uptime monitor and the honest answer was "we cannot tell".

## Public hostname: workers.dev, decided 2026-07-29

`https://gw1-mcp.graphmaxer.workers.dev` is the permanent origin. No custom
domain: Cloudflare charges nothing for one, but it means renting a domain name
yearly for a hobby project, and the free subdomain is unremarkable for an MCP
server.

Two consequences worth knowing, because they are not obvious:

- **Directory submissions pin the origin.** The MCP server URL cannot change
  between versions of a published connector — scheme, host and port are fixed
  once listed; only the path may change. Submitting with this URL is therefore a
  commitment, which is why it was decided before submitting rather than after.
- **Do NOT rename the Worker.** The workers.dev hostname is derived from the
  Worker's name, so renaming `gw1-mcp` would silently change the origin and break
  every listing that points at it. The name is now load-bearing.

Reopen only if a custom domain is actually acquired, and note that it would mean
re-submitting to every directory rather than editing a URL.

## DoS bounds on decode_pawned_team (2026-07-31)

The blob was capped at 256 KiB and nothing else, but the container turns blob SIZE
into slot COUNT: 262 000 bytes of filler parses into 29 112 slots, each decoded and
described. One request cost **409.7 ms of CPU and a 12.9 MB response** against a 10 ms
cap. Now 1.0 ms.

- `MAX_PWND_SLOTS = 12` — a team is a player plus seven heroes. Rejecting beats
  truncating: 29 112 slots is not a team.
- `MAX_PWND_BLOB_LEN = 16384` — the old cap was **817x** a real blob (321 characters
  for four slots). Needed separately: the container parse runs before any slot count
  is known.
- `MAX_TEMPLATE_CODE_LEN = 128` on the `code` argument only. NOT on pwnd slots — the
  format encodes each field's length in one base64 character, so 63 is the structural
  maximum. A guard there was unreachable and removed; a test records why.

Found by the benchmark suite, which 313 tests could not do: nothing was wrong,
something was unbounded.

**The same class recurred twice on 2026-08-08**, so treat it as the project's
characteristic failure rather than a one-off. A guard is only as good as the unit it
counts: `bodyLimit` counted bytes on one of two equivalent PATHS (audit M1), and the
rate limiter counted HTTP REQUESTS while a JSON-RPC batch carried 3100 operations
inside one (audit N1). When adding a bound, ask what unit the attacker controls and
whether anything else in the chain counts a different one.

## get_skill violated its own output schema (fixed 2026-07-31)

`fullSkill` used `...skill`, leaking six internal join keys into a strict schema, so
`get_skill` THREW for any client that calls `tools/list` first — which is every real
client. Three reasons nothing caught it, all worth keeping:

- **Typecheck cannot**: excess-property checks do not apply to spreads.
- **The tests could not**: they called tools without listing them first, leaving the
  SDK's output validators unprimed. The bug was invisible because tests are tidier
  than clients.
- **Production could not**: the demo ran `get_skill` through Claude Code successfully,
  so client-side validation is not universal.

So: never `...skill` in `results.ts`, and the conventions test lists tools before
calling all of them, asserting coverage of `TOOL_NAMES`.

**That lock had a hole for eight days, and it was in the assertion itself**: it read
`TOOL_NAMES.length - 1`, permanently exempting `decode_pawned_team` — the one tool no
primed-client test called (audit M3, 2026-08-08). Fixed, and `fullHero` was de-spread
at the same time (audit L5): its five keys lined up exactly today, but `heroes.json` is
regenerated weekly, so the next new overlay field would have re-run this postmortem
verbatim. Two lessons compound here: a completeness assertion with an arithmetic escape
hatch is not a completeness assertion, and "the keys happen to match" is not a contract.
The same test now also asserts every tool REJECTS an undeclared argument.

## workerd runs locally, and there are no compatibility flags

`pnpm --filter @gw1-mcp/gw-worker exec wrangler dev --local` starts the REAL workerd.
Use it: any claim hedged with "measured under Node" can be checked properly, and the
gap has been material twice — `tools/list` measured ~17 ms under Node against 7.66 ms
in production, and an async benchmark reported 221 ms for the same call.

**The rate limiter IS emulated locally**, contrary to what this section said until
2026-08-11: 120 sequential POSTs to a fresh `wrangler dev --local` returned 94x 200 and
26x 429, which is the 100/min binding doing its job. Worth knowing in both directions —
the limiter can be exercised for real, and a probe loop of more than 100 requests will
start getting 429s that look like a bug in whatever is being tested (it cost one
confusing measurement). Analytics Engine remains the binding that is not exercised.

Reading response codes off real workerd also caught something the unit suite did not:
the batch middleware answered 400 for a `text/plain` body starting with "[", where the
transport answers 415. A middleware that inspects the BODY has to respect the
content-type contract of the layer below it.

`nodejs_compat` was removed 2026-07-31 after proving it did nothing: the bundle has no
`node:` specifier, no unenv polyfill and no Node global (the only matches are
`$ZodPreprocess` and Web-standard `arrayBuffer`), it is byte-identical with and without
the flag, and every route and tool answers under real workerd without it.

Removing it is a guardrail, not tidiness: with the flag, a dependency that quietly
needs a Node API is silently polyfilled by unenv and fails later at the call site.
Without it, it fails to resolve at build time. If something legitimately needs Node
APIs, add the flag back deliberately — `nodejs_als` exists if only AsyncLocalStorage
is wanted.

## createServer() runs on every /mcp request (halved 2026-07-31)

Unavoidable: the SDK refuses to reuse a server across transports ("Already connected
to a transport"), for sequential AND concurrent, and `close()` cannot be called here —
it empties every response, since the body is lazy (see the B6 note in the worker).
Tested, not assumed.

|                                          | before       | after       |
| ---------------------------------------- | ------------ | ----------- |
| inside `registerTool`/`registerResource` | 2.70 ms      | 1.51 ms     |
| building the argument literals (zod)     | ~2.02 ms     | ~0 ms       |
| **`createServer()`**                     | **5.37 ms**  | **1.89 ms** |
| **full `tools/list` request**            | **18.68 ms** | **6.91 ms** |

Two changes, both free of concurrency risk because zod schemas are immutable values:
per-tool schema literals live at module scope, and the `z.object` wrappers are
pre-built (the SDK rebuilt all sixteen per request via `objectFromShape`). Zero `z.`
calls remain inside the function body — keep it that way. Each chained zod method
CLONES the schema, which is why one `z.string().max(64).describe(...)` costs 0.147 ms.

"Zero `z.` calls in the function body" was ASPIRATIONAL until 2026-08-11: three input
shapes (search_skills, decode_template, decode_pawned_team) were still inline and paid
the per-request cost this section says was removed. They are at module scope now, so
the sentence is literally true — check it rather than trusting it when adding a tool.

Verified byte-identical at the time: `tools/list` was 18 577 characters, and strictness
survives — an extra property in a structured result is still rejected. It went to 18 809
when inputs became `.strict()` (see the third-audit entry in the debt register), and is
**19 418 today, LOCKED by a test** — `conventions.test.ts` asserts the exact character
count and fails on any movement in either direction.

The lock exists because of how the number drifted. Between 18 809 and the audit of
2026-08-17 it had reached 19 358, and 312 of those 549 characters were the SDK newly
emitting `"execution":{"taskSupport":"forbidden"}` on each of the eight tools. Nobody
decided that; it arrived with a version bump. This file measures the number carefully
whenever WE change the tool surface and not at all when a dependency does, so the one
direction the process could not see was the one that moved. An upper bound would not
have helped — it passes silently until it does not, the same "green means nothing
happened" trap the weekly data job fell into twice. Exact equality is the point: when
it fails, either you changed the surface (update the constant and this figure in the
same commit, as the failure message says) or something upstream did, and you want to
know which. The remaining 60 characters are decode_template's description gaining its
whitespace-tolerance sentence, in the same change that added the lock.

## Workflow: push straight to main

Deliberate, not sloppiness. Single maintainer, hobby project; the PR round trip buys
little. What matters is knowing where the real gate is:

- **Production is gated by the Cloudflare build**, whose command is
  `pnpm -r typecheck && pnpm -r test`. The deploy step runs only if that passes, so a
  broken commit never reaches the Worker.
- **lint, fmt, knip and CodeQL run afterwards** in GitHub CI. None of them can break
  a running service, so arriving late is acceptable — but they do mean main can sit
  red on style or dead code while production is fine.
- `codecov/patch` is restricted to pull requests, because it exists to stop
  under-tested code from landing and cannot do that on a push where the code is
  already there. `codecov/project` still runs on every commit with a 1% threshold.

If that changes — a second contributor, or anything with a rollback cost — the
Cloudflare build command is the thing to widen first, not the branch policy.

## What the production dashboard says (2026-07-31)

- **Traffic is entirely automated.** `clientInfo` names 15 callers on `initialize`,
  none of them human. `glimind-probe` alone is 63% of connections, matching the 65%
  the user-agents showed independently. The 95% "protocol overhead" is that, not a
  mystery.
- **The French alias table (J1 path 3) is closed as NO.** 198 resolved lookups against
  2 missed, and both misses are most likely our own probes.
- **`ATTRIBUTE_POINTS_EXCEEDED` was the top validation failure, and the cause was
  ours**: `RANK_COST` lived only in `validate.ts`, and the costs are non-linear (rank
  12 costs 97, so 12/12 spends 194 of 200 and three lines at 12 is impossible). The
  table is now in the error message and the bundled skill. Neither adds fixed context.

Caveat: the skill and hero rankings are dominated by our own testing and say nothing
about users yet. Their panel descriptions say so.

## Game rules: see docs/game-rules-provenance.md

Every validator rule, where it comes from, and how sure we are: **12 of 24 verified
against primary sources, 3 partial, 0 unverified, 9 that are not game rules.** Each
rule cites its source in `validate.ts`.

Two defects were found on 2026-07-31 by checking sources instead of reading code, and
both are recorded there: `PVE_ONLY_ON_PVP_BUILD` was missing (54 PvE-only skills carry
no profession, so they passed every other check, and `encode_template` would produce a
valid code for an illegal PvP bar), and the three-skill PvE cap wrongly excluded
Signet of Capture.

**Settled in game 2026-08-01, and both split-version rules were wrong.** A PvP-only
Mesmer's own template (`OQBDAowjCXoyJEhyEaIA`) stores Fragility as id 19 and Empathy as
26 — the PvE versions. The client normalises when writing, on a PvP character, under
Reforged. So `PVE_VERSION_ON_PVP_BUILD` rejected the normal case for all 156 split
skills and is deleted, and `PVP_VERSION_ON_PVE_BUILD` became a warning independent of
`forPvp`. That template is now a fixture. Primary evidence outranked a 2009 comment and
a second model that agreed with it.

## Method note

Three of my four initial "gaps" were my own bad fixtures — a wrong attribute name, a
skill that does not exist, a Ranger skill on a Dervish bar. And the two real defects
came out only after checking sources, not after reading code. Reading the
implementation cannot tell you the rule is wrong; it can only tell you the code does
what it says.

## Repository layout

Eighteen files at the root, **twelve of them mandated by a tool that looks there**:
`package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `tsconfig.base.json`,
`server.json` (the MCP Registry requires the root), `LICENSE`, `README.md`,
`CHANGELOG.md` (release-please writes it), `CLAUDE.md` (Claude Code looks there),
`knip.json`, `codecov.yml` and `release-please-config.json`.

The other six are a deliberate choice, not drift. `CONTRIBUTING.md`,
`CODE_OF_CONDUCT.md` and `SECURITY.md` are recognised by GitHub in `.github/` or
`docs/` too, and moving them would trim the root by three — **not worth it**: the root
is where a visitor looks, and a security policy that is harder to find is worse than a
tidy listing. `THIRD_PARTY_NOTICES.md` stays for the same reason, and
`chatgpt-app-submission.json` is generated at the root by the submission skill's own
contract and uploaded as-is.

**One genuine question mark: `glama.json`.** It declares
`{"maintainers": ["Graphmaxer"]}` and nothing in this repository references it. Its
purpose was Glama-side maintainer attribution, and the Glama account was deleted when
we declined the email-in-a-public-file verification — while the listing stayed live and
quality A, because Glama indexes from the MCP Registry. So the file may now be inert.
It is kept because it carries no email and no risk, and deleting it on a guess could
silently drop maintainer attribution from a listing that currently works. Do not treat
its presence as evidence that it does anything.

Directories: `packages/` (four workspaces), `gwtoolbox-plugin/` (the C++ export
plugin), `skills/`, `assets/`, `docs/`, `grafana/`, `types/`, `LICENSES/`,
`.github/`, `.githooks/`.

## CodSpeed: the createApp benchmark is the noise floor

On 2026-08-01 CodSpeed failed a commit with a **16% regression on `createApp`**. The commit
changed one error-message string and some comments — code that benchmark never executes.
It was a false positive, and four things said so: CodSpeed's own "different runtime
environments" warning, a diff touching no executed path, every other benchmark drifting the
same direction (-3%, -1%) which is systematic rather than targeted, and `createApp` being
the smallest benchmark in the suite at roughly 1 ms.

Worth knowing what it measures, because the name oversells it: `createServer` is called
INSIDE the /mcp handler, not in `createApp`, so this covers route registration only —
0.07 ms against 2.0 ms locally, about **3.5% of real startup**. The number to watch for
isolate cost is `createServer`, which has its own benchmark.

**When it goes red**: check whether the whole run drifted, and look at `createServer`,
before believing route registration got slower. It was deliberately NOT deleted — removing
a benchmark because it flagged is how a suite stops being trusted — but its docblock now
says what it can and cannot tell you.

If this recurs often enough to be noise, the right fix is a CodSpeed threshold in the
dashboard, not a smaller suite.

## Explicit non-goals for the MVP

- ❌ `complete_build` / `generate_build` from tags or roles — this reintroduces the hard problem; the LLM proposes the 8 skills.
- ❌ Storing or reproducing GWPvX build pages, guides, or strategy content (community-authored, licensing concerns). Game data only.
- ❌ Rune/equipment templates (only skill templates for now).
- ❌ Any AI/LLM call inside the server. Hosting cost must stay ~0.
- ❌ Auth, accounts, persistence.

## Later milestones (context, not current work)

1. ~~MCP `resources`~~ — gw1://guide/build-workflow, gw1://meta and gw1://heroes
   are live. **Mission threat summaries: DECLINED 2026-07-29.** It is the non-goal,
   not an exception to it — a threat summary is an interpretation of a mission, so
   strategy content. And it is the one place the wiki copyleft would actually bite:
   skill descriptions are transcribed in-game strings, but threat summaries have no
   in-game equivalent and exist only as editors' own prose, which those licences
   unambiguously cover. Importing them would move the project from "arguable" to
   "clearly carrying copyleft obligations", voluntarily. Reopen only for an
   openly-licensed mission dataset — not by transcribing wiki articles.
2. `heroes_from_progression` tool — **DECLINED 2026-07-29.** Not a difficulty
   problem: the data does not exist. The 31 unlock notes are prose with no quest or
   mission identifiers and at least one branching condition (Master of Whispers is
   exclusive with Margrid); making them decidable means a quests/missions dataset,
   which is the guide-database non-goal; and the export plugin carries
   `unlockedAccountSkills` and no progression state, so the input would be the
   player's prose anyway — which is what an LLM already handles well from the notes.
   Reopen only if the plugin gains real quest/mission state, or an upstream dataset
   exposes unlock conditions structurally.
3. Cloudflare Workers deployment + custom connector on claude.ai; then Anthropic connectors directory submission.
4. ~~GWToolbox export plugin~~ — written in gwtoolbox-plugin/AccountExport; needs first Windows build, then consider upstreaming as a PR to GWToolbox's Completion window.

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
- Attribute id conventions follow upstream: 0-44 are template attributes;
  101 = No Attribute; 102-109 = PvE title tracks (NOT templatable). Skills
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
  restoring the run #20 line and watching it fail. Consequence worth knowing: while provenance reads `npm:`,
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
- Pages also serves combined JSON, paw-ned2 CSVs, and per-skill JSON at
  /json/skills/[SKILL_ID].json should a lightweight runtime lookup ever be
  wanted. npm release may lag the Pages/tip by a release.
- Skill ids/names/professions/attributes/elite flags are stable across
  balance patches — the codec and validator never go stale; only stats and
  descriptions move, and the upstream now keeps those fresh too.

## Naming conventions (decided 2026-07-13, after an external naming review)

- Lookups: `getXById` / `getXByName` — both suffixes WHEN both siblings
  exist (the bare forms were renamed for the five entities that have a
  ByName twin). A sole lookup keeps the bare form: `getSkillType` has no
  ByName sibling, so a suffix would disambiguate nothing.
- Boolean fields: NEW fields take the `is`/`has` prefix unless the bare name
  reads as an adjective (`elite`). The existing mixed trio (`elite`,
  `pvpSplit`, `isPvpVersion`) is FROZEN: these ship in public tool output and
  the server is live on the registry — renaming them is a breaking change
  with zero upside.
- Package prefix: `@gw1-mcp/gw-*` stays, DECIDED 2026-07-14. The double
  prefix looks redundant but is load-bearing: dropping it yields
  `packages/data/data/skills.json` (the data package contains a data/
  folder), makes `template` ambiguous (GW1 templates vs code templates),
  breaks the greppability of gw-* paths, and would break the Cloudflare
  Workers Builds root-directory setting (dash-side, debt #1) until manually
  re-pointed — all for three saved characters. Three external audits rated
  it cost > gain before the data/data collision was even noticed.
- Error-code taxonomy (also frozen, rule now explicit): `UNKNOWN_X` = an
  input the server failed to RESOLVE while interpreting a request (bad name,
  bad filter value — usually carries suggestions); `NOT_FOUND` = a direct
  entity lookup that missed. Same LLM-visible outcome, two codes on purpose:
  the first names WHICH input was bad, which matters on multi-input tools.

## Tool error policy (isError)

isError marks a TOTAL call failure — nothing usable was produced: bad
request, unparseable input, requested entity not found (jsonError, which
carries suggestions when available). Per-item errors inside a larger result
(e.g. one hero of a decoded team) and requested reports (validate_build
verdicts, encode_template rule violations) are normal content WITHOUT
isError. All five error sites follow this; keep new tools aligned.

## Working style for Claude Code sessions

- Small, reviewable increments; one milestone per session.
- Before touching the codec, read the fixtures and the verification layers above.
- Never modify golden fixtures to make tests pass — fixtures are ground truth from the game.
- If a game rule seems ambiguous, check the Guild Wars Wiki and leave a link in a comment rather than assuming.
