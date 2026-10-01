import { McpServer, type CallToolResult } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { GraphiteClient, type GraphiteFunction } from './graphite.js';
import { CONSOLIDATION_METHODS, summariseSeries } from './series.js';
import { isoFromEpoch, toGraphiteTime } from './time.js';

const INSTRUCTIONS = `Query a Graphite (graphite-web) time-series server.

Workflow:
1. Discover metric paths with graphite_search_metrics (substring search over every metric) or
   graphite_find_metrics (browse the dot-separated tree one level at a time).
2. Fetch data with graphite_query. Targets are Graphite render expressions: plain paths, globs
   (*, ?, [abc], {a,b}) and functions (sumSeries, summarize, timeShift, highestMax, ...).
   Use graphite_list_functions to check function names and signatures.

Times: Graphite relative syntax (-1h, -7d, -30min, now) or ISO-8601 (treated as UTC without an offset).
StatsD counters are per-flush-interval counts: for totals use summarize(x, '1h', 'sum') or
consolidateBy 'sum'; averaging them understates totals.`;

const readOnly = { readOnlyHint: true, idempotentHint: true, openWorldHint: true } as const;

export function createServer(client: GraphiteClient, version: string): McpServer {
    const server = new McpServer(
        { name: 'graphite', version },
        { capabilities: { tools: {} }, instructions: INSTRUCTIONS },
    );

    server.registerTool(
        'graphite_find_metrics',
        {
            title: 'Browse Graphite metrics',
            description:
                'List metric tree nodes matching a Graphite path pattern. A path without wildcards lists its children ' +
                '("servers.web1" lists "servers.web1.*"); omit the query to list top-level nodes. Supports *, ?, [abc] and ' +
                '{a,b} per segment (e.g. "stats.*.requests.*"). Branches can be browsed further; leaves are queryable series.',
            inputSchema: z.object({
                query: z.string().optional().describe('Path or glob pattern. Defaults to top level ("*").'),
                limit: z.number().int().min(1).max(5000).default(200).describe('Maximum nodes to return.'),
            }),
            annotations: readOnly,
        },
        ({ query, limit }) =>
            run(async () => {
                const pattern = normaliseFindQuery(query);
                const nodes = await client.find(pattern);
                const shown = nodes.slice(0, limit);
                return {
                    query: pattern,
                    total: nodes.length,
                    ...(nodes.length > limit && { truncated: true }),
                    branches: shown.filter((n) => !n.leaf).map((n) => n.id),
                    leaves: shown.filter((n) => n.leaf).map((n) => n.id),
                };
            }),
    );

    server.registerTool(
        'graphite_search_metrics',
        {
            title: 'Search Graphite metrics',
            description:
                'Search every metric path on the server (from /metrics/index.json, cached for a few minutes). ' +
                'Space-separated terms must all appear in the path (case-insensitive), or set regex to match a ' +
                'JavaScript regular expression. Useful when you know roughly what a metric is called but not where it lives.',
            inputSchema: z.object({
                query: z.string().min(1).describe('Search terms, e.g. "signup count", or a regex if regex=true.'),
                regex: z.boolean().default(false),
                limit: z.number().int().min(1).max(5000).default(100).describe('Maximum paths to return.'),
            }),
            annotations: readOnly,
        },
        ({ query, regex, limit }) =>
            run(async () => {
                const matcher = buildMatcher(query, regex);
                const metrics = await client.index();
                const matches = metrics.filter(matcher);
                return {
                    totalMetrics: metrics.length,
                    totalMatches: matches.length,
                    ...(matches.length > limit && { truncated: true }),
                    matches: matches.slice(0, limit),
                };
            }),
    );

    server.registerTool(
        'graphite_query',
        {
            title: 'Query Graphite series',
            description:
                'Fetch time-series data via /render. Each series returns stats computed over the full-resolution data ' +
                '(min/max/avg/sum/first/last, with timestamps) plus datapoints consolidated down to maxDataPoints ' +
                'buckets, aligned to clock boundaries (so the first and last bucket may cover a partial period). ' +
                'Targets accept any Graphite render expression, e.g. "sumSeries(app.*.requests.count)", ' +
                "\"summarize(stats.signups.count, '1d', 'sum')\", \"timeShift(app.latency.p95, '7d')\". " +
                'Use summaryOnly for wide wildcard queries, and Graphite functions (highestMax, sortByMaxima, limit) to narrow them.',
            inputSchema: z.object({
                targets: z.array(z.string().min(1)).min(1).max(100).describe('Graphite target expressions.'),
                from: z
                    .string()
                    .default('-24h')
                    .describe('Start time: -1h, -7d, ISO-8601, epoch seconds. Default -24h.'),
                until: z.string().default('now').describe('End time, same formats as from. Default now.'),
                maxDataPoints: z
                    .number()
                    .int()
                    .min(1)
                    .max(5000)
                    .default(100)
                    .describe('Datapoints per series to return; longer series are consolidated into buckets.'),
                consolidateBy: z
                    .enum(CONSOLIDATION_METHODS)
                    .default('avg')
                    .describe('How to merge points when consolidating. Use sum for counters, max for peaks.'),
                summaryOnly: z.boolean().default(false).describe('Return only stats, no datapoints.'),
                maxSeries: z.number().int().min(1).max(1000).default(25).describe('Maximum series to return.'),
            }),
            annotations: readOnly,
        },
        ({ targets, from, until, maxDataPoints, consolidateBy, summaryOnly, maxSeries }) =>
            run(async () => {
                const range = { from: toGraphiteTime(from, '-24h'), until: toGraphiteTime(until, 'now') };
                const series = await client.render(targets, range.from, range.until);
                const shown = series.slice(0, maxSeries);
                return {
                    from: describeTime(range.from),
                    until: describeTime(range.until),
                    totalSeries: series.length,
                    ...(series.length > maxSeries && {
                        truncated: `Showing ${maxSeries} of ${series.length} series. Raise maxSeries or narrow with highestMax()/limit().`,
                    }),
                    series: shown.map((s) => summariseSeries(s, { maxDataPoints, consolidateBy, summaryOnly })),
                };
            }),
    );

    server.registerTool(
        'graphite_list_functions',
        {
            title: 'List Graphite functions',
            description:
                'List the render functions this Graphite server supports, with signatures. Pass name for full ' +
                'documentation of one function, or search to filter by name/description.',
            inputSchema: z.object({
                name: z.string().optional().describe('Exact function name for full docs, e.g. "summarize".'),
                search: z.string().optional().describe('Case-insensitive filter on name, group and description.'),
            }),
            annotations: readOnly,
        },
        ({ name, search }) =>
            run(async () => {
                const functions = Object.values(await client.functions());
                if (name) {
                    const fn = functions.find((f) => f.name.toLowerCase() === name.toLowerCase());
                    if (!fn) {
                        throw new Error(`No function named "${name}". Use search to find similar functions.`);
                    }
                    return {
                        name: fn.name,
                        signature: fn.function,
                        group: fn.group,
                        description: fn.description,
                        params: fn.params,
                    };
                }
                const term = search?.toLowerCase();
                const matches = term
                    ? functions.filter((f) =>
                          [f.name, f.group, f.description].some((v) => v?.toLowerCase().includes(term)),
                      )
                    : functions;
                return {
                    total: matches.length,
                    functions: matches
                        .sort((a, b) => (a.group ?? '').localeCompare(b.group ?? '') || a.name.localeCompare(b.name))
                        .map((f) => ({ signature: f.function, group: f.group, summary: firstSentence(f) })),
                };
            }),
    );

    return server;
}

