import { describe, expect, it } from 'vitest';
import { formatDuration, isoFromEpoch, toGraphiteTime } from '../src/time.js';

describe('toGraphiteTime', () => {
    it('uses the fallback for empty input', () => {
        expect(toGraphiteTime(undefined, '-24h')).toBe('-24h');
        expect(toGraphiteTime('  ', 'now')).toBe('now');
    });

    it('passes graphite syntax through', () => {
        for (const value of ['-1h', '-7d', 'now', 'yesterday', '13:00_20260101', '1767225600']) {
            expect(toGraphiteTime(value, 'x')).toBe(value);
        }
    });

    it('converts ISO datetimes to epoch seconds, treating missing offsets as UTC', () => {
        expect(toGraphiteTime('2026-01-01T00:00:00Z', 'x')).toBe('1767225600');
        expect(toGraphiteTime('2026-01-01T00:00:00', 'x')).toBe('1767225600');
        expect(toGraphiteTime('2026-01-01T01:00:00+01:00', 'x')).toBe('1767225600');
        expect(toGraphiteTime('2026-01-01', 'x')).toBe('1767225600');
    });

    it('converts epoch milliseconds to seconds', () => {
        expect(toGraphiteTime('1767225600123', 'x')).toBe('1767225600');
    });

    it('rejects unparseable ISO-looking input', () => {
        expect(() => toGraphiteTime('2026-13-45T99:00', 'x')).toThrow(/Could not parse time/);
    });
});

describe('formatting', () => {
    it('formats epoch seconds as compact ISO', () => {
        expect(isoFromEpoch(1767225600)).toBe('2026-01-01T00:00:00Z');
    });

    it('formats durations in the largest whole unit', () => {
        expect(formatDuration(10)).toBe('10s');
        expect(formatDuration(90)).toBe('90s');
        expect(formatDuration(900)).toBe('15min');
        expect(formatDuration(7200)).toBe('2h');
        expect(formatDuration(86400)).toBe('1d');
    });
});
