const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;
const HAS_ZONE = /(Z|[+-]\d{2}:?\d{2})$/i;

export interface GraphiteTime {
    /** Value for graphite-web's `from` / `until` parameter. */
    param: string;
    /** Human-readable form to echo back. */
    label: string;
}

/**
 * Converts a user/LLM-supplied time into something graphite-web's `from`/`until` accept.
 *
 * Absolute times (ISO-8601, epoch seconds or milliseconds) are resolved so that a from/until pair covers the
 * half-open range [from, until), as people expect: `until: 2026-10-01` stops at the end of 30 September. Graphite
 * itself returns points in (from, until], so both ends are sent one second earlier. ISO datetimes without an offset
 * are treated as UTC.
 *
 * Anything else (`-1h`, `-7d`, `now`, `yesterday`, `13:00_20260101`, ...) is passed through for graphite-web to
 * interpret.
 */
export function resolveTime(input: string | undefined, fallback: string): GraphiteTime {
    const value = input?.trim() || fallback;
    const epoch = parseAbsolute(value);
    if (epoch === undefined) {
        return { param: value, label: value };
    }
    return { param: String(epoch - 1), label: isoFromEpoch(epoch) };
}

function parseAbsolute(value: string): number | undefined {
    if (/^\d{9,11}$/.test(value)) {
        return Number(value);
    }
    if (/^\d{13}$/.test(value)) {
        return Math.floor(Number(value) / 1000);
    }
    if (ISO_DATE.test(value)) {
        const withZone = value.includes('T') && !HAS_ZONE.test(value) ? `${value}Z` : value;
        const ms = Date.parse(withZone);
        if (Number.isNaN(ms)) {
            throw new Error(
                `Could not parse time "${value}". Use ISO-8601 (2026-01-31T13:00:00Z) or Graphite syntax (-1h, -7d, now).`,
            );
        }
        return Math.floor(ms / 1000);
    }
    return undefined;
}

export function isoFromEpoch(seconds: number): string {
    return new Date(seconds * 1000).toISOString().replace('.000Z', 'Z');
}

export function formatDuration(seconds: number): string {
    const units: [number, string][] = [
        [86400, 'd'],
        [3600, 'h'],
        [60, 'min'],
    ];
    for (const [size, suffix] of units) {
        if (seconds >= size && seconds % size === 0) {
            return `${seconds / size}${suffix}`;
        }
    }
    return `${seconds}s`;
}
