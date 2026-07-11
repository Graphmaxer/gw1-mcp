# CLAUDE.md — gw1-mcp

## What this project is

An MCP (Model Context Protocol) server that gives any compatible LLM client (Claude, ChatGPT, Cursor…) reliable, deterministic knowledge of **Guild Wars 1** builds: skill data lookup, template code encoding/decoding, and build validation.

**Core design principle — the MCP is a compiler, not a brain.**
The LLM does all strategic reasoning (which skills to pick, team composition, meta knowledge, reading guides). This server only does things that must be *exact*:

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
├── reference/             ← original Python codec (source of truth for the port, read-only)
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
4. The **primary attribute** of a profession (e.g. Divine Favor, Mysticism, Soul Reaping) is only available if that profession is the *primary* one.
5. Attribute ranks in a template are **base ranks 0–12** (runes/headgear are not part of the template code).
6. No duplicate skills on one bar.
7. Warnings (not errors) for things like: PvE-only skills on a hero bar (heroes cannot use most PvE-only skills), skills from a campaign the player may not own.

Distinguish `errors` (build cannot exist / template cannot be generated) from `warnings` (build is encodable but suspicious). Always return both lists.

## Template code format — source of truth

The codec in `packages/gw-template` is implemented and round-trip tested. Do **not** change the bitstream layout from memory. The authoritative references are, in order:

1. The golden test fixtures (below) — real codes; extend them, never edit them.
2. `reference/` — the original Python implementation (battle-tested against real in-game codes).
3. Guild Wars Wiki: https://wiki.guildwars.com/wiki/Skill_template_format

The codec must be perfectly **round-trip stable**: `encode(decode(code)) === code` for every fixture, and `decode(encode(build))` deep-equals `build`.

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

<!-- TODO(Maxime): coller ici 10-15 codes réels de tes builds Nightfall (joueur + héros),
     dont au moins : un build avec slot vide, un build sans élite, un build sans secondaire,
     un build de héros avec skills de plusieurs campagnes. -->

Any change to the codec must keep every fixture green. When a bug is found, add the failing code as a new fixture *first*, then fix.

## Game data

Source: https://github.com/build-wars/gw1-database (MIT — keep the license notice, credit in README).

- Imported by a script into `packages/gw-data/data/*.json` (skills, professions, attributes, heroes, campaigns).
- The import script is committed and re-runnable; the generated JSON is committed too (the server must not fetch anything at runtime).
- Repository layer exposes typed lookups: `getSkillById`, `getSkillByName` (exact + case/diacritics-insensitive), `searchSkills({ profession?, attribute?, elite?, campaign?, nameContains? })`, `getHero`, `listHeroes`, `getProfession`, `listAttributes(profession)`.
- Skill names: canonical English names are the primary key; keep French localized names as an alias field if available in the source data (users will often ask in French).

## Current status (updated 2026-07-11)

Milestones 0-3 are DONE: monorepo builds, codec implemented and round-trip
tested against public example codes, gw1-database imported (1320 skills),
MCP server with 5 tools passing end-to-end tests over InMemoryTransport.
NEXT: more golden fixtures from real gameplay, then Streamable HTTP transport
and Cloudflare Workers deployment.

## MCP tools (MVP scope — do not add more without discussion)

| Tool | In | Out |
|---|---|---|
| `get_skill` | name or id | full skill record, or structured not-found with close-match suggestions |
| `search_skills` | filters (profession, attribute, elite, campaign, text) | paginated list of skill records |
| `decode_template` | template code | build object (professions, attributes, skills) |
| `encode_template` | build object | template code (runs validation first; refuses on errors, returns them) |
| `validate_build` | build object | `{ valid, errors[], warnings[] }` |
| `get_hero` / `list_heroes` | name / campaign filter | hero record(s): professions, campaign, how unlocked |

Tool design rules:

- Inputs and outputs are Zod schemas; every tool has a precise `description` written *for an LLM caller* (state units, enums, exact expected names).
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

1. MCP `resources` (e.g. `gw1://roles`, hero constraints, mission threat summaries) to help the client LLM reason.
2. `heroes_from_progression` tool: compute available heroes deterministically from campaign progress.
3. Cloudflare Workers deployment + custom connector on claude.ai; then Anthropic connectors directory submission.
4. GWToolbox export plugin (separate C++ repo): `/exportaccount` → JSON of unlocked heroes/skills to clipboard.

## Conventions

- Conventional commits (`feat:`, `fix:`, `test:`, `chore:`…).
- Every package builds and tests independently: `pnpm -r build && pnpm -r test` must pass from a clean clone.
- Public functions get TSDoc; keep comments about *why*, not *what*.
- CI: GitHub Actions running lint + build + tests on every PR.
- Language: code, identifiers, docs and commits in **English** (public OSS repo); it's fine to discuss in French in issues/PRs.

## Working style for Claude Code sessions

- Small, reviewable increments; one milestone per session.
- Before touching the codec, read `reference/` and the fixtures.
- Never modify golden fixtures to make tests pass — fixtures are ground truth from the game.
- If a game rule seems ambiguous, check the Guild Wars Wiki and leave a link in a comment rather than assuming.
