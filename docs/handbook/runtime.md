# Runtime, performance and postmortems

What is known about the server at run time: the per-request cost, the DoS bounds, the output-schema postmortem, real workerd, the benchmarks and what the production dashboard showed.

## Performance benchmarks (CodSpeed)

`pnpm bench` runs `vitest bench` in every package; CI runs the same command
once through the CodSpeed action (.github/workflows/codspeed.yml, simulation
mode, OIDC — no token secret) and comments the diff on the PR. Each package
carries a `vitest.config.ts` whose only job is registering
`@codspeed/vitest-plugin`; the plugin is inert unless CODSPEED_ENV is set, so
`vitest run` behaves exactly as it did when the packages had no config at all.

What is measured, and why those and not others — every one of them is a path
this file already argues about in prose:

- gw-template `bench/codec.bench.ts`: decode/encode/round-trip on the golden
  corpus, plus the zero-tail scan on a 10k-char padded code (the GW1-01/GW1-02
  hardening).
- gw-data `bench/repository.bench.ts`: name lookup, the three search shapes,
  and the fuzzy suggester — including the padded worst case that GW1-AUD-01
  bounded (the 109 ms -> 1.4 ms fix has a regression guard now).
- gw-mcp `bench/build.bench.ts`: resolve -> validate -> describe, plus
  `createServer` construction (the SDK round-trip benchmarks it once listed are
  gone) and the pwnd re-join on its worst-case input (quadratic until 2026-11-13).
- gw-worker `bench/startup.bench.ts`: `createApp` — route registration only,
  NOT the MCP server (see the CodSpeed section: it is the noise floor). The
  `bench/http.bench.ts` this list claimed until 2026-08-11 does not exist; the
  async JSON-RPC benchmark that reported 221 ms was removed and the entry was
  never updated. So there is NO committed benchmark of the `/mcp` request path,
  and a change to that hot path has to be measured against real workerd by hand
  (`wrangler dev --local`, time N sequential POSTs, compare medians against the
  same run on main — that is how the batch middleware was cleared: 3.02 ms vs
  3.03 ms p50 for `tools/list`, i.e. free).

Since vitest 5 (2026-11-13) `bench` is a TEST FIXTURE, not a top-level export, so
each bench file carries a five-line local `bench()` wrapper that registers one
`test` per benchmark — one benchmark per test on purpose, so each name stays its
own CodSpeed series. The wrapper is duplicated four times rather than shared
because gw-template has zero dependencies and a fifth package for five lines is
worse.

Benchmarks are measured, not asserted: nothing fails on a slow number, the
report is the signal. Keep them deterministic (no network, no clock, no
random input) — CodSpeed compares runs, so a benchmark that varies by input
is noise, not data.

## CodSpeed: the createApp benchmark is the noise floor

On 2026-08-01 CodSpeed failed a commit with a **16% regression on `createApp`**. The commit
changed one error-message string and some comments — code that benchmark never executes.
It was a false positive, and four things said so: CodSpeed's own "different runtime
environments" warning, a diff touching no executed path, every other benchmark drifting the
same direction (-3%, -1%) which is systematic rather than targeted, and `createApp` being
the smallest benchmark in the suite at roughly 1 ms.

Worth knowing what it measures, because the name oversells it: `createServer` is called
INSIDE the /mcp handler, not in `createApp`, so this covers route registration only —
0.07 ms against 2.0 ms locally, about **3.5% of real startup**. The number to watch for
isolate cost is `createServer`, which has its own benchmark.

**When it goes red**: check whether the whole run drifted, and look at `createServer`,
before believing route registration got slower. It was deliberately NOT deleted — removing
a benchmark because it flagged is how a suite stops being trusted — but its docblock now
says what it can and cannot tell you.

If this recurs often enough to be noise, the right fix is a CodSpeed threshold in the
dashboard, not a smaller suite.

## createServer() runs on every /mcp request (halved 2026-07-31)

