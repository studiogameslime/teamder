// Locks the "no-play" holiday lookup (src/utils/holidays.ts) that powers the
// create-game holiday popup. The table is generated from @hebcal/core (Israel
// scheme, CHAG | MAJOR_FAST) — these cases assert the SELECTION policy: yom-tov
// and major fasts warn; Chanukah / Chol HaMoed / Rosh Chodesh / Purim / ordinary
// days do NOT. Dates are noon UTC to stay on the intended calendar day.

import { holidayOnDate } from '@/utils/holidays';

const noon = (d: string) => new Date(`${d}T12:00:00`).getTime();

describe('holidayOnDate — no-play holiday selection', () => {
  it('warns on yom-tov festivals', () => {
    expect(holidayOnDate(noon('2026-04-02'))).toBe('פסח א׳');
    expect(holidayOnDate(noon('2026-05-22'))).toBe('שבועות');
    expect(holidayOnDate(noon('2026-09-21'))).toBe('יום כפור');
    expect(holidayOnDate(noon('2026-09-12'))).toBe('ראש השנה');
    expect(holidayOnDate(noon('2026-10-03'))).toBe('שמיני עצרת');
  });

  it('warns on the major fast (Tisha B\'Av), incl. its eve', () => {
    expect(holidayOnDate(noon('2026-07-22'))).toBe('ערב תשעה באב');
    expect(holidayOnDate(noon('2026-07-23'))).toBe('תשעה באב');
    // Postponed years collapse to the clean base name (no unbalanced parens).
    expect(holidayOnDate(noon('2029-07-22'))).toBe('תשעה באב');
  });

  it('warns on festival EVES only from mid-afternoon (people play the morning)', () => {
    // Erev Yom Kippur 2026 = 2026-09-20 (Yom Kippur itself is 09-21).
    expect(holidayOnDate(new Date('2026-09-20T20:00:00').getTime())).toBe('ערב יום כפור');
    expect(holidayOnDate(new Date('2026-09-20T15:00:00').getTime())).toBe('ערב יום כפור');
    expect(holidayOnDate(new Date('2026-09-20T10:00:00').getTime())).toBeNull(); // morning: play on
    // Erev Pesach evening warns; morning doesn't.
    expect(holidayOnDate(new Date('2026-04-01T19:00:00').getTime())).toBe('ערב פסח');
    expect(holidayOnDate(new Date('2026-04-01T09:00:00').getTime())).toBeNull();
  });

  it('a FULL holiday day warns at ANY time', () => {
    expect(holidayOnDate(new Date('2026-09-21T09:00:00').getTime())).toBe('יום כפור');
    expect(holidayOnDate(new Date('2026-09-21T22:00:00').getTime())).toBe('יום כפור');
  });

  it('does NOT warn on days people play on', () => {
    expect(holidayOnDate(noon('2026-12-05'))).toBeNull(); // Chanukah
    expect(holidayOnDate(noon('2026-03-03'))).toBeNull(); // Purim
    expect(holidayOnDate(new Date('2026-03-01T20:00:00').getTime())).toBeNull(); // Erev Purim evening — excluded
    expect(holidayOnDate(noon('2026-04-05'))).toBeNull(); // Chol HaMoed Pesach
    expect(holidayOnDate(noon('2026-11-15'))).toBeNull(); // ordinary day
  });

  it('accepts a Date or epoch-ms and handles bad input', () => {
    expect(holidayOnDate(new Date('2026-04-02T12:00:00'))).toBe('פסח א׳');
    expect(holidayOnDate(Number.NaN)).toBeNull();
  });
});
