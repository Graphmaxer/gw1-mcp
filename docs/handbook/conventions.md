# Conventions and tooling

The uniform-on-purpose rules: script archetype, naming, TypeScript config, lint and format, coverage reference levels, repository layout, the push-to-main workflow.

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
  cross-file import.
- ONE SCRIPT RUNTIME, decided 2026-08-17: **everything under `scripts/` runs on
  bare `node`**; `tsx` survives only in the two local dev servers (`gw-mcp dev`,
  `gw-worker dev:node`), which run `src/` and are a different concern. The split
  used to be accidental — `tsx` for the import scripts, `node` for the growth
  gate — and the reason it could not simply become "tsx everywhere" is worth
  keeping: `tsx` lives in node_modules, so using it in `open-pr` means
  `pnpm install` in the job holding contents:write and the app token, which
  executes third-party postinstall scripts (esbuild and workerd both have them).
  That is precisely what the two-job split exists to prevent, so the alignment
  had to go the other way. Consequence, and the thing that bites: node's type
  stripping resolves the real file on disk and will NOT map `./x.js` back to
  `./x.ts` the way tsx and bundlers do, so sibling imports in `scripts/` use a
  `.ts` specifier and gw-data's tsconfig carries `allowImportingTsExtensions`
  (legal only with `noEmit`, which is already true — nothing here is ever built
  to dist). `src/` keeps `.js` specifiers: wrangler and vitest map them, and
  changing that would touch the Worker bundle for no gain. Verified rather than
  assumed — the real import was re-run under bare node and reproduced all five
  data files, `heroes.json` and the generated C++ header byte-for-byte. Two deliberate non-violations: pure
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
