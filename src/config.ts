export interface GraphiteConfig {
    /** Base URL of graphite-web, without a trailing slash. */
    url: string;
    username?: string;
    password?: string;
    /** Extra headers sent with every request (e.g. a bearer token). */
    headers: Record<string, string>;
    timeoutMs: number;
    /** How long the full metric index is cached for metric search. */
    indexCacheTtlMs: number;
}

export class ConfigError extends Error {}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): GraphiteConfig {
    const rawUrl = env.GRAPHITE_URL?.trim();
    if (!rawUrl) {
        throw new ConfigError(
            'GRAPHITE_URL is not set. Point it at your graphite-web instance, e.g. http://graphite:8080',
        );
    }

    let parsed: URL;
    try {
        parsed = new URL(rawUrl);
    } catch {
        throw new ConfigError(`GRAPHITE_URL is not a valid URL: ${rawUrl}`);
    }

    // fetch() refuses URLs with embedded credentials, so lift them out and use them as basic auth.
    let username = env.GRAPHITE_USERNAME || undefined;
    let password = env.GRAPHITE_PASSWORD || undefined;
    if (parsed.username || parsed.password) {
        username ??= decodeURIComponent(parsed.username);
        password ??= decodeURIComponent(parsed.password);
        parsed.username = '';
        parsed.password = '';
    }

    return {
        url: parsed.toString().replace(/\/+$/, ''),
        username,
        password,
        headers: parseHeaders(env.GRAPHITE_HEADERS),
        timeoutMs: parseNonNegativeInt(env.GRAPHITE_TIMEOUT_MS, 'GRAPHITE_TIMEOUT_MS', 30_000),
        indexCacheTtlMs:
            parseNonNegativeInt(env.GRAPHITE_INDEX_CACHE_TTL_SECONDS, 'GRAPHITE_INDEX_CACHE_TTL_SECONDS', 300) * 1000,
    };
}

function parseHeaders(raw: string | undefined): Record<string, string> {
    if (!raw?.trim()) {
        return {};
    }
    let value: unknown;
    try {
        value = JSON.parse(raw);
    } catch {
        throw new ConfigError('GRAPHITE_HEADERS must be a JSON object, e.g. {"Authorization":"Bearer abc"}');
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new ConfigError('GRAPHITE_HEADERS must be a JSON object, e.g. {"Authorization":"Bearer abc"}');
    }
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, String(v)]));
}

function parseNonNegativeInt(raw: string | undefined, name: string, fallback: number): number {
    if (!raw?.trim()) {
        return fallback;
    }
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 0) {
        throw new ConfigError(`${name} must be a non-negative integer, got: ${raw}`);
    }
    return value;
}
