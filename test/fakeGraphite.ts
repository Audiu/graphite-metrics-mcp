import type { GraphiteConfig } from '../src/config.js';

export interface RecordedRequest {
    method: string;
    path: string;
    params: URLSearchParams;
    headers: Headers;
}

type Handler = (
    request: RecordedRequest,
) => { status?: number; body: unknown } | Promise<{ status?: number; body: unknown }>;

/** A fetch() stand-in that routes graphite-web paths to handlers and records every request. */
export function fakeGraphite(routes: Record<string, Handler>) {
    const requests: RecordedRequest[] = [];

    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(input));
        const params = new URLSearchParams(url.search);
        if (init?.body instanceof URLSearchParams) {
            init.body.forEach((value, key) => params.append(key, value));
        }
        const request: RecordedRequest = {
            method: init?.method ?? 'GET',
            path: url.pathname,
            params,
            headers: new Headers(init?.headers),
        };
        requests.push(request);

        const handler = routes[url.pathname];
        if (!handler) {
            return new Response('<h1>Not Found</h1>', { status: 404 });
        }
        const { status = 200, body } = await handler(request);
        return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
    }) as typeof fetch;

    return { fetchImpl, requests };
}

export const testConfig: GraphiteConfig = {
    url: 'http://graphite.test',
    headers: {},
    timeoutMs: 1000,
    indexCacheTtlMs: 60_000,
};
