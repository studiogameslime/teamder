import { roundCoverPeriod } from '@/data/roundCoverPeriod';

describe('scheduled Israeli daylight for round covers', () => {
  it.each([undefined, NaN, Infinity, -1, 0, 9e20])('uses daylight for missing/invalid date %s', date => {
    expect(roundCoverPeriod(date)).toBe('day');
  });
  it('handles evening, midnight and morning across seasonal daylight windows', () => {
    expect(roundCoverPeriod(Date.parse('2026-01-15T16:00:00+02:00'))).toBe('day');
    expect(roundCoverPeriod(Date.parse('2026-01-15T18:00:00+02:00'))).toBe('night');
    expect(roundCoverPeriod(Date.parse('2026-07-15T18:00:00+03:00'))).toBe('day');
    expect(roundCoverPeriod(Date.parse('2026-07-15T21:00:00+03:00'))).toBe('night');
    expect(roundCoverPeriod(Date.parse('2026-07-15T00:15:00+03:00'))).toBe('night');
    expect(roundCoverPeriod(Date.parse('2026-07-15T04:00:00+03:00'))).toBe('night');
    expect(roundCoverPeriod(Date.parse('2026-07-15T09:00:00+03:00'))).toBe('day');
  });
  it('uses the Israel date at a UTC month boundary', () => {
    expect(roundCoverPeriod(Date.parse('2026-07-31T22:00:00Z'))).toBe('night');
  });
  it('treats equivalent timestamps equally, independent of the date string timezone', () => {
    expect(roundCoverPeriod(Date.parse('2026-07-15T19:00:00+03:00')))
      .toBe(roundCoverPeriod(Date.parse('2026-07-15T09:00:00-07:00')));
  });
  it('changes at the documented window boundary, without using the current clock', () => {
    expect(roundCoverPeriod(Date.parse('2026-07-15T19:59:00+03:00'))).toBe('day');
    expect(roundCoverPeriod(Date.parse('2026-07-15T20:00:00+03:00'))).toBe('night');
  });
});
