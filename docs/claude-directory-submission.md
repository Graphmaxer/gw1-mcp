# Claude Connectors Directory submission kit

Submission is via the public form (always open):
https://clau.de/mcp-directory-submission — no Team/Enterprise org needed.
Escalations/status: usersubmissions@anthropic.com. Answers below map to
the form's "What you'll need" list.

## Server basics

- Name: GW1 Build Assistant
- URL: https://gw1-mcp.graphmaxer.workers.dev/mcp
- Tagline: Design, validate and encode Guild Wars 1 builds with live
  Reforged data.
- Description: A deterministic build compiler for the original Guild
  Wars. Look up any of the game's 1484 skills with current Guild Wars
  Reforged stats, search by profession/attribute/campaign, browse the
  hero roster, decode any in-game template code or paw-ned2 team blob,
  and compile builds into official template codes — validated against
  the real game rules before a code is produced. Unofficial fan-made
  tool; Guild Wars is a registered trademark of NCSoft Corporation; not
  affiliated with or endorsed by NCSoft or ArenaNet.
- Use cases: decode/explain a template code; design a hero or player
  skill bar and get a paste-ready code; compare skills under the current
  balance patch; plan hero team composition and unlocks.

## Connection details

- Auth type: none (open, read-only data service)
- Transport: streamable-http
- Read/write: strictly read-only — every tool is a pure computation over
  game data bundled at deploy time; no state, no side effects, no
  external calls at request time
- Connection requirements: none

## Data & compliance

- Data handling: no personal data collected or processed; stateless; no
  request content persisted by the application (Cloudflare operational
  logs per their policy)
- Third-party connections: none at request time (data is imported at
  build time from the MIT-licensed build-wars/gw-skilldata dataset)
- Health data: none
- Category: Entertainment / Gaming
- Allowed link URIs: N/A (the connector opens no links)

## Tools (all with human-readable titles and annotations)

All 8 tools carry title + readOnlyHint: true, destructiveHint: false
(accurate: pure lookups/computations). get_skill, search_skills,
get_hero, list_heroes, decode_template, decode_pawned_team,
validate_build, encode_template. 3 resources (meta, professions guide,
build workflow guide). Server-level instructions declare the
code-integrity rules.

## Documentation & support

- Docs: https://github.com/Graphmaxer/gw1-mcp (README covers setup,
  usage, architecture; public well before publish date)
- Privacy policy: https://gw1-mcp.graphmaxer.workers.dev/privacy
  (also summarized in the README's Privacy Policy section)
- Support: GitHub issues on the repository

## Test account

None needed — no authentication. Reviewer test script:

1. Connect to the URL above (no credentials).
2. Ask: "Decode this GW1 template code: OgCjkurIrSuXaXPXBYihygvlYcA"
   → expect a Dervish bar (Scythe 11 / Earth Prayers 8 / Mysticism 10).
3. Ask: "Design a Motivation Paragon hero bar for General Morgahn and
   give me the template code" → expect search/validate/encode calls and
   a code verified by decode_template.
4. Ask: "Look up the skill 'Mystic Regenration'" (misspelled) → expect
   the tool's closest-match suggestions to be used to recover.

## Launch readiness

- GA: already live (deployed on Cloudflare Workers, CI/CD from the
  public repository)
- Surfaces tested: Claude Code (streamable-http), ChatGPT developer
  mode, Cloudflare AI Playground (multiple models)

## Branding

- Logo (upload): assets/brand/logo-1024.png (1024x1024 PNG — the scythe +
  8-slot skill-bar badge; directory forms prefer a raster logo). A 512px
  copy sits beside it. The worker also serves a 32px PNG favicon derived from this same logo at
  /favicon.ico and /logo.png, but upload the 1024px PNG on the form.
- Favicon: /favicon.ico on the MCP hostname (32px PNG derived from the logo)
- Screenshots: N/A — not an MCP App (no interactive UI); the directory
  requires carousel screenshots only for MCP Apps

## Technical requirements checklist

- HTTPS: yes (Cloudflare Workers)
- OAuth: N/A (no authenticated service)
- Origin-header validation: yes — browser-context requests with a
  non-https Origin are rejected with 403 on /mcp; clients without an
  Origin header (standard MCP clients) are unaffected
- Tool annotations: title + readOnlyHint on every tool, values served
  by the server itself
- Skills: optionally bundle the gw1-build-assistant skill (also part of
  the ChatGPT submission) via the plugins flow
