# Contributing

Thanks for your interest! This project is small and opinionated; most of
what you need to know lives in **[CLAUDE.md](./CLAUDE.md)** — it is the
actual source of truth: architecture, data provenance rules, internal
conventions, the coverage expectations, and an honest register of known
debts. Read it before proposing changes; it will answer most "why is it
done this way" questions.

## Development setup

Requirements: Node >= 22 and pnpm 11.

```bash
pnpm install
pnpm -r typecheck   # TypeScript 7 (native), zero errors expected
pnpm -r test        # vitest, all packages (CI reports the count)
pnpm lint           # oxlint
pnpm fmt            # oxfmt (CI runs fmt:check)
pnpm test:coverage  # reference levels are documented in CLAUDE.md
pnpm bench          # vitest bench, all packages (CodSpeed measures these in CI)
```

Nothing is ever built to `dist`: package exports point at `.ts` sources
and the worker bundles via wrangler. `pnpm --filter @gw1-mcp/gw-worker dev`
runs the worker locally.

## Ground rules the CI will hold you to

- Every validator rule and resolution error code must have a test that
  triggers it — this is mechanically enforced by
  `packages/gw-mcp/test/conventions.test.ts`.
- Codec changes must keep the golden fixtures green
  (`packages/gw-template/test/fixtures/templates.json` — real codes from
  four independent encoders). Never "fix" a fixture to make code pass;
  fixtures are the reference, the code is the hypothesis.
- Generated data files (`packages/gw-data/data/*.json`) are never edited
  by hand — see the provenance rules in CLAUDE.md. Hero metadata belongs
  in `data/heroes-overlay.json`.
- Tool-level failures use the `jsonError` helper (MCP `isError` flag).
- Importing any module must never trigger I/O; executables guard their
  flow behind `isDirectRun`.

## Commit messages and releases

Commit messages follow conventional commits (`feat:`, `fix:`, `docs:`,
`refactor:`, `test:`, `deps:`, `chore:`, `ci:`) — release-please reads
them to build the changelog and pick the next SemVer bump (`feat` = minor,
`fix` = patch, `feat!`/`BREAKING CHANGE:` = major). A running release PR
on main accumulates changes; merging it tags the release, publishes it on
GitHub, and the MCP Registry metadata updates automatically.

## Pull requests

Keep them small and focused. CI runs lint, format check, typecheck, the
full test suite and a wrangler dry-run on every PR — a green CI plus a
sentence explaining the "why" is usually all a review needs. If your
change adds a known limitation, add it to the debt register in CLAUDE.md
with its action trigger; honesty there is a feature.

## Dead code (`pnpm knip`)

`knip` reports unused files, exports and dependencies. It exists because a dead
export slipped through once and cost a red build: an exported-but-never-called
function dragged coverage down 1.7% and failed the Codecov project check, which no
test could catch — nothing was wrong, something was merely pointless.

The job is blocking. Its first run found two exports used only inside their own file
(`decodedSkillSchema`, `ValidationIssue`), now file-local, and thirteen
over-specified lines in `knip.json` — ignores that were not needed, entry points
knip already derives from `package.json`, and an `ignoreBinaries` entry for a tool
that was never installed.

Two things to know when it next complains:

- knip 5 is not a fallback: it crashes on TypeScript 7.
- Test files are entry points. Without that, everything they exercise looks unused.
- If something is reached only through configuration rather than imports — a
  Wrangler entry, a release-please target, a `.mjs` script called from a workflow —
  add it to `entry` rather than silencing the rule. And trust knip's own
  configuration hints: they were right about every line of the first config.

## Where things live in `gw-mcp`

`server.ts` was 1001 lines and is now 557. The split follows seams that already
existed, not invented ones:

| file         | holds                                                                                                                                                    |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schemas.ts` | every zod shape, inferred type, tool input/output schema, pre-built schema object, and the input bounds. Immutable data with no dependency on the server |
| `results.ts` | the MCP content and error envelopes, plus `fullSkill`/`fullHero`, which resolve ids to names                                                             |
| `events.ts`  | `ToolCallEvent`, `CreateServerOptions`, `deriveEvent` — the transport-agnostic boundary the worker consumes                                              |
| `server.ts`  | `createServer` and the eight tool plus three resource registrations, and nothing else                                                                    |

`validate.ts` is deliberately NOT split, and the contrast is the useful part: its
rules share mutable intermediate state and interact by order — the attribute-budget
error is suppressed when a rank is out of range, on purpose — so separating them
would need a nine-field context object and would hide the interactions rather than
clarify them. Length alone is not a reason to split a file; absence of shared state
is.

Two things to know if you move code again:

- The schema locks in `conventions.test.ts` inspect the PUBLISHED `tools/list` JSON
  Schema, not the source text, so they survive file moves. Three checks still read
  source and are noted as such in that file.
- `fullSkill` must never use `...skill`. The comment there explains why; ignoring it
  breaks `get_skill` for every client that primes its output validators.
