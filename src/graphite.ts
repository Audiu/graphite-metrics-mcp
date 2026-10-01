import type { GraphiteConfig } from './config.js';
import type { RawSeries } from './series.js';

export interface FindNode {
    /** Full dotted path. */
    id: string;
    /** Last path segment. */
    text: string;
    leaf: boolean;
}

export interface GraphiteFunction {
    name: string;
    function: string;
    description?: string;
    module?: string;
    group?: string;
    params?: unknown[];
}

export class GraphiteError extends Error {
    constructor(
        message: string,
        readonly status?: number,
    ) {
        super(message);
    }
}

export class GraphiteClient {
    private indexCache?: { expires: number; metrics: Promise<string[]> };

    constructor(
        private readonly config: GraphiteConfig,
        private readonly fetchImpl: typeof fetch = fetch,
    ) {}

    get baseUrl(): string {
        return this.config.url;
    }

    async find(query: string): Promise<FindNode[]> {
        // The completer format returns real paths; the default treejson format collapses wildcard matches
        // into a single node whose id still contains the wildcards.
        const { metrics } = await this.getJson<{ metrics: { path: string; name: string; is_leaf: string | number }[] }>(
            '/metrics/find',
            { query, format: 'completer' },
        );
        return metrics.map((node) => ({
            id: node.path.replace(/\.$/, ''),
            text: node.name,
            leaf: String(node.is_leaf) === '1',
        }));
    }

    /** Every leaf metric path on the server, cached for `indexCacheTtlMs`. */
    async index(): Promise<string[]> {
        const now = Date.now();
        if (this.indexCache && this.indexCache.expires > now) {
            return this.indexCache.metrics;
        }
        const metrics = this.getJson<string[]>('/metrics/index.json');
        this.indexCache = { expires: now + this.config.indexCacheTtlMs, metrics };
        // Don't cache failures.
        metrics.catch(() => {
            if (this.indexCache?.metrics === metrics) {
                this.indexCache = undefined;
            }
        });
        return metrics;
    }

    async render(targets: string[], from: string, until: string): Promise<RawSeries[]> {
        const body = new URLSearchParams({ from, until, format: 'json' });
        for (const target of targets) {
            body.append('target', target);
        }
        // POST so long target lists don't hit URL length limits.
        return this.request<RawSeries[]>('/render', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body,
        });
    }

    async functions(): Promise<Record<string, GraphiteFunction>> {
        return this.getJson('/functions');
    }

    private getJson<T>(path: string, params?: Record<string, string>): Promise<T> {
        const query = params ? `?${new URLSearchParams(params)}` : '';
        return this.request<T>(`${path}${query}`, { method: 'GET' });
    }

    private async request<T>(path: string, init: RequestInit): Promise<T> {
        const url = `${this.config.url}${path}`;
        const headers: Record<string, string> = {
            Accept: 'application/json',
            ...(init.headers as Record<string, string>),
            ...this.config.headers,
        };
        if (this.config.username !== undefined) {
            const credentials = `${this.config.username}:${this.config.password ?? ''}`;
            headers.Authorization = `Basic ${Buffer.from(credentials).toString('base64')}`;
        }

        let response: Response;
        try {
            response = await this.fetchImpl(url, {
                ...init,
                headers,
                signal: this.config.timeoutMs > 0 ? AbortSignal.timeout(this.config.timeoutMs) : undefined,
            });
        } catch (error) {
            throw new GraphiteError(`Could not reach Graphite at ${this.config.url}: ${describeFetchError(error)}`);
        }

        const text = await response.text();
        if (!response.ok) {
            throw new GraphiteError(describeHttpError(response.status, text), response.status);
        }

        try {
            return parseGraphiteJson(text) as T;
        } catch {
            throw new GraphiteError(
                `Graphite returned a non-JSON response from ${path.split('?')[0]}: ${excerpt(text)}`,
                response.status,
            );
        }
    }
}

/** graphite-web can emit bare Infinity/NaN, which JSON.parse rejects. */
function parseGraphiteJson(text: string): unknown {
    try {
        return JSON.parse(text);
    } catch (error) {
        const patched = text.replace(/(?<=[\[,:]\s*)-?Infinity\b|(?<=[\[,:]\s*)NaN\b/g, 'null');
        if (patched === text) {
            throw error;
        }
        return JSON.parse(patched);
    }
}

function describeFetchError(error: unknown): string {
    if (error instanceof Error) {
        if (error.name === 'TimeoutError') {
            return 'request timed out (raise GRAPHITE_TIMEOUT_MS, or narrow the time range / number of series)';
        }
        const cause = (error as Error & { cause?: unknown }).cause;
        if (cause instanceof Error) {
            const code = (cause as Error & { code?: string }).code;
            return code ? `${code} ${cause.message}` : cause.message;
        }
        return error.message;
    }
    return String(error);
}

function describeHttpError(status: number, body: string): string {
    if (status === 401 || status === 403) {
        return `Graphite rejected the credentials (HTTP ${status}). Check GRAPHITE_USERNAME / GRAPHITE_PASSWORD / GRAPHITE_HEADERS.`;
    }
    if (status === 404) {
        return `Graphite endpoint not found (HTTP 404). Check GRAPHITE_URL points at graphite-web (and its URL prefix, if any). ${excerpt(body)}`;
    }
    return `Graphite returned HTTP ${status}: ${excerpt(body)}`;
}

/** Strips HTML (graphite-web error pages / Django tracebacks) down to a short readable message. */
function excerpt(body: string, max = 800): string {
    const text = body
        .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&quot;/g, '"')
        .replace(/&#39;|&#x27;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/\s+/g, ' ')
        .trim();
    if (!text) {
        return '(empty response body)';
    }
    return text.length > max ? `${text.slice(0, max)}…` : text;
}
