import { describe, expect, it } from 'vitest';
import { formatDuration, isoFromEpoch, resolveTime } from '../src/time.js';

describe('resolveTime', () => {
    it('uses the fallback for empty input', () => {
        expect(resolveTime(undefined, '-24h')).toEqual({ param: '-24h', label: '-24h' });
        expect(resolveTime('  ', 'now')).toEqual({ param: 'now', label: 'now' });
    });

    it('passes relative and graphite-native times through', () => {
        for (const value of ['-1h', '-7d', 'now', 'yesterday', '13:00_20260101']) {
            expect(resolveTime(value, 'x')).toEqual({ param: value, label: value });
        }
    });

    it('sends absolute times one second early so ranges are [from, until)', () => {
        expect(resolveTime('2026-01-01T00:00:00Z', 'x')).toEqual({
            param: '1767225599',
            label: '2026-01-01T00:00:00Z',
        });
        expect(resolveTime('1767225600', 'x')).toEqual({ param: '1767225599', label: '2026-01-01T00:00:00Z' });
    });

    it('parses ISO dates and datetimes, treating missing offsets as UTC', () => {
        for (const value of ['2026-01-01T00:00:00', '2026-01-01T01:00:00+01:00', '2026-01-01']) {
            expect(resolveTime(value, 'x').label).toBe('2026-01-01T00:00:00Z');
        }
    });

    it('converts epoch milliseconds to seconds', () => {
        expect(resolveTime('1767225600123', 'x').label).toBe('2026-01-01T00:00:00Z');
    });

    it('rejects unparseable ISO-looking input', () => {
        expect(() => resolveTime('2026-13-45T99:00', 'x')).toThrow(/Could not parse time/);
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
