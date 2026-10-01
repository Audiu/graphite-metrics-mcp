const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;
const HAS_ZONE = /(Z|[+-]\d{2}:?\d{2})$/i;

/**
 * Converts a user/LLM-supplied time into something graphite-web's `from`/`until` accept.
 *
 * - ISO-8601 dates/datetimes become epoch seconds. Datetimes without an offset are treated as UTC.
 * - Epoch milliseconds become epoch seconds.
 * - Anything else (`-1h`, `-7d`, `now`, `yesterday`, `13:00_20260101`, epoch seconds, ...) is passed through
 *   for graphite-web to interpret.
 */
export function toGraphiteTime(input: string | undefined, fallback: string): string {
    const value = input?.trim();
    if (!value) {
        return fallback;
    }

    if (/^\d{13}$/.test(value)) {
        return String(Math.floor(Number(value) / 1000));
    }

    if (ISO_DATE.test(value)) {
        const withZone = value.includes('T') && !HAS_ZONE.test(value) ? `${value}Z` : value;
        const ms = Date.parse(withZone);
        if (Number.isNaN(ms)) {
            throw new Error(
                `Could not parse time "${value}". Use ISO-8601 (2026-01-31T13:00:00Z) or Graphite syntax (-1h, -7d, now).`,
            );
        }
        return String(Math.floor(ms / 1000));
    }

    return value;
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
