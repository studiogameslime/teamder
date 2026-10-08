// Cross-source link-click totals for the Overview headline card.
//
// Every share link (tracked ad links, legacy source links, personal invite
// links, and /i/<code> short links) increments a running counter; the Teamder
// `trackLinkClick` / `serveInviteCode` functions ALSO bump a single aggregate
// doc at `metrics/linkClicks`:
//   • total            — all-time count (seeded once from the per-link counters)
//   • days.<YYYY-MM-DD> — per-day count, keyed in Israel time
// so the dashboard can slice today / yesterday / this week without a full scan.
//
// NOTE: the daily map only fills from the day the aggregate shipped — historical
// clicks live in `total` (accurate) but not in `days`. So today/yesterday/week
// read 0 until clicks accumulate; all-time is correct immediately.

import { getDoc } from './firestoreRest';

/** The single strongest source so far today — a campaign or someone's invite. */
export interface TopLinkToday {
  label: string; // human label — "הקישור של דני" / "קמפיין וואטסאפ"
  count: number;
  kind: string; // 'invite' | 'ad'
}

export interface LinkClickStats {
  today: number;
  yesterday: number;
  week: number; // this week: Sunday → now (Israel time)
  allTime: number;
  topToday: TopLinkToday | null;
}

const DAY = 24 * 60 * 60 * 1000;

/** Israel-local calendar date (YYYY-MM-DD) for an epoch ms. */
function ilDateKey(ms: number): string {
  return new Date(ms).toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
}

export async function fetchLinkClickStats(): Promise<LinkClickStats> {
  const doc = await getDoc('metrics/linkClicks').catch(() => null);
  const allTime = Number(doc?.total ?? 0);
  const days: Record<string, number> = (doc?.days as Record<string, number>) ?? {};

  const now = Date.now();
  const todayKey = ilDateKey(now);
  const yesterdayKey = ilDateKey(now - DAY);

  // Israel weekday of "now" (0 = Sunday) → sum from this week's Sunday to today.
  const ilNow = new Date(new Date(now).toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }));
  const dow = ilNow.getDay();
  let week = 0;
  for (let i = 0; i <= dow; i++) week += Number(days[ilDateKey(now - i * DAY)] ?? 0);

  return {
    today: Number(days[todayKey] ?? 0),
    yesterday: Number(days[yesterdayKey] ?? 0),
    week,
    allTime,
    topToday: await computeTopLinkToday(doc, todayKey).catch(() => null),
  };
}

/**
 * The most-clicked single link today, resolved to a human label + owner.
 * Reads one small per-day doc (`metrics/linkClicksByDay/<day>`) and, for the
 * winner only, one user doc to resolve the inviter's name — cheap by design.
 */
// Reads the per-day per-link breakdown from the SAME metrics/linkClicks doc
// (nested `byDayLinks.<day>` + `byDayMeta.<day>`), so no extra document fetch.
async function computeTopLinkToday(
  mainDoc: any,
  todayKey: string,
): Promise<TopLinkToday | null> {
  const counts: Record<string, number> =
    (mainDoc?.byDayLinks?.[todayKey] as Record<string, number>) ?? {};
  const meta: Record<string, any> =
    (mainDoc?.byDayMeta?.[todayKey] as Record<string, any>) ?? {};

  let topKey = '';
  let topCount = 0;
  for (const [k, v] of Object.entries(counts)) {
    const n = Number(v ?? 0);
    if (n > topCount) {
      topCount = n;
      topKey = k;
    }
  }
  if (!topKey || topCount <= 0) return null;

  const m = meta[topKey] ?? {};
  const kind = String(m.kind ?? 'link');
  const inviterId = typeof m.inviterId === 'string' ? m.inviterId : '';
  const linkId = typeof m.linkId === 'string' ? m.linkId : '';
  const source = typeof m.source === 'string' ? m.source : '';

  // Resolve a friendly label for the winner only (one extra read at most):
  //  • a person's invite → their name          → "הקישור של דני"
  //  • a campaign/ad link → the adLink's name   → "קמפיין וואטסאפ"
  //  • a legacy source bucket                    → "קמפיין <source>"
  let label: string;
  if (inviterId) {
    const u = await getDoc(`users/${inviterId}`).catch(() => null);
    const name = (u?.name as string) || inviterId.slice(0, 6);
    label = `הקישור של ${name}`;
  } else if (linkId) {
    const a = await getDoc(`adLinks/${linkId}`).catch(() => null);
    const name = (a?.name as string) || source || linkId;
    label = `קמפיין ${name}`;
  } else if (source) {
    label = `קמפיין ${source}`;
  } else {
    label = 'קישור הזמנה';
  }

  return { label, count: topCount, kind };
}
