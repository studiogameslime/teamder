import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/he';

dayjs.extend(relativeTime);
dayjs.locale('he');

export function timeAgo(when: string | number): string {
  return dayjs(when).fromNow();
}

export function money(n: number, currency = 'USD'): string {
  const sym =
    currency === 'USD'
      ? '$'
      : currency === 'EUR'
        ? '€'
        : currency === 'ILS'
          ? '₪'
          : currency + ' ';
  // Defensive: a stale cached snapshot (older shape) can yield undefined for
  // a newly-added field — coerce so a missing number renders as 0, not a crash.
  return sym + (Number.isFinite(n) ? n : 0).toFixed(2);
}

export function compact(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}
