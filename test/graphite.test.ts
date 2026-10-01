import { describe, expect, it } from 'vitest';
import { GraphiteClient, GraphiteError } from '../src/graphite.js';
import { fakeGraphite, testConfig } from './fakeGraphite.js';

describe('GraphiteClient', () => {
    it('finds nodes using the completer format', async () => {
        const { fetchImpl, requests } = fakeGraphite({
            '/metrics/find': () => ({
                body: {
                    metrics: [
                        { path: 'a.b.', name: 'b', is_leaf: '0' },
                        { path: 'a.c', name: 'c', is_leaf: '1' },
                    ],
                },
            }),
        });
        const nodes = await new GraphiteClient(testConfig, fetchImpl).find('a.*');

        expect(nodes).toEqual([
            { id: 'a.b', text: 'b', leaf: false },
            { id: 'a.c', text: 'c', leaf: true },
        ]);
        expect(requests[0].params.get('query')).toBe('a.*');
        expect(requests[0].params.get('format')).toBe('completer');
    });

    it('POSTs render requests with every target', async () => {
        const { fetchImpl, requests } = fakeGraphite({
            '/render': () => ({ body: [{ target: 'a', datapoints: [[1, 100]] }] }),
        });
        const series = await new GraphiteClient(testConfig, fetchImpl).render(['a', 'sumSeries(b.*)'], '-1h', 'now');

        expect(series).toEqual([{ target: 'a', datapoints: [[1, 100]] }]);
        expect(requests[0].method).toBe('POST');
        expect(requests[0].params.getAll('target')).toEqual(['a', 'sumSeries(b.*)']);
        expect(requests[0].params.get('from')).toBe('-1h');
        expect(requests[0].params.get('format')).toBe('json');
    });

    it('tolerates bare Infinity / NaN in graphite JSON', async () => {
        const { fetchImpl } = fakeGraphite({
            '/render': () => ({ body: '[{"target": "a", "datapoints": [[Infinity, 1], [NaN, 2], [-Infinity, 3]]}]' }),
        });
        const series = await new GraphiteClient(testConfig, fetchImpl).render(['a'], '-1h', 'now');
        expect(series[0].datapoints).toEqual([
            [null, 1],
            [null, 2],
            [null, 3],
        ]);
    });

    it('sends basic auth and custom headers', async () => {
        const { fetchImpl, requests } = fakeGraphite({ '/functions': () => ({ body: {} }) });
        const client = new GraphiteClient(
            { ...testConfig, username: 'bob', password: 'secret', headers: { 'X-Org': '1' } },
            fetchImpl,
        );
        await client.functions();

        expect(requests[0].headers.get('authorization')).toBe(`Basic ${btoa('bob:secret')}`);
        expect(requests[0].headers.get('x-org')).toBe('1');
    });

    it('caches the metric index and does not cache failures', async () => {
        let calls = 0;
        const { fetchImpl } = fakeGraphite({
            '/metrics/index.json': () => (++calls === 1 ? { status: 500, body: 'boom' } : { body: ['a.b', 'a.c'] }),
        });
        const client = new GraphiteClient(testConfig, fetchImpl);

        await expect(client.index()).rejects.toThrow(/HTTP 500/);
        expect(await client.index()).toEqual(['a.b', 'a.c']);
        expect(await client.index()).toEqual(['a.b', 'a.c']);
        expect(calls).toBe(2);
    });

    it('explains auth failures', async () => {
        const { fetchImpl } = fakeGraphite({ '/functions': () => ({ status: 401, body: 'Unauthorized' }) });
        const error = await new GraphiteClient(testConfig, fetchImpl).functions().catch((e) => e);

        expect(error).toBeInstanceOf(GraphiteError);
        expect(error.status).toBe(401);
        expect(error.message).toMatch(/GRAPHITE_USERNAME/);
    });

    it('strips HTML from error pages', async () => {
        const { fetchImpl } = fakeGraphite({
            '/render': () => ({
                status: 500,
                body: '<html><style>p{}</style><body><h1>Server Error</h1><p>KeyError: &#39;x&#39;</p></body></html>',
            }),
        });
        await expect(new GraphiteClient(testConfig, fetchImpl).render(['x'], '-1h', 'now')).rejects.toThrow(
            "Graphite returned HTTP 500: Server Error KeyError: 'x'",
        );
    });

    it('reports unreachable servers', async () => {
        const fetchImpl = (async () => {
            throw new TypeError('fetch failed', {
                cause: Object.assign(new Error('connect refused'), { code: 'ECONNREFUSED' }),
            });
        }) as typeof fetch;
        await expect(new GraphiteClient(testConfig, fetchImpl).functions()).rejects.toThrow(
            'Could not reach Graphite at http://graphite.test: ECONNREFUSED connect refused',
        );
    });

    it('reports non-JSON responses', async () => {
        const { fetchImpl } = fakeGraphite({ '/functions': () => ({ body: '<html>login page</html>' }) });
        await expect(new GraphiteClient(testConfig, fetchImpl).functions()).rejects.toThrow(
            /non-JSON response from \/functions/,
        );
    });
});
