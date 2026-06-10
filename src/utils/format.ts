// Canonical date/time formatting helpers.
//
// Until now every screen rolled its own variant of `formatDate` /
// `formatTime` — six of them, with subtly different separators
// ("." vs "/" vs " | "), day-name styles (full Hebrew vs א׳ short),
// and inclusion of year/time. That made the same game render its
// start time differently across cards, hero blocks, and forms.
//
// Each helper here is intentionally narrow — the `formatDayDate`
// option object covers the customisations the existing call sites
// actually used; everything else is built from `pad2` + the day
// constants.

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** "יום ראשון", "יום שני", … "שבת". Index = `Date.getDay()`. */
export const HEBREW_DAYS_LONG = [
  'יום ראשון',
  'יום שני',
  'יום שלישי',
  'יום רביעי',
  'יום חמישי',
  'יום שישי',
  'שבת',
] as const;

/** "א׳", "ב׳", … "ש׳". Compact form for tight UI like wizard summaries. */
export const HEBREW_DAYS_SHORT = [
  'א׳',
  'ב׳',
  'ג׳',
  'ד׳',
  'ה׳',
  'ו׳',
  'ש׳',
] as const;

/** "HH:MM" 24h. */
export function formatTime(ms: number): string {
  const d = new Date(ms);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/**
 * Friendly Hebrew "time until kickoff" for upcoming games — e.g. "עוד 40 דק׳",
 * "עוד 3 שעות", "מחר", "בעוד 4 ימים". Returns null when the game already
 * started (handled by status elsewhere) or is more than ~6 days out (the
 * absolute date already says enough).
 */
export function relativeKickoff(ms: number, now = Date.now()): string | null {
  const diff = ms - now;
  if (diff <= 0) return null;
  const MIN = 60 * 1000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;
  if (diff < HOUR) {
    const m = Math.max(1, Math.round(diff / MIN));
    return `עוד ${m} דק׳`;
  }
  // Calendar-aware today/tomorrow so an 11 PM game tonight isn't "tomorrow".
  const dayStart = (x: number) => {
    const d = new Date(x);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  };
  const days = Math.round((dayStart(ms) - dayStart(now)) / DAY);
  if (days <= 0) {
    const h = Math.round(diff / HOUR);
    // Hebrew dual form: 1 → "שעה", 2 → "שעתיים", 3+ → "N שעות".
    if (h === 1) return 'עוד שעה';
    if (h === 2) return 'עוד שעתיים';
    return `עוד ${h} שעות`;
  }
  if (days === 1) return 'מחר';
  if (days === 2) return 'בעוד יומיים';
  if (days <= 6) return `בעוד ${days} ימים`;
  return null;
}

/** "DD.MM" — the dense card variant (no year). */
/**
 * Join a venue label + city for display without duplicating the city.
 * Single-field govmap picks store the FULL place text (which already
 * contains the city) in `fieldName`, so appending the reverse-geocoded
 * `city` again would read "בית ספר רמון רחובות, רחובות". Skip the city
 * when the venue label already contains it. Legacy games (venue + city
 * stored separately) still render "venue, city" as before.
 */
export function joinLocation(fieldName?: string, city?: string): string {
  const f = (fieldName ?? '').trim();
  const c = (city ?? '').trim();
  if (!f) return c;
  if (!c || f.includes(c)) return f;
  return `${f}, ${c}`;
}

export function formatDateShort(ms: number): string {
  const d = new Date(ms);
  return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}`;
}

/** Calendar-day difference: 0 = same day as `now`, 1 = the day after, etc.
 *  Compares local-midnight boundaries so an 11 PM game tonight is "today",
 *  not tomorrow. */
export function dayDiff(ms: number, now = Date.now()): number {
  const dayStart = (x: number) => {
    const d = new Date(x);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  };
  return Math.round((dayStart(ms) - dayStart(now)) / (24 * 60 * 60 * 1000));
}

/**
 * Game day label — "היום" / "מחר" when the game falls today or tomorrow,
 * otherwise the dense "DD.MM". Use this anywhere a GAME's date is shown to
 * the user (cards, lists, details, pushes) so near-term games read
 * naturally instead of as a bare date.
 */
export function formatGameDay(ms: number, now = Date.now()): string {
  const diff = dayDiff(ms, now);
  if (diff === 0) return 'היום';
  if (diff === 1) return 'מחר';
  return formatDateShort(ms);
}

/** "DD.MM.YY" — compact form with two-digit year, used for static
 * "created at" / archive cells where the year still matters but
 * a full slash-separated date would be too wide. */
export function formatDateShortYear(ms: number): string {
  const d = new Date(ms);
  return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${String(d.getFullYear()).slice(2)}`;
}

/** "DD.MM.YYYY" — the form / settings variant (full year). Uses DOT
 * separators to stay consistent with formatDateShort / formatDateShortYear
 * across the app (the wizard date field previously used slashes, which
 * read as a different date in the same flow). */
export function formatDateFull(ms: number): string {
  const d = new Date(ms);
  return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()}`;
}

/** "DD.MM.YYYY · HH:MM" — used by the cancel-deadline display. */
export function formatDateTimeFull(ms: number): string {
  return `${formatDateFull(ms)} · ${formatTime(ms)}`;
}

interface DayDateOptions {
  /** Long ("יום ראשון") vs short ("א׳"). Default: long. */
  day?: 'long' | 'short';
  /** Separator between the day-name and the date. Default: " · ". */
  separator?: string;
  /** Punctuation inside the date itself. Default: ".". */
  dateSeparator?: '.' | '/';
  /** Append two-digit year to the date. Default: false. */
  withYear?: boolean;
  /** When set, append " · HH:MM" (or `timeSeparator`). Default: false. */
  withTime?: boolean;
  /** Separator before the time. Default: " · ". */
  timeSeparator?: string;
  /** Prefix the day name with "יום " (only with `day: 'short'`). Default: false. */
  dayPrefix?: boolean;
}

/**
 * Composable "{day} {sep} {date} [{sep} {time}]" formatter — the core
 * pattern shared by NextGameCard, MatchStadiumHero, GameWizardForm,
 * and MatchDetailsScreen. Each call passes the options matching its
 * existing visual exactly.
 */
export function formatDayDate(ms: number, opts?: DayDateOptions): string {
  const d = new Date(ms);

  // Today / tomorrow short-circuit: collapse "{day} · {date}" to a single
  // "היום" / "מחר" token (per product: near-term games everywhere read as
  // היום/מחר, not a date). The optional time still appends below.
  const diff = dayDiff(ms);
  let out: string;
  if (diff === 0 || diff === 1) {
    out = diff === 0 ? 'היום' : 'מחר';
  } else {
    const dayMode = opts?.day ?? 'long';
    const dayName =
      dayMode === 'short'
        ? HEBREW_DAYS_SHORT[d.getDay()]
        : HEBREW_DAYS_LONG[d.getDay()];
    const dayLabel = opts?.dayPrefix ? `יום ${dayName}` : dayName;
    const sep = opts?.separator ?? ' · ';
    const dateSep = opts?.dateSeparator ?? '.';
    let dateStr = `${pad2(d.getDate())}${dateSep}${pad2(d.getMonth() + 1)}`;
    if (opts?.withYear) {
      dateStr += `${dateSep}${String(d.getFullYear()).slice(2)}`;
    }
    out = `${dayLabel}${sep}${dateStr}`;
  }

  if (opts?.withTime) {
    const timeSep = opts?.timeSeparator ?? ' · ';
    out += `${timeSep}${formatTime(ms)}`;
  }
  return out;
}
