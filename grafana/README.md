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

## Grafana Cloud Free tier: retention does NOT apply here

Grafana Cloud Free caps retention at 14 days for metrics, logs, traces and
profiles. **That limit is irrelevant to this dashboard, and the panels must
not be shortened to match it.**

Nothing here is ingested into Grafana. Infinity is a query-time data source:
every panel issues an HTTP POST to Cloudflare's Analytics Engine SQL API and
renders the response. No series are stored, no Loki streams are written, and
none of the Free-tier usage meters are touched. The only retention that binds
is **Cloudflare Analytics Engine's 90 days**, which is a property of the
worker's `analytics_engine_datasets` binding — not of the Grafana plan.

So the dashboard's `now-30d` default is fine and could go to `now-90d`. Past
90 days the API returns nothing regardless of plan.

Git Sync itself **does work on the Free plan** — verified 2026-07-29: the
repository reports "Up-to-date" with 1 dashboard and 1 folder synced. Free
applies quotas rather than a paywall: **1 connected repository, 20 synced
resources per repository**. Comfortable for this folder, but that is the ceiling
to watch if more dashboards are ever added here.

If those quotas are ever reached, the fallback needs no plan at all: the
dashboard JSON here is a plain export, so Dashboards -> New -> Import (paste the
file) reproduces it, and "Export for sharing externally" produces the file to
commit back. Manual, but the repo stays the source of truth.

## Known residue in the data (not a bug)

"Calls per tool" shows two `tool:__verifymcp_auth_probe_<hex>` entries at one
call each. Those are pre-existing rows, not a live leak: the worker has bucketed
every unrecognised tool name into `tool:_unknown` since 2026-07-15 (commit
0254efc), precisely so that probing a public endpoint cannot inject labels into
this dashboard. The probe rows predate that fix, and Analytics Engine is
append-only, so they cannot be deleted — they age out of the 90-day window on
their own.

"Distinct tools used" now excludes `tool:_unknown`, so scanners no longer inflate
it. The two legacy rows will still add 2 until they fall outside the selected
range.

**Formatting note:** oxfmt deliberately ignores `grafana/*.json`. Grafana is
the owning serializer of these files — a Save in the UI commits back its own
export format (bidirectional Git Sync), and two formatters fighting over one
file would produce phantom diffs and red CI on Grafana's PRs. Same rule as
the generated data files: the tool that round-trips a file owns its format.

## Copying a panel carries its field selector

Three panels rendered "No data" while their rows existed, and the cause was mine:
each new panel was created by copying an existing one's wiring, which includes
`options.reduceOptions.fields`. In the panel it came from that was `"/calls/"` — a
regex naming its value column. The new panels then aliased their value columns
`connections`, `hits` and `lookups` for readability, so the bar gauge was told to
reduce a field that did not exist.

Diagnosed rather than guessed: querying Analytics Engine directly showed the data
was there — 15 distinct clients in `blob2`, 96 entities in `blob6`, seven codes in
`blob5`. Data present plus empty panel points at the panel, not the pipeline.

So when adding a panel: either name the value column `calls`, or update
`reduceOptions.fields` to match. The stat panels (11-14) use `fields: ""`, meaning
every numeric field, and must stay that way — narrowing them would break panels
that work.
