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
3. Open it and pick your Altinity ClickHouse datasource in the
   `datasource` variable (top of the dashboard) — the panels bind to it.

The underlying queries live in `docs/analytics-queries.md` with the two
rules that matter (`SUM(_sample_interval)`, 90-day retention).

**Formatting note:** oxfmt deliberately ignores `grafana/*.json`. Grafana is
the owning serializer of these files — a Save in the UI commits back its own
export format (bidirectional Git Sync), and two formatters fighting over one
file would produce phantom diffs and red CI on Grafana's PRs. Same rule as
the generated data files: the tool that round-trips a file owns its format.
