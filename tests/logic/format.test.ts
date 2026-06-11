import {
  relativeKickoff,
  formatTime,
  dayDiff,
  joinLocation,
} from '@/utils/format';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
// Fixed local "now": June 15 2026, 12:00 — noon keeps +hours on the same day.
const NOW = new Date(2026, 5, 15, 12, 0, 0).getTime();

describe('relativeKickoff', () => {
  it('past / now → null', () => {
    expect(relativeKickoff(NOW - MIN, NOW)).toBeNull();
    expect(relativeKickoff(NOW, NOW)).toBeNull();
  });
  it('minutes under an hour', () => {
    expect(relativeKickoff(NOW + 5 * MIN, NOW)).toBe('עוד 5 דק׳');
    expect(relativeKickoff(NOW + 30 * MIN, NOW)).toBe('עוד 30 דק׳');
    expect(relativeKickoff(NOW + 59 * MIN, NOW)).toBe('עוד 59 דק׳');
    // never "0 דק׳" — clamps to at least 1
    expect(relativeKickoff(NOW + 20 * 1000, NOW)).toBe('עוד 1 דק׳');
  });
  it('Hebrew dual forms for hours (same day)', () => {
    expect(relativeKickoff(NOW + 1 * HOUR, NOW)).toBe('עוד שעה');
    expect(relativeKickoff(NOW + 2 * HOUR, NOW)).toBe('עוד שעתיים');
    expect(relativeKickoff(NOW + 3 * HOUR, NOW)).toBe('עוד 3 שעות');
    expect(relativeKickoff(NOW + 5 * HOUR, NOW)).toBe('עוד 5 שעות');
  });
  it('calendar-aware days', () => {
    const noonOn = (d: number) => new Date(2026, 5, d, 12, 0, 0).getTime();
    expect(relativeKickoff(noonOn(16), NOW)).toBe('מחר');
    expect(relativeKickoff(noonOn(17), NOW)).toBe('בעוד יומיים');
    expect(relativeKickoff(noonOn(18), NOW)).toBe('בעוד 3 ימים');
    expect(relativeKickoff(noonOn(21), NOW)).toBe('בעוד 6 ימים');
    expect(relativeKickoff(noonOn(25), NOW)).toBeNull(); // > 6 days
  });
});

describe('formatTime', () => {
  it('zero-pads HH:MM (self-consistent with local time)', () => {
    const ms = new Date(2026, 0, 1, 9, 5, 0).getTime();
    expect(formatTime(ms)).toBe('09:05');
    const ms2 = new Date(2026, 0, 1, 23, 59, 0).getTime();
    expect(formatTime(ms2)).toBe('23:59');
    const ms3 = new Date(2026, 0, 1, 0, 0, 0).getTime();
    expect(formatTime(ms3)).toBe('00:00');
  });
});

describe('dayDiff', () => {
  it('counts calendar days regardless of time of day', () => {
    expect(dayDiff(NOW + 6 * HOUR, NOW)).toBe(0); // same day, evening
    expect(dayDiff(new Date(2026, 5, 16, 1, 0, 0).getTime(), NOW)).toBe(1);
    expect(dayDiff(new Date(2026, 5, 14, 23, 0, 0).getTime(), NOW)).toBe(-1);
    expect(dayDiff(new Date(2026, 5, 22, 12, 0, 0).getTime(), NOW)).toBe(7);
  });
});

describe('joinLocation', () => {
  it('field only', () => {
    expect(joinLocation('פארק הירקון', '')).toBe('פארק הירקון');
    expect(joinLocation('פארק הירקון', undefined)).toBe('פארק הירקון');
  });
  it('city only when no field', () => {
    expect(joinLocation('', 'תל אביב')).toBe('תל אביב');
    expect(joinLocation(undefined, 'תל אביב')).toBe('תל אביב');
  });
  it('joins distinct field + city', () => {
    expect(joinLocation('פארק הירקון', 'תל אביב')).toBe('פארק הירקון, תל אביב');
  });
  it('does NOT duplicate a city already inside the field', () => {
    expect(joinLocation('עזריה 21, תל אביב', 'תל אביב')).toBe('עזריה 21, תל אביב');
  });
  it('trims whitespace', () => {
    expect(joinLocation('  מגרש  ', '  חיפה ')).toBe('מגרש, חיפה');
  });
});
