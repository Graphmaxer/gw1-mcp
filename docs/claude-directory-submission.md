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
  Wars. Look up any skill in the game with current Guild Wars
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
  build time from build-wars/gw-skilldata; its code is MIT but the skill
  descriptions are GFDL/CC-BY-NC-SA — see THIRD_PARTY_NOTICES.md)
- Health data: none
- Category: Entertainment / Gaming
- Allowed link URIs: N/A (the connector opens no links)

## Tools, resources & prompts (form asks for all three)

All 8 tools carry title + readOnlyHint: true, destructiveHint: false
(accurate: pure lookups/computations). get_skill, search_skills,
get_hero, list_heroes, decode_template, decode_pawned_team,
validate_build, encode_template. 3 resources (meta, professions guide,
build workflow guide). No prompts — the `prompts` capability is not
declared, so `prompts/list` correctly returns -32601. Server-level
instructions declare the code-integrity rules.

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

- Logo (upload): assets/brand/icon-1024.png (1024x1024 PNG — the scythe +
  8-slot skill-bar badge on a rounded tile with transparent corners, so one file
  works on light and dark surfaces alike). 512, 256 and 48 sizes sit beside it.
  See assets/brand/README.md. The worker also serves a 32px PNG favicon derived from this same logo at
  /favicon.ico and /logo.png, but upload the 1024px PNG on the form.
- Favicon: /favicon.ico on the MCP hostname (32px PNG derived from the logo)
- Screenshots: N/A — not an MCP App (no interactive UI); the directory
  requires carousel screenshots only for MCP Apps

## Technical requirements checklist

- HTTPS: yes (Cloudflare Workers)
- OAuth: N/A (no authenticated service)
- CORS: open (`Access-Control-Allow-Origin: *`) with preflight handled on
  /mcp, so browser-based MCP clients and web playgrounds work. This is a
  deliberate decision, not an oversight: the service is public, read-only
  and credential-free — there is no cookie, session or Authorization
  header, so a permissive CORS policy grants a browser nothing that a
  plain `curl` does not already have.
- Origin-header validation: a well-formedness check, NOT an allowlist. A
  malformed or non-https Origin is rejected with 403 (loopback http is
  allowed for local development); any well-formed https Origin is
  accepted. It is deliberately not an origin restriction — with no
  session or credential to ride on, there is no CSRF surface to protect,
  and DNS-rebinding advice targets servers bound to localhost.
- Method handling on /mcp: POST only. GET and DELETE return 405 (the
  server is stateless — no SSE stream to resume, no session to delete),
  as the Streamable HTTP spec permits.
- Response headers: X-Content-Type-Options, Referrer-Policy,
  Cache-Control: no-store on /mcp
- Tool annotations: title + readOnlyHint on every tool, values served
  by the server itself
- Skills: optionally bundle the gw1-build-assistant skill (also part of
  the ChatGPT submission) via the plugins flow

## Before submitting (verified against the docs, 2026-07-29)

