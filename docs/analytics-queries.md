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
