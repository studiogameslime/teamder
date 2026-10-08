// Free-tier usage monitor. Pulls real usage from Google Cloud Monitoring
// (Firestore reads/writes/deletes, Cloud Functions invocations) and Cloud
// Scheduler (cron job count), then compares each against the Firebase /
// Google Cloud no-cost quota so we can see how close we are to paying.
//
// Quotas are the documented Blaze "no-cost" allowances:
//   Firestore : 50K reads · 20K writes · 20K deletes  — per DAY (resets daily)
//   Functions : 2,000,000 invocations                 — per MONTH
//   Scheduler : 3 jobs                                 — fixed (per project)

import AsyncStorage from '@react-native-async-storage/async-storage';
import { googleAccessToken } from './auth';
import { notify } from './notify';
import { config } from '../config';
import { getReadMeter } from './readMeter';

const PID = config.firebase.projectId;
const SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

// Locations to probe for Cloud Scheduler jobs (Firebase puts them in
// us-central1; we also check a few others in case some were added there).
const SCHEDULER_LOCATIONS = ['us-central1', 'me-west1', 'europe-west1', 'us-east1'];

export type QuotaItem = {
  key: string;
  label: string;
  icon: string;
  used: number | null; // null = couldn't read this metric
  limit: number;
  period: 'יום' | 'חודש' | 'קבוע';
  resetAt: number | null; // epoch ms of the next reset; null = never (fixed)
  detail?: string; // e.g. job names
  // Where this number breaks down — e.g. reads split by type (QUERY/LOOKUP),
  // or Pulse's own reads split by collection. Rendered under the bar.
  breakdown?: { label: string; value: number }[];
  note?: string; // small caption under the item (e.g. "השאר = האפליקציה")
  // Informational rows (e.g. "Pulse vs the app") are NOT real free-tier
  // limits — their `limit` is a moving reference (today's monitored total),
  // so the ratio is meaningless as an alert and must never fire a push.
  informational?: boolean;
};

export type QuotaGroup = {
  title: string;
  resetNote: string;
  items: QuotaItem[];
};

export type QuotaReport = {
  groups: QuotaGroup[];
  fetchedAt: number;
};

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

// ── Google quota reset boundaries — midnight US Pacific ──────────────
// Firebase/Google Cloud daily & monthly free quotas reset at midnight
// Pacific time (≈10:00 in Israel), NOT local midnight. We compute the
// Pacific day/month start so "used" matches exactly what Google counts.
function nthSundayUTC(y: number, monthIdx: number, n: number): number {
  const firstDow = new Date(Date.UTC(y, monthIdx, 1)).getUTCDay(); // 0 = Sun
  return 1 + ((7 - firstDow) % 7) + (n - 1) * 7;
}
function isUsPacificDst(ms: number): boolean {
  const y = new Date(ms).getUTCFullYear();
  const start = Date.UTC(y, 2, nthSundayUTC(y, 2, 2), 10, 0, 0); // 2nd Sun Mar 02:00 PST
  const end = Date.UTC(y, 10, nthSundayUTC(y, 10, 1), 9, 0, 0); // 1st Sun Nov 02:00 PDT
  return ms >= start && ms < end;
}
function pacificOffsetH(ms: number): number {
  return isUsPacificDst(ms) ? 7 : 8;
}
function pacificDayStartMs(ms: number): number {
  const off = pacificOffsetH(ms);
  const s = new Date(ms - off * 3600_000);
  return Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate(), 0, 0, 0) + off * 3600_000;
}
function pacificMonthStartMs(ms: number): number {
  const off = pacificOffsetH(ms);
  const s = new Date(ms - off * 3600_000);
  return Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), 1, 0, 0, 0) + off * 3600_000;
}
// Next reset boundaries — step safely past any DST seam, then floor.
function nextDailyResetMs(ms: number): number {
  return pacificDayStartMs(pacificDayStartMs(ms) + 25 * 3600_000);
}
function nextMonthlyResetMs(ms: number): number {
  return pacificMonthStartMs(pacificMonthStartMs(ms) + 32 * 86_400_000);
}

// Sum a DELTA metric over [startMs, endMs] into a single number.
async function metricSum(
  token: string,
  metric: string,
  startMs: number,
  endMs: number,
): Promise<number | null> {
  const alignSec = Math.max(60, Math.ceil((endMs - startMs) / 1000));
  const url =
    `https://monitoring.googleapis.com/v3/projects/${PID}/timeSeries?` +
    `filter=${encodeURIComponent(`metric.type="${metric}"`)}` +
    `&interval.startTime=${iso(startMs)}&interval.endTime=${iso(endMs)}` +
    `&aggregation.alignmentPeriod=${alignSec}s` +
    `&aggregation.perSeriesAligner=ALIGN_SUM` +
    `&aggregation.crossSeriesReducer=REDUCE_SUM`;
  try {
    const res = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
    const json = await res.json();
    if (json.error) return null;
    let sum = 0;
    for (const ts of json.timeSeries ?? []) {
      for (const p of ts.points ?? []) {
        sum += Number(p.value?.int64Value ?? p.value?.doubleValue ?? 0);
      }
    }
    return sum;
  } catch {
    return null;
  }
}

