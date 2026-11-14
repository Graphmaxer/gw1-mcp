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

## Where the rest lives

This file is the RULES IN FORCE. The reasoning, the history and the measurements
behind them are in `docs/handbook/` — read the relevant one before changing what
it covers, because most of these rules exist for a reason that is not obvious
from the code.

| File                             | Read it before                                                                 |
| -------------------------------- | ------------------------------------------------------------------------------ |
| `docs/handbook/debts.md`         | calling something a bug: it may be a known, deliberate compromise              |
| `docs/handbook/releasing.md`     | touching a workflow, a pin, a credential or `_meta.json`                       |
| `docs/handbook/data-pipeline.md` | touching `update-data.yml`, `scripts/import*` or the French names              |
| `docs/handbook/runtime.md`       | touching `/mcp`, `createServer`, a bound, or reading a CodSpeed report         |
| `docs/handbook/conventions.md`   | adding a script, a field name, a tsconfig option or a root file                |
| `docs/handbook/decisions.md`     | proposing a tool, a domain, a directory listing or a codec change              |
| `docs/handbook/audits.md`        | starting an audit: six have run, and their findings and non-findings are there |
| `docs/game-rules-provenance.md`  | touching a validator rule: each one cites its source                           |

A new dated narrative (an incident, an audit, a measurement) goes in the handbook,
not here. Add a line here only if it changes what someone must DO.

## Commands

```bash
pnpm install                      # Node >= 22.18 (or 24), pnpm 12
pnpm -r typecheck && pnpm -r test # must pass from a clean clone
pnpm lint && pnpm fmt             # oxlint / oxfmt (CI runs fmt:check)
pnpm test:coverage                # reference levels: see Coverage section
pnpm bench                        # vitest bench in every package (see Performance)
pnpm --filter @gw1-mcp/gw-worker smoke      # 22 HTTP checks against real workerd
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

## MCP tools (MVP scope — do not add more without discussion)

| Tool                       | In                                                     | Out                                                                                                                                                                                                     |
| -------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get_skill`                | name (English or official French) or id                | full skill record, or structured not-found with close-match suggestions                                                                                                                                 |
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

## Tool error policy (isError)

isError marks a TOTAL call failure — nothing usable was produced: bad
request, unparseable input, requested entity not found (jsonError, which
carries suggestions when available). Per-item errors inside a larger result
(e.g. one hero of a decoded team) and requested reports (validate_build
verdicts, encode_template rule violations) are normal content WITHOUT
isError. All five error sites follow this; keep new tools aligned.

## Load-bearing rules

Each of these has been broken once and cost something. The handbook has the story;
this is the rule.

**Tools and contract**

- Tool INPUTS are `.strict()`: an undeclared argument is an error naming the key.
- Zod schemas live at MODULE scope (`schemas.ts`). Zero `z.` calls inside
  `createServer` or a `tools/` register function: both run on every `/mcp` request.
- One file per tool in `gw-mcp/src/tools/`; `server.ts` and the worker's `app.ts`
  only assemble, and the ORDER they register things in is part of the contract
  (`tools/list` order, guard order). A handler or guard added inline is a regression.
- Never spread a record into a result (`...skill`, `...hero`) in `results.ts`:
  output schemas are strict and a spread leaks internal keys. Enumerate fields.
- Tests call tools through a PRIMED client (`tools/list` first), or the SDK's
  output validators are not armed and schema violations pass.