Unavoidable: the SDK refuses to reuse a server across transports ("Already connected
to a transport"), for sequential AND concurrent, and `close()` cannot be called here —
it empties every response, since the body is lazy (see the B6 note in the worker).
Tested, not assumed.

|                                          | before       | after       |
| ---------------------------------------- | ------------ | ----------- |
| inside `registerTool`/`registerResource` | 2.70 ms      | 1.51 ms     |
| building the argument literals (zod)     | ~2.02 ms     | ~0 ms       |
| **`createServer()`**                     | **5.37 ms**  | **1.89 ms** |
| **full `tools/list` request**            | **18.68 ms** | **6.91 ms** |

Two changes, both free of concurrency risk because zod schemas are immutable values:
per-tool schema literals live at module scope, and the `z.object` wrappers are
pre-built (the SDK rebuilt all sixteen per request via `objectFromShape`). Zero `z.`
calls remain inside the function body — keep it that way. Each chained zod method
CLONES the schema, which is why one `z.string().max(64).describe(...)` costs 0.147 ms.

"Zero `z.` calls in the function body" was ASPIRATIONAL until 2026-08-11: three input
shapes (search_skills, decode_template, decode_pawned_team) were still inline and paid
the per-request cost this section says was removed. They are at module scope now, so
the sentence is literally true — check it rather than trusting it when adding a tool.

Verified byte-identical at the time: `tools/list` was 18 577 characters, and strictness
survives — an extra property in a structured result is still rejected. It went to 18 809
when inputs became `.strict()` (see the third-audit entry in the debt register), and is
**19 409 today, LOCKED by a test** — `conventions.test.ts` asserts the exact character
count and fails on any movement in either direction.

The lock exists because of how the number drifted. Between 18 809 and the audit of
2026-08-17 it had reached 19 358, and 312 of those 549 characters were the SDK newly
emitting `"execution":{"taskSupport":"forbidden"}` on each of the eight tools. Nobody
decided that; it arrived with a version bump. This file measures the number carefully
whenever WE change the tool surface and not at all when a dependency does, so the one
direction the process could not see was the one that moved. An upper bound would not
have helped — it passes silently until it does not, the same "green means nothing
happened" trap the weekly data job fell into twice. Exact equality is the point: when
it fails, either you changed the surface (update the constant and this figure in the
same commit, as the failure message says) or something upstream did, and you want to
know which. The remaining 60 characters are decode_template's description gaining its
whitespace-tolerance sentence, in the same change that added the lock.

It has since fired exactly as designed, on a dependency and in the SHRINKING direction
(2026-08-31, zod 4.4 -> 4.5, -323 characters — see debt #10). Worth noting because an
upper bound would have let it through silently, and because smaller is not automatically
safe: the same delta would fit a schema that had quietly lost a constraint. What made it
acceptable was normalising both notations and finding the schemas deep-equal, not the
sign of the number.

## DoS bounds on decode_pawned_team (2026-07-31)

The blob was capped at 256 KiB and nothing else, but the container turns blob SIZE
into slot COUNT: 262 000 bytes of filler parses into 29 112 slots, each decoded and
described. One request cost **409.7 ms of CPU and a 12.9 MB response** against a 10 ms
cap. Now 1.0 ms.

- `MAX_PWND_SLOTS = 12` — a team is a player plus seven heroes. Rejecting beats
  truncating: 29 112 slots is not a team.
- `MAX_PWND_BLOB_LEN = 8192` (16384 until 2026-11-13, now derived from the format:
  see schemas.ts) — the original 256 KiB cap was **817x** a real blob (321 characters
  for four slots). Needed separately: the container parse runs before any slot count
  is known.
- `MAX_TEMPLATE_CODE_LEN = 128` on the `code` argument only. NOT on pwnd slots — the
  format encodes each field's length in one base64 character, so 63 is the structural
  maximum. A guard there was unreachable and removed; a test records why.

Found by the benchmark suite, which 313 tests could not do: nothing was wrong,
something was unbounded.

**The same class recurred twice on 2026-08-08**, so treat it as the project's
characteristic failure rather than a one-off. A guard is only as good as the unit it
counts: `bodyLimit` counted bytes on one of two equivalent PATHS (audit M1), and the
rate limiter counted HTTP REQUESTS while a JSON-RPC batch carried 3100 operations
inside one (audit N1). When adding a bound, ask what unit the attacker controls and
whether anything else in the chain counts a different one.

## get_skill violated its own output schema (fixed 2026-07-31)

`fullSkill` used `...skill`, leaking six internal join keys into a strict schema, so
`get_skill` THREW for any client that calls `tools/list` first — which is every real
client. Three reasons nothing caught it, all worth keeping:

- **Typecheck cannot**: excess-property checks do not apply to spreads.
- **The tests could not**: they called tools without listing them first, leaving the
  SDK's output validators unprimed. The bug was invisible because tests are tidier
  than clients.
- **Production could not**: the demo ran `get_skill` through Claude Code successfully,
  so client-side validation is not universal.

So: never `...skill` in `results.ts`, and the conventions test lists tools before
calling all of them, asserting coverage of `TOOL_NAMES`.

**That lock had a hole for eight days, and it was in the assertion itself**: it read
`TOOL_NAMES.length - 1`, permanently exempting `decode_pawned_team` — the one tool no
primed-client test called (audit M3, 2026-08-08). Fixed, and `fullHero` was de-spread
at the same time (audit L5): its five keys lined up exactly today, but `heroes.json` is
regenerated weekly, so the next new overlay field would have re-run this postmortem
verbatim. Two lessons compound here: a completeness assertion with an arithmetic escape
hatch is not a completeness assertion, and "the keys happen to match" is not a contract.
The same test now also asserts every tool REJECTS an undeclared argument.

## workerd runs locally, and there are no compatibility flags

`pnpm --filter @gw1-mcp/gw-worker smoke` (added 2026-11-13, also a CI job) starts
`wrangler dev --local` on a free port and runs 22 HTTP checks against REAL workerd:
routes, the handshake, hardening headers on a streamed answer, a French lookup, an
encode/decode round trip, and every refusal (batch 400, text/plain 415, 413 on both
path spellings, unknown argument, hostile pwnd). It is the manual pass this section
describes, kept. When adding a check, stay far below 100 requests — the limiter is
emulated and 429s will look like bugs.

`pnpm --filter @gw1-mcp/gw-worker exec wrangler dev --local` starts the REAL workerd by hand.
Use it: any claim hedged with "measured under Node" can be checked properly, and the
gap has been material twice — `tools/list` measured ~17 ms under Node against 7.66 ms
in production, and an async benchmark reported 221 ms for the same call.

**The rate limiter IS emulated locally**, contrary to what this section said until
2026-08-11: 120 sequential POSTs to a fresh `wrangler dev --local` returned 94x 200 and
26x 429, which is the 100/min binding doing its job. Worth knowing in both directions —
the limiter can be exercised for real, and a probe loop of more than 100 requests will
start getting 429s that look like a bug in whatever is being tested (it cost one
confusing measurement). Analytics Engine remains the binding that is not exercised.

Reading response codes off real workerd also caught something the unit suite did not:
the batch middleware answered 400 for a `text/plain` body starting with "[", where the
transport answers 415. A middleware that inspects the BODY has to respect the
content-type contract of the layer below it.

`nodejs_compat` was removed 2026-07-31 after proving it did nothing: the bundle has no
`node:` specifier, no unenv polyfill and no Node global (the only matches are
`$ZodPreprocess` and Web-standard `arrayBuffer`), it is byte-identical with and without
the flag, and every route and tool answers under real workerd without it.

Removing it is a guardrail, not tidiness: with the flag, a dependency that quietly
needs a Node API is silently polyfilled by unenv and fails later at the call site.
Without it, it fails to resolve at build time. If something legitimately needs Node
APIs, add the flag back deliberately — `nodejs_als` exists if only AsyncLocalStorage
is wanted.

## What the production dashboard says (2026-07-31)

- **Traffic is entirely automated.** `clientInfo` names 15 callers on `initialize`,
  none of them human. `glimind-probe` alone is 63% of connections, matching the 65%
  the user-agents showed independently. The 95% "protocol overhead" is that, not a
  mystery.
- **The French alias table (J1 path 3) was closed as NO here, and REOPENED on
  2026-08-31 — read the two together, they answer different questions.** The
  dashboard evidence stands: 198 resolved lookups against 2 missed, both misses
  most likely our own probes, so nothing was failing for want of French. What
  reopened it was not new traffic but a new SOURCE (see Game data); the standing
  decision was gated on availability, and this panel was measuring demand. Worth
  keeping as a pair, because a number this clean is easy to mistake for an answer
  to whichever question is being asked. Note also what it could not see: a caller
  whose LLM translates a French name to English before calling arrives here as a
  resolved English lookup, so "no missed French lookups" was never evidence that
  no French was being typed at the other end.
- **`ATTRIBUTE_POINTS_EXCEEDED` was the top validation failure, and the cause was
  ours**: `RANK_COST` lived only in `validate.ts`, and the costs are non-linear (rank
  12 costs 97, so 12/12 spends 194 of 200 and three lines at 12 is impossible). The
  table is now in the error message and the bundled skill. Neither adds fixed context.

Caveat: the skill and hero rankings are dominated by our own testing and say nothing
about users yet. Their panel descriptions say so.
