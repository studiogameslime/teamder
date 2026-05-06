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

/** "DD.MM" — the dense card variant (no year). */
export function formatDateShort(ms: number): string {
  const d = new Date(ms);
  return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}`;
}

/** "DD.MM.YY" — compact form with two-digit year, used for static
 * "created at" / archive cells where the year still matters but
 * a full slash-separated date would be too wide. */
export function formatDateShortYear(ms: number): string {
  const d = new Date(ms);
  return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${String(d.getFullYear()).slice(2)}`;
}

/** "DD/MM/YYYY" — the form / settings variant (full year). */
export function formatDateFull(ms: number): string {
  const d = new Date(ms);
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** "DD/MM/YYYY · HH:MM" — used by the cancel-deadline display. */
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

  let out = `${dayLabel}${sep}${dateStr}`;
  if (opts?.withTime) {
    const timeSep = opts.timeSeparator ?? ' · ';
    out += `${timeSep}${formatTime(ms)}`;
  }
  return out;
}