- `tools/list` is locked to an exact character count by `conventions.test.ts`
  (debt #10). If it moves, find out whether you or a dependency moved it, then
  update the constant and `docs/handbook/debts.md` in the same commit.
- A caveat an LLM must see goes in the PARAMETER description. Server
  `instructions` are not forwarded by many clients.
- Prose that describes a rule (a description, the bundled skill) is not locked to
  the rule. When a validator rule changes, grep for its description.

**HTTP surface**

- Anything registered on `/mcp` uses `useOnMcp()`, so `/mcp` and `/mcp/` cannot
  drift apart.
- No `server.close()` in the `/mcp` handler: the response body is lazy and closing
  empties it.
- JSON-RPC batches are refused. A middleware that reads the body gates on
  `isJsonRequest`, so it never acts on a request the transport will answer 415 to.
- When adding a bound, ask what unit the attacker controls and whether anything
  else in the chain counts a different one (bytes vs slots, requests vs
  operations). That mismatch is this project's characteristic failure.
- No `nodejs_compat` flag, on purpose: a dependency needing a Node API must fail
  at build time, not be polyfilled.
- Do not rename the Worker: the public hostname derives from its name and every
  directory listing pins it.

**Data and automation**

- Generated files (`packages/gw-data/data/*.json` except `heroes-overlay.json`,
  the hero header) are never edited by hand. Every generated artifact has a
  generator, a key in `_meta.json`, and a refresh path.
- The weekly job's `open-pr` half holds write access and must never install
  dependencies or execute anything the import job produced. The patch it receives
  is attacker-controlled input and is applied through an allowlist.
- A generated output must be added to the patch path list AND the allowlist in
  `update-data.yml`; the unit tests cannot see that boundary.
- For a scheduled job, a green run is not evidence it worked. Check what it did.
- Attribute ids are OURS and frozen (0-44 template attributes, 101 no attribute,
  102-109 title tracks); the import maps upstream's ids back onto them.
- English skill names are the primary key. French names add a way to reach a
  skill and never change which skill an English name reaches.

**Dependencies and CI**

- No `overrides` in `pnpm-workspace.yaml`. Fix a transitive advisory in the
  lockfile (`pnpm update -r --depth Infinity <pkg>`); add an override only when a
  parent's declared range cannot reach the fix, and delete it when it can.
- Third-party actions are pinned by full commit SHA. Manual pins live in
  `.github/pins.env`, never in a workflow file.
- A pnpm bump touches `packageManager` AND `pnpm-lock.yaml` (pnpm 12 pins itself
  there): run a plain `pnpm install` once after editing the field.
- A dependency-driven change to a locked number is accepted by showing the delta
  is cosmetic, never by re-baselining because CI is red.
- A scratch copy of the repo needs its OWN `node_modules`: a symlinked one lets
  pnpm repoint the real workspace links.
- CodSpeed's `createApp` benchmark is the noise floor. When it goes red, check
  whether the diff touches route registration before believing it.

**Method**

- Check the harness before believing the harness: most false findings here came
  from a wrong probe, not a wrong server.
- Reading the implementation tells you the code does what it says, not that the
  rule is right. Game rules are settled by sources and in-game evidence.
- Coverage counts lines executed, not claims checked. A filter test asserts the
  exact result set against the data, not that one expected name appears.

## Conventions

Full text and reasons: `docs/handbook/conventions.md`.

- Conventional commits, one type per prefix (`feat > fix > the rest`); never
  concatenate types, release-please silently drops what it cannot parse.
- Code, identifiers, docs and commits in English. French is fine in discussions.
- Public functions get TSDoc; comments explain why, not what.
- ONE script archetype: every executable wraps its flow in `main()` behind an
  `isDirectRun` guard, so importing a module never triggers I/O.
- ONE script runtime: everything under `scripts/` runs on bare `node` (type
  stripping), with `.ts` specifiers between siblings. `src/` keeps `.js`.
- Lookups are `getXById` / `getXByName` when both exist. New boolean fields take
  `is`/`has`. `elite`, `pvpSplit`, `isPvpVersion` and every error code are FROZEN:
  they ship in public tool output.
- `UNKNOWN_X` is an input the server could not resolve (usually with
  suggestions); `NOT_FOUND` is a direct lookup that missed.
- Sub-packages are `"private": true` and keep the `@gw1-mcp/gw-*` names.
- Generated data files are `JSON.stringify(data, null, 1)` plus a newline, and
  are listed in `.oxfmtrc.json` so the formatter leaves them alone.
- Every validator rule and resolution error code has a test that triggers it
  (enforced by `conventions.test.ts`).
- Single maintainer, push to main is allowed; production is gated by the
  Cloudflare build (`pnpm -r typecheck && pnpm -r test`).

## Known debts (index)

Deliberate compromises, each with its trigger. Full reasoning in
`docs/handbook/debts.md`; nothing else in the repo is knowingly imperfect.

1. Cloudflare build settings, bindings and tokens live in the dashboard, not in
   the repo. When a Workers Build fails, read the Cloudflare log first.
2. ~~Plugin never loaded in game~~ closed 2026-07-16.
3. ~~Open codec questions~~ closed 2026-07-16: none left.
4. `@buildwars/gw-templates` has a known encode-side truncation bug. Verified not
   exposed (we only decode, through `PwndTemplate`); a sentinel test will fail on
   purpose when upstream fixes it.
5. `heroes.json` is generated from the GWCA enum plus a curated overlay; a new
   upstream hero fails the weekly run until the overlay is completed.
6. The worker URL is public with no auth, behind a 100 req/min per-IP limiter.
7. Early-adopter stack: TypeScript 7, vitest 5, pre-1.0 oxfmt. Pin and wait on a
   toolchain regression.
8. Single-maintainer bus factor, mitigated by this file and the handbook.
9. ~~CPU budget unmeasured in production~~ closed 2026-07-29 (7.66 ms mean of a
   10 ms cap; it is a mean, re-read it if a hot path gains work).
10. `tools/list` costs a fixed ~19 400 characters of context in every
    conversation. Locked exactly by a test; see the handbook for each move.
11. French names: two skills lose to an English homonym, five are ambiguous, and
    the table can lag one import behind after an npm-fallback run.

Also owed, and not a code matter: a legal sign-off on redistributing skill
descriptions (see `THIRD_PARTY_NOTICES.md`).

## Current status (updated 2026-11-13)

Everything through distribution is done and live: codec, Reforged-current data,
8 tools and 3 resources, the Worker on Cloudflare, the MCP Registry listing,
automated releases, the C++ export plugin. Suite: 484 tests (107 / 133 / 161 / 83).
No open advisory, no dependency override, every dependency and action on its
latest major (pnpm 12, vitest 5).

Six audits have run; the sixth (2026-11-13) is the first entry of
`docs/handbook/audits.md`. The game logic has never yielded a defect to an audit.
What has, every time: automation that fails silently, prose that drifts from the
rule it describes, and bounds that count the wrong unit.

Next, maintainer-gated only: submit to the ChatGPT directory, follow the Claude
marketplace review, file the upstream bug report (debt #4).

## Explicit non-goals for the MVP

- ❌ `complete_build` / `generate_build` from tags or roles — this reintroduces the hard problem; the LLM proposes the 8 skills.
- ❌ Storing or reproducing GWPvX build pages, guides, or strategy content (community-authored, licensing concerns). Game data only.
- ❌ Rune/equipment templates (only skill templates for now).
- ❌ Any AI/LLM call inside the server. Hosting cost must stay ~0.
- ❌ Auth, accounts, persistence.

## Working style for Claude Code sessions

- Small, reviewable increments; one milestone per session.
- Before touching the codec, read the fixtures and the verification layers above.
- Never modify golden fixtures to make tests pass — fixtures are ground truth from the game.
- If a game rule seems ambiguous, check the Guild Wars Wiki and leave a link in a comment rather than assuming.
