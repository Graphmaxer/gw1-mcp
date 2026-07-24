# Grafana dashboards (Git Sync)

This folder is meant to be provisioned into Grafana via **Git Sync**
(GA since April 2026 on Grafana Cloud): connect the instance to this
repository and dashboards here become live — bidirectionally (edits in
the Grafana UI commit back here through the normal PR workflow, so the
repo rulesets apply to dashboard changes too).

## One-time connection (Grafana Cloud)

1. Grafana → **Administration → Provisioning** → connect **GitHub**
   (GitHub App auth), repository `Graphmaxer/gw1-mcp`, path `grafana/`.
2. Sync. `gw1-mcp-usage.json` appears as a provisioned dashboard.
3. Create an **Infinity** datasource (`yesoreyeram-infinity-datasource`)
   pointed at the Cloudflare Analytics Engine SQL API:
   - **Base URL**:
     `https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/analytics_engine/sql`
   - **Auth**: Bearer token (Cloudflare API token with
     _Account Analytics: Read_ only)
   - **Allowed hosts**: add `https://api.cloudflare.com` (Grafana flags
     the datasource as insecure otherwise)

   The panels reference the datasource by uid; after provisioning on a
   fresh instance, re-point them (or edit the uid in the JSON).

## Why Infinity, not a ClickHouse plugin

Analytics Engine speaks a **partial ClickHouse dialect over plain
HTTP** — it is not a ClickHouse server. Native/HTTP ClickHouse plugins
fail on the protocol handshake, and Infinity is on Grafana's confirmed
list for publicly shared dashboards. Three consequences for panel
queries (full notes in `docs/analytics-queries.md`):

1. **No `$timeFilter` macro** (that is a ClickHouse-plugin feature).
   Panels use Infinity's server-side macros instead, divided to seconds
   because Cloudflare's `toDateTime()` takes epoch **seconds**:
   `timestamp > toDateTime(${__timeFrom} / 1000) AND timestamp < toDateTime(${__timeTo} / 1000)`
2. **Root selector `data`**: the SQL API wraps rows in a
   `{meta, data, rows, rows_before_limit_at_least}` envelope; without
   the selector, Infinity surfaces the envelope fields as columns.
3. **Explicit column types**: `UInt64` aggregates come back as JSON
   _strings_ (`"calls":"81"`), so every numeric column is mapped as
   Number in the query's column mapping.

The underlying queries live in `docs/analytics-queries.md` with the two
rules that matter (`SUM(_sample_interval)`, 90-day retention).

**Formatting note:** oxfmt deliberately ignores `grafana/*.json`. Grafana is
the owning serializer of these files — a Save in the UI commits back its own
export format (bidirectional Git Sync), and two formatters fighting over one
file would produce phantom diffs and red CI on Grafana's PRs. Same rule as
the generated data files: the tool that round-trips a file owns its format.
