# Usage analytics queries (Workers Analytics Engine)

Saved queries for the `gw1_mcp_usage` dataset (written by the worker's
`MCP_ANALYTICS` binding — tool NAME only, never arguments; see `/privacy`).

**Where to run them:** the Cloudflare dash SQL editor (Storage & Databases →
Analytics Engine), or the SQL API:

```sh
curl -s "https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/analytics_engine/sql" \
  -H "Authorization: Bearer <API_TOKEN>" \
  -d "<query>"
```

(`API_TOKEN` needs _Account Analytics: Read_ only.)

**Two rules that trip everyone up:**

1. **Sampling.** Always `SUM(_sample_interval)`, never `COUNT()` — Analytics
   Engine samples under load and `_sample_interval` is the statistical
   multiplier that keeps totals accurate.
2. **Retention is 90 days**, not configurable. For longer history, snapshot
   aggregates elsewhere before they age out.

Schema reminder: `blob1` = label (`tool:<name>` for tools/call,
`rpc:<method>` for everything else), `double1` = 1, `index1` = label.

## Calls per tool, last 7 days

```sql
SELECT blob1 AS label, SUM(_sample_interval) AS calls
FROM gw1_mcp_usage
WHERE timestamp > NOW() - INTERVAL '7' DAY
GROUP BY label
ORDER BY calls DESC
```

## Daily time series per tool, last 30 days

```sql
SELECT toStartOfInterval(timestamp, INTERVAL '1' DAY) AS day,
       blob1 AS label,
       SUM(_sample_interval) AS calls
FROM gw1_mcp_usage
WHERE timestamp > NOW() - INTERVAL '30' DAY
  AND blob1 LIKE 'tool:%'
GROUP BY day, label
ORDER BY day, calls DESC
```

## Tools vs protocol overhead (initialize, resource reads…), last 7 days

```sql
SELECT if(blob1 LIKE 'tool:%', 'tool calls', 'protocol') AS kind,
       SUM(_sample_interval) AS calls
FROM gw1_mcp_usage
WHERE timestamp > NOW() - INTERVAL '7' DAY
GROUP BY kind
```

## Hourly pulse of the last 48h (did the Reddit post land?)

```sql
SELECT toStartOfInterval(timestamp, INTERVAL '1' HOUR) AS hour,
       SUM(_sample_interval) AS calls
FROM gw1_mcp_usage
WHERE timestamp > NOW() - INTERVAL '2' DAY
GROUP BY hour
ORDER BY hour
```

## Grafana (Infinity datasource) specifics

The public dashboard (`grafana/gw1-mcp-usage.json`) runs these same
queries through the **Infinity** plugin (generic HTTP+JSON — a native
ClickHouse plugin cannot connect, Analytics Engine only implements a
partial dialect over HTTP). Three adaptations apply there, and only
there:

