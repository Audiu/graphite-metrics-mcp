# graphite-metrics-mcp

[![CI](https://github.com/Audiu/graphite-metrics-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/Audiu/graphite-metrics-mcp/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/graphite-metrics-mcp)](https://www.npmjs.com/package/graphite-metrics-mcp)

An [MCP](https://modelcontextprotocol.io) server for querying [Graphite](https://graphiteapp.org) metrics from
Claude Code, Claude Desktop or any other MCP client. It lets an agent browse and search your metric tree, run
Graphite render expressions and read the results. Results come back as compact summaries (min, max, avg, sum,
first and last, each with timestamps) plus downsampled datapoints, not thousands of raw points.

It talks to the standard graphite-web HTTP API (`/metrics/find`, `/metrics/index.json`, `/render`, `/functions`),
so it works with stock graphite-web and anything that implements the same API. Tested against graphite-web 1.1.

## Tools

| Tool                      | What it does                                                                                                                                                                              |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `graphite_find_metrics`   | Browse the metric tree one level at a time (`servers.web1` lists its children; globs like `stats.*.requests.*` work too).                                                                 |
| `graphite_search_metrics` | Substring or regex search over every metric path (uses `/metrics/index.json`, cached for 5 minutes).                                                                                      |
| `graphite_query`          | Render one or more targets (any Graphite expression). Returns per-series stats over the full-resolution data, plus datapoints consolidated into clock-aligned buckets (15min, 1h, 1d, …). |
| `graphite_list_functions` | List the render functions the server supports, or get full docs for one.                                                                                                                  |

All tools are read-only.

### `graphite_query` options

| Option          | Default       | Notes                                                                                                                                |
| --------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `targets`       | —             | Array of target expressions, e.g. `sumSeries(app.*.requests.count)`, `summarize(signups.count, '1d', 'sum')`.                        |
| `from`, `until` | `-24h`, `now` | Graphite syntax (`-1h`, `-7d`, `now`, `yesterday`), epoch seconds, or ISO-8601. An ISO datetime without an offset is treated as UTC. |
| `maxDataPoints` | `100`         | Datapoints returned per series. Longer series are consolidated.                                                                      |
| `consolidateBy` | `avg`         | `avg`, `sum`, `min`, `max` or `last`. Use `sum` for counters.                                                                        |
| `summaryOnly`   | `false`       | Return only the stats. Useful for wide wildcard queries.                                                                             |
| `maxSeries`     | `25`          | Maximum number of series to return.                                                                                                  |

Stats are always computed over the full-resolution data, before consolidation, so `sum` is the true total for the
range.

## Configuration

Configuration is read from environment variables:

| Variable                           | Required | Description                                                                                                         |
| ---------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------- |
| `GRAPHITE_URL`                     | yes      | Base URL of graphite-web, including any path prefix, e.g. `http://graphite.internal:8080`.                          |
| `GRAPHITE_USERNAME`                | no       | HTTP basic auth username. You can also embed credentials in the URL (`http://user:pass@host`).                      |
| `GRAPHITE_PASSWORD`                | no       | HTTP basic auth password.                                                                                           |
| `GRAPHITE_HEADERS`                 | no       | JSON object of extra headers sent with every request, e.g. `{"Authorization":"Bearer abc"}` for a proxy or Grafana. |
| `GRAPHITE_TIMEOUT_MS`              | no       | Request timeout in milliseconds (default `30000`, `0` disables it).                                                 |
| `GRAPHITE_INDEX_CACHE_TTL_SECONDS` | no       | How long the metric index used by search is cached (default `300`).                                                 |

For a server with a self-signed certificate, set `NODE_EXTRA_CA_CERTS=/path/to/ca.pem`.

## Usage

Requires Node.js 22 or later.

### Claude Code

```bash
claude mcp add graphite --scope user \
  -e GRAPHITE_URL=http://graphite.internal:8080 \
  -e GRAPHITE_USERNAME=me \
  -e GRAPHITE_PASSWORD=secret \
  -- npx -y graphite-metrics-mcp
```

Restart Claude Code, check `/mcp` lists `graphite` as connected, then ask something like _"what did request volume
look like over the last 24 hours?"_

### Claude Desktop and other clients

```json
{
    "mcpServers": {
        "graphite": {
            "command": "npx",
            "args": ["-y", "graphite-metrics-mcp"],
            "env": {
                "GRAPHITE_URL": "http://graphite.internal:8080",
                "GRAPHITE_USERNAME": "me",
                "GRAPHITE_PASSWORD": "secret"
            }
        }
    }
}
```

### From source

```bash
git clone https://github.com/Audiu/graphite-metrics-mcp.git && cd graphite-metrics-mcp
npm ci && npm run build
```

Then use `node /absolute/path/to/graphite-metrics-mcp/dist/index.js` in place of `npx -y graphite-metrics-mcp`.

## Tips for StatsD users

StatsD and statsite counters are stored as counts per flush interval. To get totals, sum them with
`summarize(x, '1h', 'sum')` or `consolidateBy: "sum"`. Averaging them understates the total. The server's MCP
instructions tell the agent this too.

To save the agent from browsing every time, record where your metrics live (for example
`statsite.counts.prod.myapp.*`) in your project's `CLAUDE.md`.

## Development

```bash
npm ci
npm run check     # typecheck, tests, build
```

### Testing locally

No Graphite to hand? `npm run demo:graphite` starts a throwaway Graphite in Docker and seeds 6 hours of
`demo.*` metrics: three web hosts with requests, latency and errors (including an incident two hours ago),
sign-ups and a queue depth gauge.

```bash
npm run demo:graphite

# Click through the tools in the MCP Inspector
GRAPHITE_URL=http://localhost:8080 npm run inspect

# Or point Claude Code at your local build
claude mcp add graphite-demo -e GRAPHITE_URL=http://localhost:8080 -- node "$PWD/dist/index.js"

npm run demo:graphite -- --stop
```

After changing the code, run `npm run build`, then reconnect the server from `/mcp` in Claude Code.

## License

MIT
