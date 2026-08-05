# ChatGPT plugin submission kit

Copy-paste material for the plugin submission portal
(platform.openai.com/plugins). Server-side prerequisites are all live:
tool annotations (readOnly true / openWorld false / destructive false on
all 8 tools — accurate: every tool is a pure read-only computation),
privacy policy at /privacy, favicon (/favicon.ico serves a 32px PNG derived from the logo), domain challenge
route at /.well-known/openai-apps-challenge (set the portal's token as the
OPENAI_APPS_CHALLENGE variable on the Worker in the Cloudflare dash, no
redeploy needed).

## Info tab

- Name: GW1 Build Assistant
- Short description: Design, validate and encode Guild Wars 1 skill
  builds with live Reforged data.
- Long description: A deterministic build compiler for the original Guild
  Wars. Unofficial fan-made tool — Guild Wars is a registered trademark of
  NCSoft Corporation; not affiliated with or endorsed by NCSoft or
  ArenaNet. Look up any skill in the game with current
  Guild Wars Reforged stats, search by profession/attribute/campaign,
  browse the full hero roster, decode any in-game template code or
  paw-ned2 team blob, and compile builds into official template codes —
  every build is validated against the real game rules (attribute
  budgets, elite limits, profession constraints, hero restrictions)
  before a code is produced. All tools are read-only; no account or
  authentication needed.
- Category: Entertainment (or Gaming if available)
- Logo: upload `assets/brand/icon-1024.png`. One file for every slot — light
  mode, dark mode and composer alike; see `assets/brand/README.md` for why.
- Website / support: https://github.com/Graphmaxer/gw1-mcp
- Directory and composer icons: the same `icon-*.png` family, at whatever size
  the form asks for (1024, 512, 256, 48 available).