1. **Time range**: no `$timeFilter` macro. Use Infinity's backend
   macros, divided to seconds (`toDateTime()` takes epoch seconds,
   the macros emit milliseconds — this exact pair was verified against
   the live API, `fromUnixTimestamp64Milli` does **not** exist in
   Cloudflare's dialect):

   ```sql
   WHERE timestamp > toDateTime(${__timeFrom} / 1000)
     AND timestamp < toDateTime(${__timeTo} / 1000)
   ```

2. **Response envelope**: the SQL API returns
   `{"meta": [...], "data": [...], "rows": N, "rows_before_limit_at_least": N}`.
   Set the query's **root selector to `data`**, otherwise Infinity maps
   the envelope fields themselves as columns (a Stat panel then shows
   `rows_before_limit_at_least` — misleadingly plausible numbers).

3. **UInt64 as strings**: aggregates like `SUM(_sample_interval)` are
   serialized as JSON strings (`"calls":"81"`). Map each numeric column
   explicitly as **Number** (and time buckets as **Timestamp**, format
   `2006-01-02 15:04:05`) in the query's column mapping; parser must be
   **Backend** for root selector + column mapping + macros to work.

## Who calls this server, and what not to "fix"

Caller identity is not in the Analytics Engine dataset by design; it lives in Workers
Logs, queryable in the dashboard on
`$workers.event.request.headers.user-agent`. Measured over 7 days in July 2026:
`SentinelOracle` 5 662, `python-httpx` 1 276, `node` 1 178, `aisec-registry` 1 044,
then `AgenstryBot`, `agent-tools.cloud-crawler`, `ClaudeBot`, `MCPScoringEngine`,
`402explorer` and `io.verifymcp/probe` in the low hundreds.

**`SentinelOracle` alone is about 65% of all traffic** and its own user-agent says
"liveness-only, never invokes tools" — it runs `initialize` →
`notifications/initialized` → `tools/list` every five minutes. That, not directory
interest, is why "Protocol overhead share" reads ~97.5%. The panel is accurate and
easy to misread.

Three classes of failure in the logs are correct behaviour and must not be
"repaired":

- **`/mcp/.well-known/oauth-*` → 404.** This server has no authentication, so it is
  not a protected resource and has no authorization server to advertise. 404 is what
  tells a client no auth is required, and the same crawler's `POST /mcp` calls all
  succeed. Serving those documents would advertise an authorization server that does
  not exist and break any client following the pointer.
- **`GET /mcp` → 405.** The server is stateless: nothing to stream, nothing to
  resume. ~36/day against ~1 600, and clients that try GET fall back to POST
  successfully.
- **~20 agent-manifest paths → 404** (`ai-plugin.json`, `a2a.json`,
  `agent-card.json`, `.well-known/mcp.json`, `.well-known/did.json` and so on). One
  scanner working through a path list — the uniform hit count gives it away — not
  many directories each wanting a file. Do not advertise an interface that does not
  exist.

`robots.txt` IS served (asked for ~10x/day), disallowing `/mcp` since a crawler
fetching a POST-only endpoint learns nothing. No `sitemap.xml`: four static routes do
not warrant one.

Two real defects came out of the same exercise and are fixed: `/mcp/` with a trailing
slash returned a bare 404 because Hono routes it as a distinct path, and
`/.well-known/glama.json` 404'd because a dashboard variable was never set — that
route has since been removed deliberately (see the debt register).

## Client attribution (`blob2`, added 2026-07-29)

`blob2` carries the sanitised `clientInfo.name` of each `initialize`, and is empty
on every other row.

**Why `clientInfo` and not the user-agent.** The user-agent is already in Workers
Logs, so copying it here would only buy retention, not information — and it
answers the wrong question: it names the HTTP library, not the software. That is
the whole problem with the 2 454 requests a week arriving as `node` and
`python-httpx` (~30% of traffic), which could be real MCP clients or more robots.
`clientInfo` is the field the MCP specification provides for exactly this.

**Why only `initialize` is attributed.** It is the one message carrying
`clientInfo`, and a stateless server has no session to attach it to afterwards, so
a `tools/call` cannot be traced to its caller. That turns out not to matter:
counting connections per client against tool calls overall separates the profiles.
SentinelOracle made 1 620 `initialize` calls and zero tool calls in a week — an
unmistakable monitor. A real user shows few connections and many calls.

**Sanitised, not whitelisted.** A whitelist would need hand-maintaining and would
bucket every new client as `_other`, defeating the purpose. Blob cardinality is
explicitly unlimited in Analytics Engine — the _index_ is what triggers sampling,
and the index is unchanged here. But `clientInfo.name` is caller-controlled and
this dashboard is public, so the value is charset-restricted (anything outside
letters, digits and `. _ @ -` becomes a space), whitespace-collapsed and cut to 64
characters. The version is dropped deliberately: the name answers the question, a
version only adds fingerprinting. A missing name records `_unnamed` rather than
"", so "no name given" stays distinguishable from "not an initialize".

**Honest limits.** A client can lie or send a generic name, so this improves
attribution rather than guaranteeing it. And the `Protocol overhead share` panel
still counts monitors — computing it net of monitors is now possible, but the
panel has not been changed, because it needs weeks of `blob2` data first.

## Domain events (`event:tool_call`, added 2026-07-29)

Tool outcomes are recorded as a **separate data point** under
`blob1 = 'event:tool_call'`. Reusing `tool:<name>` would double every count in
the six panels that sum `blob1 LIKE 'tool:%'` — a test asserts exactly one
`tool:` point per call.

Blob layout for this dataset; each position carries one meaning, unused positions
are simply absent:

| blob | meaning                                                  |
| ---- | -------------------------------------------------------- |
| 1    | kind: `tool:<name>` / `rpc:<method>` / `event:tool_call` |
| 2    | client name, on `rpc:initialize` only                    |
| 3    | tool that ran                                            |
| 4    | `ok` / `error`                                           |
| 5    | our own error or first validation code                   |
| 6    | canonical entity resolved from our data                  |
| 7    | context flags the caller set, space separated            |

### The boundary, and why it is shaped this way

`gw-mcp` exposes `createServer({ onToolCall })` emitting a `ToolCallEvent`, and
knows **nothing** about Analytics Engine, blobs or dashboards — it reports what
happened; the worker decides how to store it. That keeps gw-mcp usable over stdio
and in tests with no Cloudflare types anywhere. The tests for this live in gw-mcp
and mention no infrastructure at all: if they ever need a Cloudflare type, the
boundary has been broken.

Registration goes through one wrapper, so instrumentation cannot be forgotten when
a ninth tool is added, and all eight call sites keep their exact types. The
observer is wrapped in try/catch: an observer must never break a tool call.

### Why events are derived from the RESULT, not the request

An entity name taken from `structuredContent` has been resolved against our
dataset; the argument is whatever the caller typed. Same for codes, which come
from our own enums. That is what makes these values safe to store somewhere
public — the same rule that buckets unknown tool names into `tool:_unknown`.

Deliberately **not** captured: the template code `encode_template` produces. It is
derived from caller input and carries no aggregate meaning; a test asserts no long
base64-ish string ever appears in an event.

Note that a requested report is a successful call: `validate_build` returning
`valid: false` means the caller asked for a verdict and got one, so `ok` stays
true and the first error code is recorded. That mirrors the isError policy the
server already documents.

### What each panel is actually for

- **Name lookups: resolved vs missed** — the one metric that decides an open
  question. The `error` share measures in production how often callers ask for
  something unresolvable (French names, abbreviations), which is the evidence the
  French alias table decision has been waiting for.
- **Top validation failures** — which GW1 rules assistants get wrong most, by our
  own codes. Actionable: it is what the bundled skill and the tool descriptions
  should pre-empt.
- **Context flags used** — whether hero bars, PvP bars and account exports are
  actually exercised.
- **Most requested skills and heroes** — curiosity, not a decision input, and
  noisy until real usage outweighs probes. Recorded because it is free.
