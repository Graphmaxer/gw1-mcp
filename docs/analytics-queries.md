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

## Who actually calls this server (Workers Logs, measured 2026-07-29)

The Analytics Engine dataset records a method/tool label and nothing about the
caller, by design. Caller identity lives in Workers Logs instead, queryable in
the dashboard under Observability with `$workers.event.request.headers.user-agent`.
Over 7 days:

| Caller                          | Requests | What it is                                                                                                                                              |
| ------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SentinelOracle/0.1`            | 5 662    | uptime monitor; `initialize` → `notifications/initialized` → `tools/list` every ~5 min, and it says so in its UA ("liveness-only, never invokes tools") |
| `python-httpx/0.28.1`           | 1 276    | unattributed generic client                                                                                                                             |
| `node`                          | 1 178    | unattributed generic client                                                                                                                             |
| `aisec-registry/0.2`            | 1 044    | security scanner (sec.sqrx.io)                                                                                                                          |
| `AgenstryBot/0.3.0`             | 330      | self-identified crawler                                                                                                                                 |
| `agent-tools.cloud-crawler/0.1` | 280      | directory crawler                                                                                                                                       |
| `ClaudeBot/1.0`                 | 147      | Anthropic's **web** crawler, not MCP traffic                                                                                                            |
| `MCPScoringEngine/1.0`          | 135      | scores MCP servers                                                                                                                                      |
| `402explorer/0.1`               | 121      | probes for payment-required support                                                                                                                     |
| `io.verifymcp/probe`            | 72       | source of the `tool:__verifymcp_auth_probe_*` labels in Grafana                                                                                         |

**This is why the "Protocol overhead share" panel reads ~97.5%.** One uptime
monitor is roughly 65% of all traffic and never calls a tool. The panel is
accurate but easy to misread as "directories are evaluating us": it is mostly a
health check. Reading real usage requires excluding monitors, which needs a
client dimension in the dataset that does not exist yet.

### The 404s in the logs are correct — do not "fix" them

`aisec-registry` probes three paths, 261 times each, all 404:

```
/mcp/.well-known/oauth-authorization-server
/mcp/.well-known/oauth-protected-resource
/mcp/.well-known/mcp
```

The first two are MCP authorization discovery (correctly probed relative to the
`/mcp` endpoint path, not the domain root). **This server has no authentication,
so it is not a protected resource and has no authorization server to advertise.**
404 is the answer that tells a client "no auth required", and the same crawler's
261 `POST /mcp` calls all return 200 — its functional request works.

Serving those documents would be worse than a 404: it would advertise an
authorization server that does not exist, and a client following that pointer
would try to authenticate and fail. If auth is ever added, these are the
endpoints to implement — not before.

### One 404 that IS a bug: `/.well-known/glama.json`

`undici` (Node's HTTP client, i.e. Glama's crawler) requested
`/.well-known/glama.json` 43 times in 7 days and got 404 every time. The only
code path that 404s there is `GLAMA_MAINTAINER_EMAIL` being unset, so **connector
ownership verification has never worked in production** — a dash-side variable
that was never set, failing silently. See debt #1.

This is the lesson of the whole exercise: three suspicions (405s breaking health
checks, missing manifests, directories hammering us) all dissolved under
measurement, and the one real defect was something nobody suspected, visible only
because a crawler kept retrying.

### The other real bug: `/mcp/` with a trailing slash 404'd

21 requests in 7 days hit `/mcp` and got a 404, which should have been
impossible: POST works, GET and DELETE answer 405, and `app.all` catches the
rest. Reproduced locally — Hono routes **`/mcp/` as a path distinct from
`/mcp`**, so any client that builds its URL by joining a trailing slash fell
through every route and got a bare 404. It failed outright; there was no
fallback. (`/MCP` also 404s, correctly: paths are case-sensitive.)

Fixed by registering every middleware and handler against both spellings through
a single list, so the two cannot drift apart, with tests asserting identical
behaviour on both for the tool call, the hardening headers, the GET 405, the
preflight and the origin rejection.

Note the contrast with the section below: here the capability existed and only
the path spelling differed, so accepting both is interoperability. Serving a
discovery document for an interface that does not exist would be a false claim.

### Manifests deliberately NOT served

One scanner brute-forces roughly twenty agent-discovery conventions, ~11 hits
each: `/.well-known/ai-plugin.json`, `/a2a.json`, `/agent-card.json`,
`/agent.json`, `/agent`, `/.well-known/agent.json`, `/.well-known/agents.json`,
`/.well-known/ai-agent.json`, `/.well-known/mcp.json`, `/.well-known/did.json`,
`/.well-known/x402`, `/openrpc.json`, `/api/agent.json`, `/api/agent-card.json`,
`/agents/agent-card.json`, `/a2a/.well-known/agent-card.json`,
`/agent/authenticatedExtendedCard` and more. The uniform count reveals a single
crawler working through a path list, not many directories each wanting a file. None are served, on purpose: the ChatGPT plugin manifest
is superseded by Apps/MCP, the A2A agent cards would describe an agent this is
not, and `/.well-known/mcp.json` has no schema in the MCP specification. Same
rule as the OAuth endpoints — do not advertise an interface you do not implement.

`robots.txt` IS now served (ClaudeBot asked ~10x/day), disallowing `/mcp` since a
crawler fetching a POST-only JSON-RPC endpoint gets a 405 and learns nothing. No
`sitemap.xml`: four static routes do not warrant one, and advertising a sitemap
that does not exist would be worse than the 404.

### The 405s are not a problem either

250 over 7 days (~36/day against ~1 600/day), from `GET /mcp`, which returns 405
because the server is stateless (see the B2 note in the app). `node` receives
405s on GET **and** succeeds with 760 POSTs — clients fall back correctly. This
was investigated as a possible directory-health-check failure and the data does
not support it.
