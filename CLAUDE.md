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

## Architecture

pnpm monorepo, TypeScript everywhere.

```
gw1-mcp/
├── CLAUDE.md              ← you are here
├── packages/
│   ├── gw-data/           ← game data (JSON from build-wars/gw1-database) + repository layer
│   ├── gw-template/       ← template code codec (encode/decode) — ZERO dependencies, pure functions
│   └── gw-mcp/            ← MCP server exposing tools; depends on gw-data + gw-template
└── (later, separate repo) gwtoolbox-plugin (C++, out of scope here)
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
6. No duplicate skills on one bar.
7. Warnings (not errors) for things like: PvE-only skills on a hero bar (heroes cannot use most PvE-only skills), skills from a campaign the player may not own.

Distinguish `errors` (build cannot exist / template cannot be generated) from `warnings` (build is encodable but suspicious). Always return both lists.

## Template code format — source of truth

The codec in `packages/gw-template` is implemented and round-trip tested. Do **not** change the bitstream layout from memory. The authoritative references are, in order:

1. The golden test fixtures (below) — real codes; extend them, never edit them.
2. The verification corpus itself — 18 golden fixtures from four independent
   encoders (the pre-2007 game client, PvXCode, @buildwars/gw-templates, a
   GWW player page), differential + fuzz + malformed-input tests. The maintainer's
   historical Python codec, once planned as a reference oracle under
   reference/, is no longer needed for correctness; welcome as an optional
   extra cross-check if it ever surfaces.
3. Guild Wars Wiki: https://wiki.guildwars.com/wiki/Skill_template_format

The codec must be perfectly **round-trip stable**: `encode(decode(code)) === code` for every fixture, and `decode(encode(build))` deep-equals `build`.

## Codec verification layers

1. Golden fixtures (below) — game/PvX-generated codes, character-exact.
2. Round-trip fuzz (2000 random builds).
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

## Open codec questions only in-game codes can settle

1. Zero-attribute bars: which filler value the game writes in the unused
   attribute bit-length field.
2. Attribute width floor: with all attribute ids < 16 (e.g. any Mesmer
   FC/Dom/Insp bar), does the game emit the spec-minimal 4 bits or pad to 5
   like PvXCode and @buildwars/gw-templates do (shared authorship)? Our
   encoder emits the minimum; both forms decode identically everywhere.
   Corpus coverage (18 fixtures): ALL 10 primary professions, 8 secondaries, skills from all 5 campaigns (Core, Prophecies,
   Factions, Nightfall, EotN), all 64 charset chars exercised ('+' and '/'
   included), both header formats, sorted and unsorted attribute orders, three
   independent third-party encoders (the game pre-2007, PvXCode, and
   @buildwars/gw-templates via gw1builds.com whose icon URLs expose skill IDS
   for id-level verification, plus a GWW player page whose Ranger codes are
   byte-identical to our encoding except one trailing zero-padding char).
   Fixture wishlist from the maintainer's game client (each arbitrates one open question):
   one bar with no attributes (unused width-field filler), one bar with all
   attribute ids < 16 (4-vs-5-bit attribute width), and ANY bar at all (exact
   trailing-padding convention: we pad to 6 bits; the Catbus source emits one
   extra zero group; compare code LENGTH char-for-char).

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
(packages/gw-data/data/**, gw-template test fixtures) — formatting them
would fight the scripts that emit them and pollute every weekly data PR.
Keep that list in sync when adding generated outputs.

## Coverage expectations

`pnpm test:coverage` (provider @vitest/coverage-v8, version-locked to the
workspace vitest). Reference levels (vitest 4 measurement): gw-template
~92% (uncovered: internal-bug guards in bitstream/base64 unreachable from
valid inputs), gw-data src ~93% (scripts/import.ts intentionally untested
— validated by upstream schemas at run time and golden tests downstream),
gw-mcp ~93% with validate.ts and build-io.ts at 100% lines and server.ts
~87% (every tool exercised through InMemoryTransport incl. error paths;
remainder is response-formatting branches), gw-worker app.ts 100%
(index/node/stdio are entry-point shims). Every validator rule and
resolution error code MUST have a test that triggers it — and this rule is
MECHANICALLY ENFORCED by test/conventions.test.ts in gw-mcp, which scans
the src for `code: "..."` declarations and fails if any code never appears
in the test corpus. Tool failures use
the MCP isError flag via the jsonError helper — keep new tools consistent.

## Releasing

Single SemVer version for the whole repo (root package.json + server.json,
kept in sync by release-please's extra-files updater; sub-packages are
private and unversioned in practice). Flow: conventional commits on main →
release-please maintains a release PR → merging it creates the tag, the
GitHub release and the CHANGELOG entry → the release event triggers
publish-registry.yml which pushes the new version to the MCP Registry via
OIDC. Nothing manual beyond merging the PR.

## Internal conventions (uniform on purpose)

- Sub-packages are all `"private": true` — @gw1-mcp/* must never reach npm.
- ONE script archetype, and it covers entry shims too (stdio.ts, worker
  node.ts): every executable wraps its flow in main() behind an
  `isDirectRun` guard — importing a module must never trigger I/O
  (network, files, ports, stdin). Two deliberate non-violations: pure
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
  curated original knowledge (heroes-meta.json) or a deliberately dated test
  snapshot (fixtures).

## Known debts and risks (the honest register)

Everything below is a KNOWN compromise, kept deliberately, with its trigger
for action. Nothing else in the repo is knowingly imperfect.

1. Deployment is LIVE and verified (2026-07-11): Cloudflare Workers Builds
   deploys every push to main to https://gw1-mcp.graphmaxer.workers.dev
   (first production tool calls served the same day). Residual debt: the
   build settings live in the Cloudflare dash, NOT in the repo — Root
   directory `packages/gw-worker`, Build command `pnpm -r test` (never
   deploy red). If the worker ever redeploys wrong from a fresh setup,
   re-apply those two settings first. GitHub CI and Workers Builds both run
   the test suite per push — deliberate redundancy (PR signal vs deploy
   gate).
2. The C++ plugin compiled clean on the first CI run (/W4 /WX, zero
   warnings — 2026-07-11) but has never been loaded in-game. Trigger:
   the maintainer runs /exportaccount with the artifact DLL.
3. Three open codec questions (trailing-padding convention, zero-attribute
   filler, 4-vs-5-bit attribute width) — arbitrable only by in-game codes;
   the encoder is correct for the game's decoder either way.
4. Runtime dependency @buildwars/gw-templates has a known truncation bug
   (docs/upstream-gw-templates-bug.md, report ready to file). Our sentinel
   test pins the buggy behavior: when upstream fixes it, the sentinel FAILS
   on purpose — update the sentinel and delete this line.
5. heroes.json is GENERATED (scripts/import-heroes.ts): ids/names are
   derived at import time from the GWCA HeroID enum (vendored in GWToolboxpp
   — the standalone gwdevhub/GWCA repo 404s since ~2026, the vendored copy
   IS the living source, and it gains new Reforged heroes within days).
   Never edit heroes.json by hand. The only curated file is
   data/heroes-meta.json (professionId/campaignId/unlock — knowledge that
   exists in no machine-readable source). The weekly workflow regenerates;
   a new upstream hero makes the run fail listing the identifiers to add to
   the overlay, then the regenerated hero rides the weekly PR. Trigger:
   that failing run; curate the metadata from GWW.
6. The worker URL is now public DE FACTO (public repo + guessable
   workers.dev name) with no auth and no rate limiting. Accepted: worst
   case is free-tier quota burn (100k req/day) — the server holds no
   secrets and mutates nothing. Trigger: unusual traffic in the Cloudflare
   analytics, or wanting to share the URL deliberately → add a Cloudflare
   WAF rate-limiting rule or a bearer check in app.ts.
7. Early-adopter stack: TypeScript 7.0.x and vitest 4 are young majors and
   oxfmt is pre-1.0 (0.58.x, formatting may shift between minors);
   pin-and-wait is the policy if a toolchain regression appears.
8. Single-maintainer bus factor — mitigated by this file being the actual
   source of truth (kept aligned by the doc-audit habit).

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

<!-- TODO(maintainer): paste here 10-15 real codes from live Nightfall builds (player + heroes),
     dont au moins : un build avec slot vide, un build sans élite, un build sans secondaire,
     un build de héros avec skills de plusieurs campagnes. -->

Any change to the codec must keep every fixture green. When a bug is found, add the failing code as a new fixture _first_, then fix.

## Game data

Source: https://github.com/build-wars/gw1-database (MIT — keep the license notice, credit in README).

- Imported by a script into `packages/gw-data/data/*.json` (skills, professions, attributes, heroes, campaigns).
- The import script is committed and re-runnable; the generated JSON is committed too (the server must not fetch anything at runtime).
- Repository layer exposes typed lookups: `getSkillById`, `getSkillByName` (exact + case/diacritics-insensitive), `searchSkills({ profession?, attribute?, elite?, campaign?, nameContains? })`, `getHero`, `listHeroes`, `getProfession`, `listAttributes(profession)`.
- Skill names: canonical English names are the primary key; keep French localized names as an alias field if available in the source data (users will often ask in French).

## Current status (updated 2026-07-11)

Milestones 0-4 are DONE: monorepo builds, codec implemented (round-trip,
golden-fixture, and differentially tested — see Codec verification layers),
gw-skilldata imported (1485 skills, Reforged-current),
MCP server with 8 tools passing end-to-end tests over InMemoryTransport,
and a stateless Streamable HTTP transport (packages/gw-worker, Hono) that
runs identically on Node and Cloudflare Workers (wrangler dry-run: 234 KB gzip).
The GWToolbox export plugin (gwtoolbox-plugin/AccountExport, C++/Win32) is WRITTEN
against the real GWCA headers but NOT YET COMPILED — it must be built on
Windows inside a GWToolboxpp checkout (see gwtoolbox-plugin/README.md).
validate_build/encode_template accept `unlockedSkillIds` from its export.
Fixture set now includes two PvXwiki codes independently verified against the
pages' declared professions/attributes/skills (character-exact round-trips,
including '+' charset chars and EotN skill ids). the maintainer's in-game codes remain
wanted as the final confirmation layer.
NEXT: golden fixtures from real gameplay (needs the maintainer's in-game codes),
first real deployment (`wrangler login && pnpm --filter @gw1-mcp/gw-worker deploy`),
first Windows build of the AccountExport plugin, then MCP resources (gw1://roles,
hero constraints) and heroes_from_progression.

## MCP tools (MVP scope — do not add more without discussion)

| Tool                       | In                                                     | Out                                                                                                                                                                                                     |
| -------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get_skill`                | name or id                                             | full skill record, or structured not-found with close-match suggestions                                                                                                                                 |
| `search_skills`            | filters (profession, attribute, elite, campaign, text) | paginated list of skill records                                                                                                                                                                         |
| `decode_template`          | template code                                          | build object (professions, attributes, skills)                                                                                                                                                          |
| `encode_template`          | build object                                           | template code (runs validation first; refuses on errors, returns them)                                                                                                                                  |
| `validate_build`           | build object                                           | `{ valid, errors[], warnings[] }`                                                                                                                                                                       |
| `get_hero` / `list_heroes` | name / campaign filter                                 | hero record(s): professions, campaign, how unlocked (DONE — data curated in gw-data/data/heroes.json, ids aligned with GWCA HeroID; unlock notes are coarse-grained, verify specifics against the wiki) |
| `decode_pawned_team`       | paw-ned2 team blob (`pwnd0001...>...<`)                | per-slot label/notes + each skill bar decoded by our codec (container parsed by @buildwars/gw-templates; tolerates pasted line wraps)                                                                   |

Tool design rules:

- Inputs and outputs are Zod schemas; every tool has a precise `description` written _for an LLM caller_ (state units, enums, exact expected names).
- All failures are structured JSON (`{ error: { code, message, suggestions? } }`), never bare thrown strings.
- Tools are pure/deterministic: same input → same output, no hidden state.
- When a skill name is not found, always return the 3 closest matches (Levenshtein or similar) — LLMs make small spelling errors and must be able to self-correct in one round-trip.

## Explicit non-goals for the MVP

- ❌ `complete_build` / `generate_build` from tags or roles — this reintroduces the hard problem; the LLM proposes the 8 skills.
- ❌ Storing or reproducing GWPvX build pages, guides, or strategy content (community-authored, licensing concerns). Game data only.
- ❌ Rune/equipment templates (only skill templates for now).
- ❌ Any AI/LLM call inside the server. Hosting cost must stay ~0.
- ❌ Auth, accounts, persistence.

## Later milestones (context, not current work)

1. ~~MCP `resources`~~ — gw1://guide/build-workflow and gw1://heroes are live; mission threat summaries still to do.
2. `heroes_from_progression` tool: compute available heroes deterministically from campaign progress.
3. Cloudflare Workers deployment + custom connector on claude.ai; then Anthropic connectors directory submission.
4. ~~GWToolbox export plugin~~ — written in gwtoolbox-plugin/AccountExport; needs first Windows build, then consider upstreaming as a PR to GWToolbox's Completion window.

## Data maintenance & Reforged

- Upstream: build-wars/gw-skilldata (MIT, npm @buildwars/gw-skilldata) —
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
- Pages also serves combined JSON, paw-ned2 CSVs, and per-skill JSON at
  /json/skills/[SKILL_ID].json should a lightweight runtime lookup ever be
  wanted. npm release may lag the Pages/tip by a release.
- Skill ids/names/professions/attributes/elite flags are stable across
  balance patches — the codec and validator never go stale; only stats and
  descriptions move, and the upstream now keeps those fresh too.

## Conventions

- Conventional commits (`feat:`, `fix:`, `test:`, `chore:`…).
- Every package typechecks and tests independently: `pnpm -r typecheck && pnpm -r test` must pass from a clean clone (nothing is ever built to dist; exports point at .ts sources, and the worker bundles via wrangler).
- Public functions get TSDoc; keep comments about _why_, not _what_.
- CI: GitHub Actions running lint + build + tests on every PR.
- Language: code, identifiers, docs and commits in **English** (public OSS repo); it's fine to discuss in French in issues/PRs.

## Working style for Claude Code sessions

- Small, reviewable increments; one milestone per session.
- Before touching the codec, read the fixtures and the verification layers above.
- Never modify golden fixtures to make tests pass — fixtures are ground truth from the game.
- If a game rule seems ambiguous, check the Guild Wars Wiki and leave a link in a comment rather than assuming.
