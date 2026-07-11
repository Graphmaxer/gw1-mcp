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
pnpm -r test        # vitest, ~130 tests
pnpm lint           # oxlint
pnpm fmt            # oxfmt (CI runs fmt:check)
pnpm test:coverage  # reference levels are documented in CLAUDE.md
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
  in `data/heroes-meta.json`.
- Tool-level failures use the `jsonError` helper (MCP `isError` flag).
- Importing any module must never trigger I/O; executables guard their
  flow behind `isDirectRun`.

## Pull requests

Keep them small and focused. CI runs lint, format check, typecheck, the
full test suite and a wrangler dry-run on every PR — a green CI plus a
sentence explaining the "why" is usually all a review needs. If your
change adds a known limitation, add it to the debt register in CLAUDE.md
with its action trigger; honesty there is a feature.