/** A bare path lists its children; empty means the top level. */
export function normaliseFindQuery(query: string | undefined): string {
    const trimmed = query?.trim().replace(/\.+$/, '') ?? '';
    if (!trimmed) {
        return '*';
    }
    return /[*?[{]/.test(trimmed) ? trimmed : `${trimmed}.*`;
}

export function buildMatcher(query: string, regex: boolean): (path: string) => boolean {
    if (regex) {
        let pattern: RegExp;
        try {
            pattern = new RegExp(query, 'i');
        } catch (error) {
            throw new Error(`Invalid regex: ${(error as Error).message}`);
        }
        return (path) => pattern.test(path);
    }
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    return (path) => {
        const lower = path.toLowerCase();
        return terms.every((term) => lower.includes(term));
    };
}

/** Echo epoch seconds back as ISO so the range is readable; leave relative times alone. */
function describeTime(value: string): string {
    return /^\d+$/.test(value) ? isoFromEpoch(Number(value)) : value;
}

function firstSentence(fn: GraphiteFunction): string | undefined {
    const text = fn.description?.replace(/\s+/g, ' ').trim();
    if (!text) {
        return undefined;
    }
    const end = text.search(/\.(\s|$)/);
    return end === -1 ? text.slice(0, 200) : text.slice(0, Math.min(end + 1, 200));
}

async function run(fn: () => Promise<unknown>): Promise<CallToolResult> {
    try {
        const result = await fn();
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    } catch (error) {
        return {
            isError: true,
            content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
        };
    }
}
