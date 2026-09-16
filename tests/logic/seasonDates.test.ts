// Season boundaries are calendar dates, and the awkward cases are the point.
//
// Every example in this file is from the owner's specification, plus the
// month-end, February, leap-year and year-crossing cases that a naive
// `setMonth(+n)` gets wrong by rolling into the following month.
import {
  addMonths,
  previousDay,
  nextDay,
  daysInMonth,
  seasonEndDate,
  nextSeasonStart,
  isSeasonOver,
  todayIn,
  monthsBetween,
  formatCalendarDate,
  isValidSeasonMonths,
  isCalendarDate,
  MIN_SEASON_MONTHS,
  MAX_SEASON_MONTHS,
} from '@/utils/seasonDates';

describe('the preset lengths, exactly as specified', () => {
  it('16.09.2026 + 3 months ends 15.12.2026, next starts 16.12.2026', () => {
    const end = seasonEndDate('2026-09-16', 3);
    expect(end).toBe('2026-12-15');
    expect(nextSeasonStart(end)).toBe('2026-12-16');
  });

  it('16.09.2026 + 6 months ends 15.03.2027', () => {
    expect(seasonEndDate('2026-09-16', 6)).toBe('2027-03-15');
    expect(nextSeasonStart('2027-03-15')).toBe('2027-03-16');
  });

  it('16.09.2026 + 12 months ends 15.09.2027', () => {
    expect(seasonEndDate('2026-09-16', 12)).toBe('2027-09-15');
  });
});

describe('custom lengths', () => {
  it('1 month', () => {
    expect(seasonEndDate('2026-09-16', 1)).toBe('2026-10-15');
  });

  it('2 months — the spec example', () => {
    const end = seasonEndDate('2026-09-16', 2);
    expect(end).toBe('2026-11-15');
    expect(nextSeasonStart(end)).toBe('2026-11-16');
  });

  it('24 months', () => {
    expect(seasonEndDate('2026-09-16', 24)).toBe('2028-09-15');
  });

  it('rejects 0, negatives, 25, and non-integers', () => {
    expect(isValidSeasonMonths(0)).toBe(false);
    expect(isValidSeasonMonths(-1)).toBe(false);
    expect(isValidSeasonMonths(25)).toBe(false);
    expect(isValidSeasonMonths(2.5)).toBe(false);
    expect(isValidSeasonMonths('3' as never)).toBe(false);
    expect(isValidSeasonMonths(MIN_SEASON_MONTHS)).toBe(true);
    expect(isValidSeasonMonths(MAX_SEASON_MONTHS)).toBe(true);
  });
});

describe('month ends, February and leap years', () => {
  it('31 August + 6 months clamps to 28 February, not 3 March', () => {
    // The naive setMonth(+6) lands on 03.03 because 31 February rolls over.
    expect(addMonths('2026-08-31', 6)).toBe('2027-02-28');
    expect(seasonEndDate('2026-08-31', 6)).toBe('2027-02-27');
  });

  it('31 January + 1 month is 28 February', () => {
    expect(addMonths('2027-01-31', 1)).toBe('2027-02-28');
  });

  it('a leap year gives February 29', () => {
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2027-12-29', 2)).toBe('2028-02-29');
  });

  it('a century non-leap year does not', () => {
    expect(daysInMonth(2100, 2)).toBe(28);
  });

  it('31 March back a day is 30 March; 1 March back a day is the 28th or 29th', () => {
    expect(previousDay('2026-03-31')).toBe('2026-03-30');
    expect(previousDay('2027-03-01')).toBe('2027-02-28');
    expect(previousDay('2028-03-01')).toBe('2028-02-29');
  });
});

describe('crossing a year', () => {
  it('a season running into the next year', () => {
    const end = seasonEndDate('2026-11-16', 3);
    expect(end).toBe('2027-02-15');
    expect(nextSeasonStart(end)).toBe('2027-02-16');
  });

  it('31 December rolls to 1 January', () => {
    expect(nextDay('2026-12-31')).toBe('2027-01-01');
    expect(previousDay('2027-01-01')).toBe('2026-12-31');
  });

  it('1 January + 12 months', () => {
    expect(seasonEndDate('2027-01-01', 12)).toBe('2027-12-31');
  });
});

describe('the rollover lands on the club midnight, not on UTC', () => {
  // Cloud Functions run in UTC. A boundary computed there and compared as an
  // instant flips at 02:00 or 03:00 Israel time depending on daylight saving —
  // which is exactly what the specification forbids.
  const TZ = 'Asia/Jerusalem';

  it('is still running at 23:59 local on its last day', () => {
    // 15.12.2026 22:59 UTC is 16.12 00:59 in Israel… so pick a real local
    // evening: 21:00 UTC on the 15th = 23:00 local on the 15th.
    const local = todayIn(TZ, Date.UTC(2026, 11, 15, 21, 0));
    expect(local).toBe('2026-12-15');
    expect(isSeasonOver('2026-12-15', local)).toBe(false);
  });

  it('is over once the local date has turned, even though UTC has not', () => {
    // 22:30 UTC on 15.12 is already 00:30 on 16.12 in Israel (UTC+2 in winter).
    const local = todayIn(TZ, Date.UTC(2026, 11, 15, 22, 30));
    expect(local).toBe('2026-12-16');
    expect(isSeasonOver('2026-12-15', local)).toBe(true);
  });

  it('holds across the summer offset too', () => {
    // July is UTC+3. 21:30 UTC is 00:30 the next day locally.
    expect(todayIn(TZ, Date.UTC(2027, 6, 15, 21, 30))).toBe('2027-07-16');
    expect(todayIn(TZ, Date.UTC(2027, 6, 15, 20, 30))).toBe('2027-07-15');
  });
});

describe('small helpers', () => {
  it('measures a season in whole months', () => {
    expect(monthsBetween('2026-09-16', '2026-12-15')).toBe(3);
    expect(monthsBetween('2026-09-16', '2027-09-15')).toBe(12);
  });

  it('formats the way the app shows dates', () => {
    expect(formatCalendarDate('2026-09-16')).toBe('16.09.2026');
    expect(formatCalendarDate('2027-01-05')).toBe('05.01.2027');
  });

  it('recognises the shape, and refuses anything else', () => {
    expect(isCalendarDate('2026-09-16')).toBe(true);
    expect(isCalendarDate('16.09.2026')).toBe(false);
    expect(isCalendarDate('2026-9-16')).toBe(false);
    expect(isCalendarDate(1789507000000 as never)).toBe(false);
    expect(() => addMonths('nope' as never, 1)).toThrow();
  });
});
