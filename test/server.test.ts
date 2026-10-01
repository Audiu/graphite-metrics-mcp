import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { afterEach, describe, expect, it } from 'vitest';
import { GraphiteClient } from '../src/graphite.js';
import { buildMatcher, createServer, normaliseFindQuery } from '../src/server.js';
import { fakeGraphite, testConfig } from './fakeGraphite.js';

const T0 = 1767225600; // 2026-01-01T00:00:00Z

const routes = {
    '/metrics/find': () => ({
        body: {
            metrics: [
                { path: 'app.web1.', name: 'web1', is_leaf: '0' },
                { path: 'app.web2.', name: 'web2', is_leaf: '0' },
                { path: 'app.uptime', name: 'uptime', is_leaf: '1' },
            ],
        },
    }),
    '/metrics/index.json': () => ({
        body: ['app.web1.requests.count', 'app.web2.requests.count', 'app.users.sign-ups.count', 'app.uptime'],
    }),
    '/render': () => ({
        body: [
            { target: 'app.web1.requests.count', datapoints: Array.from({ length: 360 }, (_, i) => [1, T0 + i * 10]) },
            { target: 'app.web2.requests.count', datapoints: Array.from({ length: 360 }, (_, i) => [2, T0 + i * 10]) },
        ],
    }),
    '/functions': () => ({
        body: {
            sumSeries: {
                name: 'sumSeries',
                function: 'sumSeries(*seriesLists)',
                group: 'Combine',
                description: 'Short form: sum(). This will add metrics together. More detail here.',
                params: [{ name: 'seriesLists', type: 'seriesList', multiple: true }],
            },
            summarize: {
                name: 'summarize',
                function: "summarize(seriesList, intervalString, func='sum')",
                group: 'Transform',
                description: 'Summarize the data into interval buckets of a certain size.',
            },
        },
    }),
};

let client: Client | undefined;

async function connect(fetchRoutes: Parameters<typeof fakeGraphite>[0] = routes) {
    const fake = fakeGraphite(fetchRoutes);
    const server = createServer(new GraphiteClient(testConfig, fake.fetchImpl), '0.0.0-test');
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    client = new Client({ name: 'test', version: '0' });
    await client.connect(clientTransport);
    return { client, requests: fake.requests };
}

async function call(
    name: string,
    args: Record<string, unknown> = {},
    fetchRoutes: Parameters<typeof fakeGraphite>[0] = routes,
) {
    const { client, requests } = await connect(fetchRoutes);
    const result = await client.callTool({ name, arguments: args });
    const text = (result.content as { type: string; text: string }[])[0].text;
    return { result, text, json: result.isError ? undefined : JSON.parse(text), requests };
}

afterEach(async () => {
    await client?.close();
    client = undefined;
});

