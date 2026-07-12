# ChatGPT plugin submission kit

Copy-paste material for the plugin submission portal
(platform.openai.com/plugins). Server-side prerequisites are all live:
tool annotations (readOnly true / openWorld false / destructive false on
all 8 tools — accurate: every tool is a pure read-only computation),
privacy policy at /privacy, favicon (/favicon.ico redirects to the SVG logo), domain challenge
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
  ArenaNet. Look up any of the game's 1485 skills with current
  Guild Wars Reforged stats, search by profession/attribute/campaign,
  browse the full hero roster, decode any in-game template code or
  paw-ned2 team blob, and compile builds into official template codes —
  every build is validated against the real game rules (attribute
  budgets, elite limits, profession constraints, hero restrictions)
  before a code is produced. All tools are read-only; no account or
  authentication needed.
- Category: Entertainment (or Gaming if available)
- Logo: upload assets/brand/logo-1024.png (1024x1024 PNG). ChatGPT accepts a
  raster logo directly — no need to vectorize.
- Website / support: https://github.com/Graphmaxer/gw1-mcp
- Privacy policy: https://gw1-mcp.graphmaxer.workers.dev/privacy
- Terms: repository MIT license page
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
the MIT-licensed community dataset build-wars/gw-skilldata, refreshed at
build time. The listing and the server's own /privacy and / routes carry
an explicit non-affiliation disclaimer.

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
   Expected: list_heroes with campaignName Nightfall; 13 heroes with
   professions and unlock notes.
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
bundled skill (build-design workflow and code-integrity rules). Server is
open source (MIT): https://github.com/Graphmaxer/gw1-mcp

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

## Remaining human steps

1. Verify individual developer identity (platform.openai.com organization
   settings) and ensure the submitting role has Apps Management: Write.
2. Zip the skill: `cd skills && zip -r gw1-build-assistant.zip
gw1-build-assistant/` and upload it on the Skills tab.
3. Set the domain-challenge token when the portal reveals it, run Scan
   Tools, fix anything it flags, submit.
