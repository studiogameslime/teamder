"use strict";
// seasonDates — server-side mirror of `src/utils/seasonDates.ts`.
//
// Cloud Functions cannot import the app source. The import path is the only
// difference; tests/logic/eveningPlayedMirror.test.ts pins the rest.
//
// ---- everything below this line is a copy of the client file ----
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_SEASON_MONTHS = exports.MIN_SEASON_MONTHS = exports.CLUB_TZ = void 0;
exports.isCalendarDate = isCalendarDate;
exports.daysInMonth = daysInMonth;
exports.addMonths = addMonths;
exports.previousDay = previousDay;
exports.nextDay = nextDay;
exports.compareDates = compareDates;
exports.seasonEndDate = seasonEndDate;
exports.nextSeasonStart = nextSeasonStart;
exports.todayIn = todayIn;
exports.isSeasonOver = isSeasonOver;
exports.monthsBetween = monthsBetween;
exports.formatCalendarDate = formatCalendarDate;
exports.isValidSeasonMonths = isValidSeasonMonths;
// Season boundaries, as CALENDAR DATES rather than instants.
//
// A season "ends on 15.12.2026" is a fact about a calendar, not a moment on a
// clock. Storing it as an epoch forces a timezone decision into every read, and
// this app had no timezone infrastructure at all: Cloud Functions run in UTC,
// so the month arithmetic that produced a season's end was UTC arithmetic, and
// a boundary meant to land at local midnight landed at 02:00 or 03:00 Israel
// time depending on daylight saving. Nothing noticed, because until now no
// season had ever rolled over in production.
//
// So the boundary is a 'YYYY-MM-DD' string. Adding months to it is pure
// arithmetic with no zone, no DST and no epoch, which makes the awkward cases —
// 31 August plus six months, 29 February, a year boundary — ordinary rather
// than special. Exactly one function here touches a timezone, and it answers
// only "what is today's date in Israel".
//
// The legacy `endsAt` epoch is still written beside these, because one club is
// already running a season on it and its dates must not move.
/** The club's calendar. Every date here is a day in this zone. */
exports.CLUB_TZ = 'Asia/Jerusalem';
const pad = (n) => String(n).padStart(2, '0');
function isCalendarDate(v) {
    return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
}
/** Split a date into its parts. Throws on nonsense rather than guessing. */
function parts(d) {
    if (!isCalendarDate(d))
        throw new Error(`not a calendar date: ${String(d)}`);
    const [y, m, day] = d.split('-').map(Number);
    return { y, m, day };
}
const toDate = (y, m, day) => `${y}-${pad(m)}-${pad(day)}`;
/** Days in a month, 1-indexed. Handles leap years by construction. */
function daysInMonth(y, m) {
    return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
/**
 * Add whole CALENDAR months, clamped to the last valid day.
 *
 * 31.08 + 6 months is 28.02 (or 29.02 in a leap year), not 03.03 — the naive
 * `setMonth(+6)` rolls over into the next month because 31 February does not
 * exist. Months, never "90 days": three months from 16.09 is 16.12 whether or
 * not those months have 30 or 31 days in them.
 */
function addMonths(d, months) {
    const { y, m, day } = parts(d);
    const total = y * 12 + (m - 1) + Math.trunc(months);
    const ny = Math.floor(total / 12);
    const nm = (total % 12) + 1;
    return toDate(ny, nm, Math.min(day, daysInMonth(ny, nm)));
}
/** The day before. Crosses months and years without special cases. */
function previousDay(d) {
    const { y, m, day } = parts(d);
    if (day > 1)
        return toDate(y, m, day - 1);
    const pm = m === 1 ? 12 : m - 1;
    const py = m === 1 ? y - 1 : y;
    return toDate(py, pm, daysInMonth(py, pm));
}
/** The day after. */
function nextDay(d) {
    const { y, m, day } = parts(d);
    if (day < daysInMonth(y, m))
        return toDate(y, m, day + 1);
    const nm = m === 12 ? 1 : m + 1;
    const ny = m === 12 ? y + 1 : y;
    return toDate(ny, nm, 1);
}
/** Chronological comparison. Lexicographic order IS date order for this shape,
 *  which is the reason to store it this way. */
function compareDates(a, b) {
    return a < b ? -1 : a > b ? 1 : 0;
}
/**
 * The LAST day a season of `months` beginning on `start` is still valid.
 *
 * Inclusive, and one day short of the anniversary: a three-month season
 * starting 16.09.2026 runs through 15.12.2026, and the next begins on 16.12.
 * Without the minus-one day the two seasons would both claim the 16th.
 */
function seasonEndDate(start, months) {
    return previousDay(addMonths(start, months));
}
/** When the season after one ending on `end` begins — the very next day. */
function nextSeasonStart(end) {
    return nextDay(end);
}
/**
 * Today's date in the club's calendar.
 *
 * The ONLY timezone-aware function in this module, and the reason the rest can
 * be pure. `en-CA` is used because it formats as YYYY-MM-DD, which is the shape
 * everything else here speaks.
 */
function todayIn(tz = exports.CLUB_TZ, now = Date.now()) {
    const s = new Date(now).toLocaleDateString('en-CA', { timeZone: tz });
    // Some runtimes return a localised order despite 'en-CA'; fall back to
    // building the date from the parts rather than trusting the string shape.
    if (isCalendarDate(s))
        return s;
    const f = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(new Date(now));
    const get = (t) => f.find((p) => p.type === t)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')}`;
}
/**
 * Has a season ending on `end` finished?
 *
 * True only once the club's calendar has moved PAST that day — the season is
 * valid through the end of it. This is what keeps a rollover on the club's
 * midnight rather than on UTC's.
 */
function isSeasonOver(end, today) {
    return compareDates(today, end) > 0;
}
/** Whole months between two dates, for showing a legacy season's length. */
function monthsBetween(start, end) {
    const a = parts(start);
    const b = parts(nextDay(end));
    return b.y * 12 + b.m - (a.y * 12 + a.m);
}
/** 'YYYY-MM-DD' → '16.09.2026', the form the app shows dates in. */
function formatCalendarDate(d) {
    const { y, m, day } = parts(d);
    return `${pad(day)}.${pad(m)}.${y}`;
}
/** Bounds for a custom season length, in months. */
exports.MIN_SEASON_MONTHS = 1;
exports.MAX_SEASON_MONTHS = 24;
function isValidSeasonMonths(n) {
    return (typeof n === 'number' &&
        Number.isInteger(n) &&
        n >= exports.MIN_SEASON_MONTHS &&
        n <= exports.MAX_SEASON_MONTHS);
}
