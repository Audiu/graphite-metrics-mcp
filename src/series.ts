import { formatDuration, isoFromEpoch } from './time.js';

/** Graphite render JSON datapoint: [value, epochSeconds]. */
export type Datapoint = [number | null, number];

export interface RawSeries {
    target: string;
    datapoints: Datapoint[];
}

export const CONSOLIDATION_METHODS = ['avg', 'sum', 'min', 'max', 'last'] as const;
export type ConsolidationMethod = (typeof CONSOLIDATION_METHODS)[number];

export interface SeriesStats {
    min: number | null;
    minAt: string | null;
    max: number | null;
    maxAt: string | null;
    avg: number | null;
    sum: number | null;
    first: number | null;
    last: number | null;
    lastAt: string | null;
    nonNullPoints: number;
    nullPoints: number;
}

export interface SummarisedSeries {
    target: string;
    start: string | null;
    end: string | null;
    step: string | null;
    points: number;
    stats: SeriesStats;
    consolidation?: { method: ConsolidationMethod; bucket: string };
    datapoints?: [string, number | null][];
}

export interface SummariseOptions {
    maxDataPoints: number;
    consolidateBy: ConsolidationMethod;
    summaryOnly: boolean;
}

export function summariseSeries(series: RawSeries, options: SummariseOptions): SummarisedSeries {
    const { datapoints } = series;
    const step = datapoints.length > 1 ? datapoints[1][1] - datapoints[0][1] : null;

    const result: SummarisedSeries = {
        target: series.target,
        start: datapoints.length ? isoFromEpoch(datapoints[0][1]) : null,
        end: datapoints.length ? isoFromEpoch(datapoints[datapoints.length - 1][1]) : null,
        step: step ? formatDuration(step) : null,
        points: datapoints.length,
        stats: computeStats(datapoints),
    };

    if (!options.summaryOnly) {
        let shown = datapoints;
        if (step && datapoints.length > options.maxDataPoints) {
            const bucket = chooseBucketSeconds(datapoints, step, options.maxDataPoints);
            shown = consolidate(datapoints, bucket, options.consolidateBy);
            result.consolidation = { method: options.consolidateBy, bucket: formatDuration(bucket) };
        }
        result.datapoints = shown.map(([value, ts]) => [isoFromEpoch(ts), round(value)]);
    }

    return result;
}

const NICE_BUCKETS = [
    10, 15, 20, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 10800, 21600, 43200, 86400, 172800, 604800, 1209600,
    2592000,
];

/**
 * Picks the smallest bucket that keeps the series within maxDataPoints, preferring human-friendly
 * sizes (5min, 1h, 1d, ...) that are a whole multiple of the series step.
 */
export function chooseBucketSeconds(datapoints: Datapoint[], step: number, maxDataPoints: number): number {
    const firstTs = datapoints[0][1];
    const lastTs = datapoints[datapoints.length - 1][1];
    const bucketCount = (size: number) => Math.floor(lastTs / size) - Math.floor(firstTs / size) + 1;
    const minimum = step * Math.ceil(datapoints.length / maxDataPoints);

    for (const size of NICE_BUCKETS) {
        // Don't let a friendly size swallow the series (e.g. a 7s step only divides into 1w buckets).
        if (size > minimum * 4) {
            break;
        }
        if (size >= minimum && size % step === 0 && bucketCount(size) <= maxDataPoints) {
            return size;
        }
    }
    let size = minimum;
    while (bucketCount(size) > maxDataPoints) {
        size += step;
    }
    return size;
}

export function computeStats(datapoints: Datapoint[]): SeriesStats {
    let min: Datapoint | null = null;
    let max: Datapoint | null = null;
    let first: Datapoint | null = null;
    let last: Datapoint | null = null;
    let sum = 0;
    let count = 0;

    for (const point of datapoints) {
        const value = point[0];
        if (value === null || Number.isNaN(value)) {
            continue;
        }
        if (min === null || value < (min[0] as number)) min = point;
        if (max === null || value > (max[0] as number)) max = point;
        first ??= point;
        last = point;
        sum += value;
        count++;
    }

    return {
        min: round(min?.[0] ?? null),
        minAt: min ? isoFromEpoch(min[1]) : null,
        max: round(max?.[0] ?? null),
        maxAt: max ? isoFromEpoch(max[1]) : null,
        avg: count ? round(sum / count) : null,
        sum: count ? round(sum) : null,
        first: round(first?.[0] ?? null),
        last: round(last?.[0] ?? null),
        lastAt: last ? isoFromEpoch(last[1]) : null,
        nonNullPoints: count,
        nullPoints: datapoints.length - count,
    };
}

/**
 * Groups points into buckets of `bucketSeconds`, aligned to multiples of the bucket size (so 1h buckets
 * start on the hour, UTC), and reduces each bucket with `method`. Each bucket is stamped with its start time.
 */
export function consolidate(datapoints: Datapoint[], bucketSeconds: number, method: ConsolidationMethod): Datapoint[] {
    const buckets = new Map<number, number[]>();
    for (const [value, ts] of datapoints) {
        const key = Math.floor(ts / bucketSeconds) * bucketSeconds;
        let values = buckets.get(key);
        if (!values) {
            values = [];
            buckets.set(key, values);
        }
        if (value !== null && !Number.isNaN(value)) {
            values.push(value);
        }
    }
    return [...buckets].map(([ts, values]) => [reduce(values, method), ts]);
}

function reduce(values: number[], method: ConsolidationMethod): number | null {
    if (!values.length) {
        return null;
    }
    switch (method) {
        case 'sum':
            return values.reduce((a, b) => a + b, 0);
        case 'avg':
            return values.reduce((a, b) => a + b, 0) / values.length;
        case 'min':
            return values.reduce((a, b) => Math.min(a, b));
        case 'max':
            return values.reduce((a, b) => Math.max(a, b));
        case 'last':
            return values[values.length - 1];
    }
}

/** Trims float noise (0.30000000000000004) without losing precision on large integers. */
export function round(value: number | null): number | null {
    if (value === null || !Number.isFinite(value) || Number.isInteger(value)) {
        return value;
    }
    if (Math.abs(value) >= 1) {
        return Math.round(value * 1000) / 1000;
    }
    return Number(value.toPrecision(4));
}