- Submit via the **MCP directory submission form**
  (https://clau.de/mcp-directory-submission), which covers remote MCP
  servers and MCP Apps. The form is always open; Anthropic notes it is
  _moving to a native Claude.ai surface_, and third-party write-ups
  describe that surface as living in Team/Enterprise admin settings. If
  that becomes the only route, an individual plan may not be able to
  submit — check before investing more time in the kit.
- Run the **pre-submission checklist / review criteria** page first:
  https://claude.com/docs/connectors/building/review-criteria
- Submitting means agreeing to the Anthropic Software Directory **Terms**
  and **Policy**, plus commitments to maintain security and functionality,
  respond to security issues promptly, and keep descriptions accurate.
  Read both before filing — and note this is the moment debt #4 in
  CLAUDE.md is triggered: the skill descriptions are GFDL / CC BY-NC-SA,
  and listing in a distribution channel is the event that register says
  needs legal sign-off first. That is a decision for the maintainer, not a
  technical blocker.
- Reviewers explicitly tick `Origin`-header validation as a technical
  requirement. Ours is a well-formedness check, not an allowlist (see
  above), which is accurate but may prompt a question. The MCP 2026-07-28
  stateless core makes the reasoning easier to defend: with no session to
  protect, an origin allowlist protects nothing.
- Privacy policy must cover collection, usage and storage, third-party
  sharing, **retention**, and contact. All five are now served at /privacy
  and locked by tests in packages/gw-worker/test/http.test.ts — retention
  was missing until 2026-07-29, and an incomplete policy is an immediate
  rejection.

## This is a PLUGIN submission, not a connector submission (2026-07-29)

Reading the plugin docs changed what "submit to Claude" means here, and removed
the blocker recorded earlier in this file.

- The route is the **Console form** at https://platform.claude.com/plugins/submit.
  The claude.ai form needs a Team or Enterprise organisation with directory
  management access; **individual authors use the Console form instead**. So the
  Team/Enterprise gate flagged earlier does not apply.
- What lands in the community marketplace is a **plugin**, reviewed and then
  pinned to a commit SHA in `anthropics/claude-plugins-community`, with CI bumping
  the pin as commits land. The public catalog syncs nightly, so expect a delay
  between approval and installability.
- Two files were missing and now exist at the repository root, which is the plugin
  root:
  - `.claude-plugin/plugin.json` — name `gw1-mcp`, so the bundled skill is invoked
    as `/gw1-mcp:gw1-build-assistant`. Its `version` is kept in step with releases
    by release-please (`extra-files`, same mechanism as `server.json`), so it
    cannot drift. Leaving `version` out would have made every commit count as a
    new version for users.
  - `.mcp.json` — wires the remote server, so installing the plugin gives the
    skill AND the tools in one step. **`"type": "http"` is mandatory**: without it
    the config fails schema validation silently, the tools simply never appear and
    nothing is logged. That trap has cost other people time; do not "tidy" it away.
- `skills/gw1-build-assistant/SKILL.md` was already in the layout the docs
  recommend, so nothing moved.

Run `claude plugin validate .` before submitting — the review pipeline runs the
same check. It could not be run here: the Claude Code CLI is not available in this
environment, so this is unverified locally.

### Checked against the plugins reference (2026-07-29)

- `name` is the only required manifest field, but four recommended ones were
  missing and are now set: `$schema` (editor validation; ignored at load time),
  `displayName` (what `/plugin` shows — without it the entry reads `gw1-mcp`,
  which means nothing to a player), `keywords`, and an author `url`.
- **The version field is a commitment, not decoration.** With `version` set,
  users receive an update only when it is bumped — pushing commits alone changes
  nothing, and `/plugin update` reports "already at the latest version". That is
  the right behaviour for a released plugin and release-please keeps it in step,
  but it means work merged between releases does not reach plugin users. Leaving
  `version` unset would flip it to per-commit updates, which would be noisy here.
- **A `CLAUDE.md` at the plugin root is NOT loaded as plugin context.** Ours is a
  maintainer document and stays one; plugins contribute context through skills,
  agents and hooks. Nothing to change, but do not assume users of the plugin see
  it.
- The default `skills/` scan is additive, so `skills/gw1-build-assistant/SKILL.md`
  is found without declaring a `skills` field. Declaring one would have been
  harmless but pointless.
- Nothing traverses outside the plugin root, which installed plugins cannot do:
  the plugin root here IS the repository root.
- Four assertions now lock all of this in `conventions.test.ts` — recognised keys
  only (so `--strict` cannot fail on a typo), kebab-case name (it namespaces the
  skill invocation), manifest version equal to `server.json`, and `"type": "http"`
  present in `.mcp.json`.

Form fields, from repo metadata: link to plugin =
https://github.com/Graphmaxer/gw1-mcp, path within repository = blank (the plugin
is at the root), homepage = the same URL, plugin name = gw1-mcp.

## Console form, remaining fields (2026-07-31)

- **Supported platforms** — the form says "Test that the plugin works with these
  surfaces before submitting", so select only what has actually been loaded. The
  local test is `claude --plugin-dir .` from the repository root, then
  `/gw1-mcp:gw1-build-assistant` for the skill and `/mcp` to confirm the server's
  tools appear. Run `claude plugin validate .` first; the review pipeline runs the
  same check.
- **Email address** — this one is for Anthropic to contact the maintainer, not a
  published address, which makes it a different question from the Glama file we
  declined: that one would have been served at a public URL and scraped. A private
  contact field is the normal place for a real address.
- **License type** — MIT, for the code. Note that the plugin bundles game data
  under different terms; the description already carries the trademark disclaimer
  and THIRD_PARTY_NOTICES.md has the provenance.
- **Privacy policy URL** — https://gw1-mcp.graphmaxer.workers.dev/privacy, even
  though the field is optional. The plugin's MCP server does record anonymous
  aggregate counters, so a reviewer asking "does this collect anything" deserves an
  answer that exists.

## `claude plugin validate .` result (2026-07-31, run by the maintainer)

```
✔ Validation passed with warnings
⚠ root: CLAUDE.md at the plugin root is not loaded as project context.
  To ship context with your plugin, use a skill (skills/<name>/SKILL.md) instead.
```

**Expected, benign, and deliberately not silenced.** The warning is the behaviour
already recorded above from the plugins reference. CLAUDE.md here is a maintainer
document, and the context that plugin users should receive already ships as
`skills/gw1-build-assistant/SKILL.md` — which is precisely what the warning
recommends. The substance is right; only the presence of the file triggers it.

Silencing it would mean moving the plugin into a subdirectory and setting "Path
within repository" on the form, which splits the layout and buys nothing. Not
worth it.

One thing to keep in mind rather than act on: warnings do not fail validation, and
the docs say so explicitly, but `--strict` turns them into errors. Do not add
`--strict` to CI for this repository while CLAUDE.md sits at the root.

The same run also confirmed two things that had only been reasoned about:

- `.mcp.json` was detected and accepted — "New MCP server found in this project:
  gw1-mcp". The mandatory `"type": "http"` was therefore correct; without it the
  config would have failed schema validation silently and nothing would have
  appeared.
- The manifest itself validates, so the recognised-keys assertion in
  `conventions.test.ts` is consistent with the real CLI.

Still to do inside a session before ticking "Supported platforms": run `/mcp` to
confirm the eight tools load, and `/gw1-mcp:gw1-build-assistant` to confirm the
skill invokes under its namespaced name.
