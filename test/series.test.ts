import { describe, expect, it } from 'vitest';
import {
    chooseBucketSeconds,
    computeStats,
    consolidate,
    round,
    summariseSeries,
    type Datapoint,
} from '../src/series.js';

const T0 = 1767225600; // 2026-01-01T00:00:00Z

function series(values: (number | null)[], step = 10, start = T0): Datapoint[] {
    return values.map((value, i) => [value, start + i * step]);
}

describe('computeStats', () => {
    it('ignores nulls and records where extremes happened', () => {
        const stats = computeStats(series([null, 3, 1, 4, null, 1, 5, null]));
        expect(stats).toEqual({
            min: 1,
            minAt: '2026-01-01T00:00:20Z',
            max: 5,
            maxAt: '2026-01-01T00:01:00Z',
            avg: 2.8,
            sum: 14,
            first: 3,
            last: 5,
            lastAt: '2026-01-01T00:01:00Z',
            nonNullPoints: 5,
            nullPoints: 3,
        });
    });

    it('handles all-null series', () => {
        const stats = computeStats(series([null, null]));
        expect(stats.min).toBeNull();
        expect(stats.avg).toBeNull();
        expect(stats.sum).toBeNull();
        expect(stats.nullPoints).toBe(2);
    });
});

describe('consolidate', () => {
    const points = series([1, 2, 3, null, 5, 6], 10, T0);

    it.each([
        ['sum', [3, 3, 11]],
        ['avg', [1.5, 3, 5.5]],
        ['min', [1, 3, 5]],
        ['max', [2, 3, 6]],
        ['last', [2, 3, 6]],
    ] as const)('reduces buckets with %s', (method, expected) => {
        expect(consolidate(points, 20, method).map(([v]) => v)).toEqual(expected);
    });

    it('aligns buckets to multiples of the bucket size', () => {
        const offset = series([1, 1, 1, 1], 60, T0 + 1800 + 120); // starts 00:32
        const result = consolidate(offset, 3600, 'sum');
        expect(result).toEqual([[4, T0]]);
    });

    it('returns null for buckets with no values', () => {
        expect(consolidate(series([null, null, 1, 1]), 20, 'sum')).toEqual([
            [null, T0],
            [2, T0 + 20],
        ]);
    });
});

describe('chooseBucketSeconds', () => {
    it('prefers human-friendly bucket sizes', () => {
        const day = series(new Array(8640).fill(1), 10); // 24h at 10s
        expect(chooseBucketSeconds(day, 10, 100)).toBe(900);
        expect(chooseBucketSeconds(day, 10, 24)).toBe(3600);
    });

    it('never exceeds maxDataPoints, even with partial buckets at both ends', () => {
        const odd = series(new Array(1000).fill(1), 10, T0 + 7);
        for (const max of [3, 7, 50, 99, 333]) {
            const size = chooseBucketSeconds(odd, 10, max);
            expect(consolidate(odd, size, 'avg').length).toBeLessThanOrEqual(max);
        }
    });

    it('falls back to multiples of unusual steps', () => {
        const weird = series(new Array(100).fill(1), 7);
        const size = chooseBucketSeconds(weird, 7, 10);
        expect(size).toBe(70);
        expect(consolidate(weird, size, 'avg').length).toBeLessThanOrEqual(10);
    });
});

describe('summariseSeries', () => {
    it('returns raw datapoints when under maxDataPoints', () => {
        const result = summariseSeries(
            { target: 'a.b', datapoints: series([1, 2, 3]) },
            { maxDataPoints: 10, consolidateBy: 'avg', summaryOnly: false },
        );
        expect(result).toMatchObject({
            target: 'a.b',
            start: '2026-01-01T00:00:00Z',
            end: '2026-01-01T00:00:20Z',
            step: '10s',
            points: 3,
        });
        expect(result.consolidation).toBeUndefined();
        expect(result.datapoints).toEqual([
            ['2026-01-01T00:00:00Z', 1],
            ['2026-01-01T00:00:10Z', 2],
            ['2026-01-01T00:00:20Z', 3],
        ]);
    });

    it('consolidates long series and keeps full-resolution stats', () => {
        const result = summariseSeries(
            { target: 'a.b', datapoints: series(new Array(360).fill(2)) }, // 1h at 10s
            { maxDataPoints: 4, consolidateBy: 'sum', summaryOnly: false },
        );
        expect(result.stats.sum).toBe(720);
        expect(result.consolidation).toEqual({ method: 'sum', bucket: '15min' });
        expect(result.datapoints?.map(([, v]) => v)).toEqual([180, 180, 180, 180]);
    });

    it('omits datapoints in summaryOnly mode', () => {
        const result = summariseSeries(
            { target: 'a.b', datapoints: series([1, 2]) },
            { maxDataPoints: 10, consolidateBy: 'avg', summaryOnly: true },
        );
        expect(result.datapoints).toBeUndefined();
        expect(result.stats.sum).toBe(3);
    });

    it('handles empty series', () => {
        const result = summariseSeries(
            { target: 'a.b', datapoints: [] },
            { maxDataPoints: 10, consolidateBy: 'avg', summaryOnly: false },
        );
        expect(result).toMatchObject({ start: null, end: null, step: null, points: 0, datapoints: [] });
    });
});

describe('round', () => {
    it('trims float noise but keeps integers and large values exact', () => {
        expect(round(0.1 + 0.2)).toBe(0.3);
        expect(round(123456789)).toBe(123456789);
        expect(round(1234.56789)).toBe(1234.568);
        expect(round(0.000123456)).toBe(0.0001235);
        expect(round(null)).toBeNull();
    });
});
