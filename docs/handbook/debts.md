# Known debts and risks

The honest register: every KNOWN compromise, kept deliberately, with its trigger for action. Nothing else in the repo is knowingly imperfect. CLAUDE.md carries the one-line index; the reasoning is here.

## The register

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
7. Early-adopter stack: TypeScript 7.0.x and vitest 5 are young majors and
   oxfmt is pre-1.0 (0.78.x, formatting may shift between minors);
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
10. tools/list costs 19 409 characters (~4 850 tokens) of FIXED context
    in every conversation, outputSchemas being ~40% of it (7 805 chars). That is
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
    It EARNED that on 2026-08-31, on a Dependabot PR: zod 4.5 emits a nullable
    field as the JSON Schema type-array form (`{"type":["string","null"]}`) where
    4.4 emitted an `anyOf` pair, which is -323 characters across the 17 nullable
    output fields. The lock is the only reason anyone looked. Accepted after
    proving it was a NOTATION change and not a lost contract — normalising the
    two forms makes the schemas deep-equal, and all eight tools keep their
    outputSchema, strict input and description. That is the bar for accepting a
    dependency-driven move: show the delta is cosmetic, never just re-baseline
    the constant because CI is red.
    The same commit then spent +213 characters on purpose, which is the other
    half of this debt working as intended: `get_skill`'s `name` now says the
    French name resolves and `search_skills`' `nameContains` says a French
    substring matches nothing. Paying fixed context for that is the audit
    L-series lesson — a caveat in the server `instructions` is invisible to the
    many clients that never forward them, while a parameter description always
    travels.
    And +89 on 2026-11-13, again on purpose and again on a forwarded field: both
    `forPvp` descriptions still said PvP versions of split skills "are only valid
    when this is true, and a PvP bar is expected to use them" — the rule deleted on
    2026-08-01. A model that obeyed the description got `PVP_VERSION_IN_TEMPLATE`,
    a hard error, from the tool that had just told it to. The validator was fixed
    that day and the sentence describing it was not; nothing locks prose to rules.
    `get_skill`'s own description also still said "exact English name".
    A further +12 the same day made one more forwarded sentence true: `get_skill`'s
    `name` claimed every other name field on every other tool was English-only,
    while build skill names have resolved French since the table shipped (they go
    through the same lookup). Locked by a test now.
    Trigger: if a client's
    context budget ever matters, check whether that client forwards
    outputSchema to the model at all before optimising further.
11. French name support (2026-08-31) carries three known compromises, none of
    them fixable without giving up something better.
    - **2 skills are unreachable by their French name.** "Récupération" (Recovery, 1748) normalises to `recuperation`, the English name of Recuperation (981),
      and English wins by design. Also true in reverse for the PvP pair
      (3025/3013). Not fixable in a single-answer lookup; a caller who means
      Recovery can use the id or the English name. Trigger: only a
      multiple-candidate return shape would fix it, which is a tool-contract
      change and not worth it for two skills.
    - **5 French names are ambiguous** ("Rafale" = Flurry and Gust; also Attaque
      féroce, Attaque sournoise, Coup enragé, and the PvP form of the last). They
      resolve to nothing and the suggester returns both English names. Upstream's
      translation, not ours to fix.
    - **The table can go stale without anything failing.** Only the Pages and
      clone channels serve French, so a weekly run that falls back to npm
      refreshes `skills.json` and not the French names — a new skill would then be
      nameless in French until the next Pages-backed run. Bounded, not silent:
      `repository.test.ts` asserts the table and `skills.json` cover the same ids,
      so the drift reds the suite instead of being discovered by a lookup quietly
      returning nothing. The runtime side of that scenario is tested too
      (`french-stale-table.test.ts`, which mocks a table naming an id no skill
      has): the guard that skips it is not paranoia — removing it throws
      `Cannot read properties of undefined (reading 'name')` in the suggester,
      verified by sabotage. Trigger: that test failing, or npm publishing a version
      that exports `SkillLangFrench` (the loader already picks it up with no code
      change — it asks `typeof SkillLangFrench === "function"` rather than
      hard-coding today's absence).