// Same as metricSum, but keep the per-`type` split (QUERY / LOOKUP /
// NOT_FOUND) instead of collapsing to one number — this is the only "on what
// do the reads go" dimension Cloud Monitoring exposes for Firestore.
async function metricByType(
  token: string,
  metric: string,
  startMs: number,
  endMs: number,
): Promise<{ type: string; value: number }[] | null> {
  const alignSec = Math.max(60, Math.ceil((endMs - startMs) / 1000));
  const url =
    `https://monitoring.googleapis.com/v3/projects/${PID}/timeSeries?` +
    `filter=${encodeURIComponent(`metric.type="${metric}"`)}` +
    `&interval.startTime=${iso(startMs)}&interval.endTime=${iso(endMs)}` +
    `&aggregation.alignmentPeriod=${alignSec}s` +
    `&aggregation.perSeriesAligner=ALIGN_SUM`;
  try {
    const res = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
    const json = await res.json();
    if (json.error) return null;
    const byType = new Map<string, number>();
    for (const ts of json.timeSeries ?? []) {
      const type = ts.metric?.labels?.type ?? 'אחר';
      let sum = 0;
      for (const p of ts.points ?? []) {
        sum += Number(p.value?.int64Value ?? p.value?.doubleValue ?? 0);
      }
      byType.set(type, (byType.get(type) ?? 0) + sum);
    }
    return [...byType.entries()]
      .map(([type, value]) => ({ type, value }))
      .sort((a, b) => b.value - a.value);
  } catch {
    return null;
  }
}

const READ_TYPE_HE: Record<string, string> = {
  QUERY: 'שאילתות + מאזינים (queries/listeners)',
  LOOKUP: 'קריאת מסמך בודד (lookup)',
  NOT_FOUND: 'חיפוש מסמך שלא קיים',
};

// Map a Pulse read-meter source (collection name) to a friendly Hebrew label.
const SOURCE_HE: Record<string, string> = {
  users: 'משתמשים',
  games: 'משחקים',
  groups: 'מועדונים',
  feedback: 'משוב',
  errors: 'שגיאות',
  inviteClicks: 'קליקים על הזמנות',
  chatReports: 'דיווחי צ׳אט',
  appConfig: 'הגדרות אפליקציה',
};
function sourceHe(s: string): string {
  // Handle the "(ספירה)" / "(צ׳אט)" suffixes the meter adds.
  const m = s.match(/^(.*?)\s*(\(.*\))?$/);
  const base = (m?.[1] ?? s).trim();
  const suffix = m?.[2] ? ' ' + m[2] : '';
  return (SOURCE_HE[base] ?? base) + suffix;
}

async function schedulerJobs(token: string): Promise<{ count: number; names: string[] } | null> {
  const names: string[] = [];
  let any = false;
  for (const loc of SCHEDULER_LOCATIONS) {
    try {
      const res = await fetch(
        `https://cloudscheduler.googleapis.com/v1/projects/${PID}/locations/${loc}/jobs`,
        { headers: { Authorization: 'Bearer ' + token } },
      );
      const json = await res.json();
      if (json.jobs) {
        any = true;
        for (const j of json.jobs) names.push(String(j.name).split('/').pop() ?? '');
      }
    } catch {
      // ignore a single location failing
    }
  }
  if (!any && names.length === 0) return null;
  return { count: names.length, names };
}

