import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config.js';

describe('loadConfig', () => {
    it('requires GRAPHITE_URL', () => {
        expect(() => loadConfig({})).toThrow(ConfigError);
        expect(() => loadConfig({ GRAPHITE_URL: 'not a url' })).toThrow(/not a valid URL/);
    });

    it('applies defaults and strips trailing slashes', () => {
        expect(loadConfig({ GRAPHITE_URL: 'http://graphite:8080/' })).toEqual({
            url: 'http://graphite:8080',
            username: undefined,
            password: undefined,
            headers: {},
            timeoutMs: 30_000,
            indexCacheTtlMs: 300_000,
        });
    });

    it('keeps a URL prefix', () => {
        expect(loadConfig({ GRAPHITE_URL: 'https://example.com/graphite/' }).url).toBe('https://example.com/graphite');
    });

    it('lifts credentials out of the URL', () => {
        const config = loadConfig({ GRAPHITE_URL: 'http://bob:p%40ss@graphite:8080' });
        expect(config).toMatchObject({ url: 'http://graphite:8080', username: 'bob', password: 'p@ss' });
    });

    it('prefers explicit credentials over URL ones', () => {
        const config = loadConfig({
            GRAPHITE_URL: 'http://bob:pass@graphite',
            GRAPHITE_USERNAME: 'alice',
            GRAPHITE_PASSWORD: 'secret',
        });
        expect(config).toMatchObject({ url: 'http://graphite', username: 'alice', password: 'secret' });
    });

    it('parses headers and numeric options', () => {
        const config = loadConfig({
            GRAPHITE_URL: 'http://graphite',
            GRAPHITE_HEADERS: '{"Authorization":"Bearer abc","X-Org":1}',
            GRAPHITE_TIMEOUT_MS: '5000',
            GRAPHITE_INDEX_CACHE_TTL_SECONDS: '0',
        });
        expect(config.headers).toEqual({ Authorization: 'Bearer abc', 'X-Org': '1' });
        expect(config.timeoutMs).toBe(5000);
        expect(config.indexCacheTtlMs).toBe(0);
    });

    it('rejects malformed options', () => {
        expect(() => loadConfig({ GRAPHITE_URL: 'http://g', GRAPHITE_HEADERS: '[1]' })).toThrow(/JSON object/);
        expect(() => loadConfig({ GRAPHITE_URL: 'http://g', GRAPHITE_HEADERS: '{' })).toThrow(/JSON object/);
        expect(() => loadConfig({ GRAPHITE_URL: 'http://g', GRAPHITE_TIMEOUT_MS: '-1' })).toThrow(/non-negative/);
    });
});