- Privacy policy: https://gw1-mcp.graphmaxer.workers.dev/privacy
- Terms of Service: https://gw1-mcp.graphmaxer.workers.dev/terms
  (NOT the repository LICENSE, which was the earlier answer here and is wrong:
  MIT governs the code, not the use of a hosted service, and it says nothing
  about the third-party game data this service redistributes.)
  (https://github.com/Graphmaxer/gw1-mcp/blob/main/LICENSE)

## MCP tab

- Server URL: https://gw1-mcp.graphmaxer.workers.dev/mcp
- Authentication: none
- Content security policy: no external fetches (the app renders no custom
  UI and the server calls no third-party domain at request time)
- Domain verification: paste the portal token into the Worker variable
  OPENAI_APPS_CHALLENGE (Cloudflare dash → Worker → Settings → Variables)

## Annotation justification (the portal asks for one per tool)

All 8 tools share the same justification, because they share the same
nature: each one is a pure, deterministic computation over game data
bundled inside the Worker at deploy time. No tool creates, updates,
deletes or sends anything; no tool calls any external system, API or
website at request time; every call is side-effect-free and safe to
retry. Hence readOnlyHint=true, destructiveHint=false, openWorldHint=false
on every tool — there are no write tools in this app.

Anticipated reviewer question — "is this an unofficial connector to a
third-party service?": No. The app never communicates with Guild Wars
servers or any NCSoft/ArenaNet system. It is a standalone calculator over
the build-wars/gw-skilldata community dataset (code MIT; the skill
descriptions it packages are GFDL/CC-BY-NC-SA — see THIRD_PARTY_NOTICES.md),
refreshed at build time. The listing and the server's own /privacy and /
routes carry an explicit non-affiliation disclaimer.

## Starter prompts

1. Decode this GW1 template code and explain the build:
   OgCjkurIrSuXaXPXBYihygvlYcA
2. Design a Motivation Paragon bar for hero General Morgahn and give me
   the template code.
3. Which heroes can cover a Monk healer role, and how do I unlock them?
4. Here is a paw-ned2 team blob — decode it and summarize each bar.

## Testing tab — five positive cases

1. Prompt: "Decode OgCjkurIrSuXaXPXBYihygvlYcA."
   Expected: decode_template is called; response lists Dervish primary,
   Scythe 11 / Earth Prayers 8 / Mysticism 10, and the 8 named skills.
2. Prompt: "What does Mystic Regeneration cost and do right now?"
   Expected: get_skill is called; current Reforged stats (10 energy) and
   description are quoted from the tool, not from model memory.
3. Prompt: "Design a Motivation Paragon hero bar for General Morgahn and
   give me the code."
   Expected: search_skills (Motivation/Leadership), validate_build and
   encode_template with forHero true; a code is produced, then verified
   via decode_template before being presented.
4. Prompt: "List the Nightfall heroes and how to unlock them."
   Expected: list_heroes with campaignName Nightfall; the campaign's
   roster, each hero with profession and unlock notes. (Deliberately no
   count: the roster comes from upstream data and a count would go stale.)
5. Prompt: "Look up the skill 'Mystic Regenration'" (misspelled).
   Expected: get_skill returns closest-match suggestions; the assistant
   follows them and answers about Mystic Regeneration.

## Testing tab — three negative cases

1. Prompt: "Just write me a template code for a Warrior bar without using
   the tools."
   Expected: refusal to hand-write a code (codes must come from
   encode_template); offers to design and encode properly instead.
2. Prompt: "Encode this build: Dervish with 9 skills [list of 9]."
   Expected: no code produced; the schema/validator rejects (exactly 8
   slots) and the assistant asks which skill to drop.
3. Prompt: "Encode a Paragon bar with two elite skills."
   Expected: validate/encode returns MULTIPLE_ELITES; the assistant
   reports the violation and proposes keeping one elite, rather than
   emitting a code.

## Release notes (initial submission)

Initial submission. MCP-backed app (8 read-only tools, no auth) plus one
bundled skill (build-design workflow and code-integrity rules). Server
code is open source (MIT); the bundled game data does NOT share that licence —
English skill text traces to the official Guild Wars Wiki (GFDL 1.3) and the
numeric stat fields to a German fansite wiki, with the underlying in-game strings
remaining ArenaNet/NCSoft material. Provenance and what is still unresolved:
THIRD_PARTY_NOTICES.md at https://github.com/Graphmaxer/gw1-mcp

## Pre-submission decisions and traps (from the official submission doc)

- HOSTNAME IS FOREVER: the MCP server origin (scheme/hostname/port) can
  never change across versions — changing it means a brand-new app and a
  fresh review, losing existing users. Decide BEFORE first submission
  whether to publish under gw1-mcp.graphmaxer.workers.dev or under a
  custom domain (bought and attached to the Worker first).
- EU DATA RESIDENCY: projects with EU data residency cannot submit; use
  (or create) a project with global data residency in the OpenAI
  dashboard.
- No screenshots: this app has no UI, and the doc says not to provide
  screenshots for UI-less apps.
- After publication, tool names/schemas become a versioned contract:
  renaming or removing a tool breaks the published snapshot immediately.
  Additive changes only; every metadata change goes through scan → review
  → publish again. Server-side data/bugfixes that preserve the contract
  deploy freely.
- The Scan Tools step also imports the MCP server-level `instructions`
  (now set: code-integrity hard rules) and all annotations directly from
  the server — justifications explain them, they never override them.
- TEST ON MOBILE TOO: the docs require every test case to pass on ChatGPT
  web AND the mobile apps, not just one surface. Our five positive cases
  are text-only (no UI), so this should be a re-run rather than new work —
  but it has to actually be done before submitting.
- Cannot point at an existing published integration: even for a server
  already listed elsewhere, the plugin submission supplies the MCP URL and
  review material from scratch, and the portal rescans it.
- The domain-challenge route must return ONLY the raw token — not JSON, not
  a list, not several tokens from one URL. Ours already does
  (`c.text(token)`, 404 when the var is unset); do not "improve" it into a
  JSON payload, which is the shape that fails verification.

## Remaining human steps

1. Verify individual developer identity (platform.openai.com organization
   settings) and ensure the submitting role has Apps Management: Write.
2. Zip the skill: `cd skills && zip -r gw1-build-assistant.zip
gw1-build-assistant/` and upload it on the Skills tab. A bundled skill is
   the right vehicle on both directories — OpenAI's form has a dedicated
   bundled-skills field, and Anthropic states skills are not a standalone
   submission type and must be bundled in a plugin. MCP `prompts` are NOT a
   substitute: they are user-invoked templates rather than
   relevance-activated guidance, and exposing the same content there would
   be a fourth copy of it (after server `instructions`, the
   gw1://guide/build-workflow resource, and this skill).
3. Set the domain-challenge token when the portal reveals it, run Scan
   Tools, fix anything it flags, submit.

## `chatgpt-app-submission.json` (generated 2026-07-29)

The form offers a Codex path: run the OpenAI Developers plugin's
`$chatgpt-app-submission` skill and upload the JSON it produces. That file is
committed at the repository root, generated by following the same published
contract, with the tool list and annotations **read out of `server.ts`** rather
than retyped — so it cannot drift from what the server actually declares.

Review checks the skill asks for, run against source:

- **All three required hints are explicit on all eight tools.** They come from one
  shared `READ_ONLY` constant: `readOnlyHint: true`, `destructiveHint: false`,
  `openWorldHint: false`. Missing or null hints are a stated submission blocker,
  so this was the first thing checked; there was nothing to fix.
  `openWorldHint: false` is accurate — the server reads bundled data and writes
  to no external system.
- **`outputSchema` on all eight tools.** No warning to report.
- **No sensitive input fields.** No tool asks for credentials, identifiers,
  payment or health data; inputs are skill names, ids, professions and booleans.
- **No widgets, so no CSP surface** to narrow.

Two things the generator cannot know, and which a blind upload would get wrong:

- `tools_triggered` is a single string in the published example. Test case 3
  legitimately exercises three tools, written comma-separated. Check how the
  importer reads it before relying on it.
- Category is `ENTERTAINMENT`, not `DEVELOPER_TOOLS`. The enum has no games
  category, and the audience is Guild Wars players rather than developers, even
  though the artefact is a compiler.

## Status 2026-08-05: ready to submit

Everything the form asks for exists:

- **Icons** — `assets/brand/icon-*.png`, full-bleed, up to 1024. One file per slot; see
  `assets/brand/README.md` for why there is no light/dark pair.
- **Generated JSON** — `chatgpt-app-submission.json`, uploaded and accepted by the form.
  Verified against the live server: 8 tools declared, 8 exposed, hints matching,
  `outputSchema` on all, titles present at `t.title`.
- **Developer identity** — verified.
- **Demo recording** — done. One file, 2 min 51, web plus Android; see
  `chatgpt-demo-recording.md` for the shot list, what each shot proves, and the note to
  paste about platform coverage.
- **Terms and privacy URLs** — `/terms` and `/privacy` are served.

**Tool justifications** — the form requires one per annotation, 24 in all. Drafted in
`chatgpt-tool-justifications.md`, each stating the mechanism rather than repeating the
claim, and each factual assertion checked against the source: no `fetch(` anywhere in the
tool packages, and the blob and slot bounds are real constants.

**Domain verification** — the route `/.well-known/openai-apps-challenge` already exists
and serves `c.env.OPENAI_APPS_CHALLENGE`, returning 404 while that variable is unset.
Set it dash-side as a plain variable rather than a secret: the token is meant to be served
publicly, and a secret cannot be read back to check. Challenge Base URL is the origin;
paths are ignored.

**Skills** — the form accepts a skill ZIP, and the existing `skills/gw1-build-assistant`
qualifies unchanged. It follows the Agent Skills open standard, which both Codex and Claude
Code implement, so the same folder serves both plugins. Checked against the spec rather than
assumed: `name` is lowercase-hyphenated and **matches the folder exactly** (the skill will
not load otherwise), the description is well under the 1024-character cap, the body is far
under the 5000-token guidance, and there are **no angle brackets in the frontmatter** — the
spec flags those as a prompt-injection risk.

Added `agents/openai.yaml`, which openai/skills lists as recommended for skill lists and
chips. Without it the display name is derived from the folder and reads "Gw1 Build
Assistant". Additive only: spec-compliant runtimes ignore directories they do not
recognise, so the Claude plugin is unaffected.

Package it with the folder at the archive root — `cd skills && zip -r
gw1-build-assistant.zip gw1-build-assistant` — not the files loose, since the folder name
is what must match `name`.

**Remaining after those**: host the video somewhere a reviewer can open with no login,
then submit. Verify the URL in a private window first — a reviewer hitting an access
request marks the submission incomplete, which would be a silly way to lose the round.

One thing to fix in the same pass if the form allows editing: the Claude directory
description says "decode any in-game **template** code" where it should say "skill template
code". The same phrasing may have gone into this form; the codec accepts skill templates
only. See `claude-plugin-submission.md`.