export async function fetchQuota(): Promise<QuotaReport> {
  const token = await googleAccessToken(SCOPE);
  const now = Date.now();
  // Align to Google's quota reset (midnight Pacific ≈ 10:00 Israel), not local.
  const startToday = pacificDayStartMs(now);
  const startMonth = pacificMonthStartMs(now);
  const dailyReset = nextDailyResetMs(now);
  const monthlyReset = nextMonthlyResetMs(now);

  const [readTypes, writes, deletes, fnCalls, sched, meter] = await Promise.all([
    metricByType(token, 'firestore.googleapis.com/document/read_count', startToday, now),
    metricSum(token, 'firestore.googleapis.com/document/write_count', startToday, now),
    metricSum(token, 'firestore.googleapis.com/document/delete_count', startToday, now),
    metricSum(token, 'cloudfunctions.googleapis.com/function/execution_count', startMonth, now),
    schedulerJobs(token),
    getReadMeter().catch(() => null),
  ]);

  const reads = readTypes ? readTypes.reduce((s, t) => s + t.value, 0) : null;
  const readBreakdown = readTypes
    ? readTypes.map((t) => ({ label: READ_TYPE_HE[t.type] ?? t.type, value: t.value }))
    : undefined;

  // "Of today's reads, how much was Pulse itself" — the rest is the live app.
  const pulseItems: QuotaItem[] = [];
  if (meter && reads != null) {
    const pulseOther = Math.max(0, reads - meter.total);
    pulseItems.push({
      key: 'pulseReads',
      label: 'קריאות של פולס (המכשיר הזה)',
      icon: 'phone-portrait-outline',
      used: meter.total,
      limit: reads || 1,
      period: 'יום',
      resetAt: dailyReset,
      informational: true, // breakdown only — never alert on this ratio
      breakdown: meter.sources.map((s) => ({ label: sourceHe(s.source), value: s.reads })),
      note:
        `מתוך ${reads.toLocaleString('en-US')} הקריאות היום, פולס אחראי ל-` +
        `${meter.total.toLocaleString('en-US')}. השאר (~${pulseOther.toLocaleString('en-US')}) = ` +
        `האפליקציה עצמה. (נמדד מאז העדכון הזה)`,
    });
  }

  return {
    fetchedAt: now,
    groups: [
      {
        title: 'Firestore',
        resetNote: 'מתאפס כל יום בחצות שעון Pacific — בערך 10:00 בבוקר בישראל',
        items: [
          { key: 'reads', label: 'קריאות', icon: 'download-outline', used: reads, limit: 50000, period: 'יום', resetAt: dailyReset, breakdown: readBreakdown },
          { key: 'writes', label: 'כתיבות', icon: 'create-outline', used: writes, limit: 20000, period: 'יום', resetAt: dailyReset },
          { key: 'deletes', label: 'מחיקות', icon: 'trash-outline', used: deletes, limit: 20000, period: 'יום', resetAt: dailyReset },
        ],
      },
      ...(pulseItems.length
        ? [{
            title: 'פירוט קריאות — פולס מול האפליקציה',
            resetNote: 'מה פולס קרא היום, לפי מקור. השאר הוא תעבורת האפליקציה החיה.',
            items: pulseItems,
          }]
        : []),
      {
        title: 'Cloud Functions',
        resetNote: 'מתאפס ב-1 לכל חודש (חצות שעון Pacific)',
        items: [
          { key: 'fn', label: 'הפעלות', icon: 'flash-outline', used: fnCalls, limit: 2000000, period: 'חודש', resetAt: monthlyReset },
        ],
      },
      {
        title: 'Cloud Scheduler',
        resetNote: 'מכסה קבועה — 3 jobs חינם לפרויקט',
        items: [
          {
            key: 'sched',
            label: 'משימות מתוזמנות',
            icon: 'time-outline',
            used: sched ? sched.count : null,
            limit: 3,
            period: 'קבוע',
            resetAt: null,
            detail: sched?.names.join(' · '),
          },
        ],
      },
    ],
  };
}

// ── Limit alerts ────────────────────────────────────────────────────
// Fire a local push for any resettable quota at/over 50% of its free limit,
// at most once per reset period. We dedupe on the next-reset timestamp: once
// the quota resets, resetAt changes and the alert re-arms automatically.
export const ALERT_THRESHOLD = 0.5;
const ALERT_KEY = 'quotaAlertState';

export async function notifyQuotaAlerts(report: QuotaReport): Promise<void> {
  let state: Record<string, number> = {};
  try {
    const raw = await AsyncStorage.getItem(ALERT_KEY);
    if (raw) state = JSON.parse(raw);
  } catch {
    /* ignore */
  }

  let changed = false;
  for (const g of report.groups) {
    for (const it of g.items) {
      if (it.period === 'קבוע' || it.used == null || it.resetAt == null) continue;
      if (it.informational) continue; // breakdown row, not a real limit
      const pct = it.limit > 0 ? it.used / it.limit : 0;
      if (pct < ALERT_THRESHOLD) continue;
      if (state[it.key] === it.resetAt) continue; // already alerted this period
      await notify(
        `⚠️ מכסת ${g.title} — ${it.label}`,
        `הגעת ל-${Math.round(pct * 100)}% מהחינמי ` +
          `(${it.used.toLocaleString('en-US')}/${it.limit.toLocaleString('en-US')}). ` +
          `מתאפס ${it.period === 'יום' ? 'מחר ב-10:00' : 'בתחילת החודש'}.`,
        { type: 'quota', quota: it.key },
      );
      state[it.key] = it.resetAt;
      changed = true;
    }
  }
  if (changed) {
    try {
      await AsyncStorage.setItem(ALERT_KEY, JSON.stringify(state));
    } catch {
      /* ignore */
    }
  }
}

// Fetch quota + fire alerts. Hits Cloud Monitoring (not Firestore), so it
// costs nothing against the quota it's protecting — safe on every app open.
export async function checkAndNotifyQuota(): Promise<void> {
  try {
    await notifyQuotaAlerts(await fetchQuota());
  } catch {
    /* ignore — never block app open on this */
  }
}