describe('server', () => {
    it('lists read-only tools and instructions', async () => {
        const { client } = await connect();
        const { tools } = await client.listTools();

        expect(tools.map((t) => t.name).sort()).toEqual([
            'graphite_find_metrics',
            'graphite_list_functions',
            'graphite_query',
            'graphite_search_metrics',
        ]);
        expect(tools.every((t) => t.annotations?.readOnlyHint)).toBe(true);
        expect(client.getInstructions()).toMatch(/graphite_search_metrics/);
    });

    it('graphite_find_metrics splits branches and leaves', async () => {
        const { json, requests } = await call('graphite_find_metrics', { query: 'app' });
        expect(requests[0].params.get('query')).toBe('app.*');
        expect(json).toEqual({
            query: 'app.*',
            total: 3,
            branches: ['app.web1', 'app.web2'],
            leaves: ['app.uptime'],
        });
    });

    it('graphite_find_metrics truncates to limit', async () => {
        const { json } = await call('graphite_find_metrics', { limit: 1 });
        expect(json).toMatchObject({ total: 3, truncated: true, branches: ['app.web1'], leaves: [] });
    });

    it('graphite_search_metrics matches all terms case-insensitively', async () => {
        const { json } = await call('graphite_search_metrics', { query: 'REQUESTS web2' });
        expect(json).toEqual({ totalMetrics: 4, totalMatches: 1, matches: ['app.web2.requests.count'] });
    });

    it('graphite_search_metrics supports regex', async () => {
        const { json } = await call('graphite_search_metrics', { query: '^app\\.web\\d\\.', regex: true, limit: 1 });
        expect(json).toEqual({
            totalMetrics: 4,
            totalMatches: 2,
            truncated: true,
            matches: ['app.web1.requests.count'],
        });
    });

    it('graphite_query summarises and consolidates series', async () => {
        const { json, requests } = await call('graphite_query', {
            targets: ['app.*.requests.count'],
            from: '2026-01-01T00:00:00Z',
            maxDataPoints: 4,
            consolidateBy: 'sum',
        });

        expect(requests[0].params.get('from')).toBe(String(T0 - 1));
        expect(requests[0].params.get('until')).toBe('now');
        expect(json).toMatchObject({ from: '2026-01-01T00:00:00Z', until: 'now', totalSeries: 2 });
        expect(json.series[1]).toMatchObject({
            target: 'app.web2.requests.count',
            step: '10s',
            points: 360,
            stats: { sum: 720, avg: 2 },
            consolidation: { method: 'sum', bucket: '15min' },
            datapoints: [
                ['2026-01-01T00:00:00Z', 180],
                ['2026-01-01T00:15:00Z', 180],
                ['2026-01-01T00:30:00Z', 180],
                ['2026-01-01T00:45:00Z', 180],
            ],
        });
    });

    it('graphite_query honours maxSeries and summaryOnly', async () => {
        const { json } = await call('graphite_query', { targets: ['app.*'], maxSeries: 1, summaryOnly: true });
        expect(json.series).toHaveLength(1);
        expect(json.truncated).toMatch(/Showing 1 of 2/);
        expect(json.series[0].datapoints).toBeUndefined();
    });

    it('graphite_query surfaces graphite errors as tool errors', async () => {
        const { result, text } = await call(
            'graphite_query',
            { targets: ['nope(a)'] },
            { ...routes, '/render': () => ({ status: 400, body: 'Received request for unknown function: nope' }) },
        );
        expect(result.isError).toBe(true);
        expect(text).toBe('Graphite returned HTTP 400: Received request for unknown function: nope');
    });

    it('graphite_list_functions lists signatures with a one-line summary', async () => {
        const { json } = await call('graphite_list_functions', { search: 'add metrics' });
        expect(json).toEqual({
            total: 1,
            functions: [{ signature: 'sumSeries(*seriesLists)', group: 'Combine', summary: 'Short form: sum().' }],
        });
    });

    it('graphite_list_functions returns full docs by name', async () => {
        const { json } = await call('graphite_list_functions', { name: 'SUMSERIES' });
        expect(json).toMatchObject({
            name: 'sumSeries',
            signature: 'sumSeries(*seriesLists)',
            params: [{ name: 'seriesLists' }],
        });

        const missing = await call('graphite_list_functions', { name: 'nope' });
        expect(missing.result.isError).toBe(true);
    });
});

describe('normaliseFindQuery', () => {
    it.each([
        [undefined, '*'],
        ['', '*'],
        ['a.b', 'a.b.*'],
        ['a.b.', 'a.b.*'],
        ['a.*.c', 'a.*.c'],
        ['a.{x,y}', 'a.{x,y}'],
        ['a.b?', 'a.b?'],
    ])('%s -> %s', (input, expected) => {
        expect(normaliseFindQuery(input)).toBe(expected);
    });
});

describe('buildMatcher', () => {
    it('rejects invalid regex with a readable error', () => {
        expect(() => buildMatcher('(', true)).toThrow(/Invalid regex/);
    });
});
