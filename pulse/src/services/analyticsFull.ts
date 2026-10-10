// Rich analytics for the Analytics screen — combines GA4 (users, time,
// devices, channels, events) with Firestore (app-specific engagement
// funnels: communities, game/community creation, registrations).

import { config } from '../config';
import { has } from '../secrets';
import type { NameCount } from '../types';
import { googleOAuthToken } from './auth';
import { listAll, queryByCreatedAt } from './firestoreRest';
import { isTestAccount } from './firebase';

export interface AnalyticsFull {
  // KPIs (current period + % change vs the previous equal-length period)
  activeUsers: number; activeUsersDelta: number | null;
  newUsers: number; newUsersDelta: number | null;
  returnRate: number; returnRateDelta: number | null; // 0..1
  avgEngagementSec: number; avgEngagementDelta: number | null;
  // engagement funnels (Firestore, all-time)
  totalUsers: number;
  inCommunity: number;
  notInCommunity: number;
  createdGame: number;
  registeredGame: number;
  createdCommunity: number;
  // breakdowns
  topActions: NameCount[]; // top GA events (mapped to Hebrew where known)
  acquisition: NameCount[]; // first-user channel
  devices: NameCount[]; // by OS (Android / iOS)
  // push (Firestore notifications)
  pushSent: number;
  pushOpened: number;
  // social — friend requests
  friendsSent: number;
  friendsAccepted: number;
}

const GA_URL = () =>
  `https://analyticsdata.googleapis.com/v1beta/properties/${config.analytics.propertyId}:runReport`;

async function ga(token: string, body: object): Promise<any> {
  const res = await fetch(GA_URL(), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`GA ${res.status}`);
  return res.json();
}

const num = (v: any) => Number(v ?? 0);
const delta = (cur: number, prev: number): number | null =>
  prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null;

// Hebrew labels for known app events.
// Hebrew labels for the app's real GA events (verified against the property).
const EVENT_LABEL: Record<string, string> = {
  game_viewed: 'צפו במשחק',
  group_viewed: 'צפו בקהילה',
  game_joined: 'הצטרפו למשחק',
  game_created: 'יצרו משחק',
  group_created: 'יצרו קהילה',
  recurring_game_created: 'יצרו משחק קבוע',
  game_cancelled: 'ביטלו משחק',
  game_edited: 'ערכו משחק',
  game_finished: 'סיימו משחק',
  match_round_completed: 'סיימו סבב',
  live_match_opened: 'פתחו משחק חי',
  sign_in_success: 'התחברו',
  onboarding_completed: 'השלימו הצטרפות',
  profile_created: 'יצרו פרופיל',
  profile_edited: 'ערכו פרופיל',
  avatar_changed: 'שינו אווטאר',
  photo_uploaded: 'העלו תמונה',
  invite_shared: 'שיתפו הזמנה',
  guest_added: 'הוסיפו אורח',
  group_search: 'חיפשו קהילה',
  group_join_requested: 'ביקשו להצטרף לקהילה',
  group_join_approved: 'אושרו לקהילה',
  group_settings_edited: 'ערכו הגדרות קהילה',
  quick_game_flow_started: 'התחילו משחק מהיר',
  achievement_unlocked: 'פתחו הישג',
  achievements_opened: 'פתחו הישגים',
  game_filter_applied: 'סיננו משחקים',
  game_filter_sheet_opened: 'פתחו סינון',
  games_tab_switched: 'החליפו טאב משחקים',
  notification_receive: 'קיבלו התראה',
  notification_open: 'פתחו התראה',
  notification_dismiss: 'ביטלו התראה',
  notification_foreground: 'התראה בחזית',
  player_card_opened: 'פתחו כרטיס שחקן',
  friend_picker_opened: 'פתחו בחירת חברים',
  friends_screen_opened: 'פתחו מסך חברים',
  history_opened: 'פתחו היסטוריה',
  stats_opened: 'פתחו סטטיסטיקות',
  rate_app_clicked: 'לחצו על דרג אפליקציה',
  store_review_prompted: 'הוצע דירוג',
  report_bug_clicked: 'דיווחו על באג',
  registration_conflict_blocked: 'התנגשות רישום',
  availability_set: 'הגדירו זמינות',
  friends_invited_to_game: 'הזמינו חברים למשחק',
  quick_game_created: 'יצרו משחק מהיר',
  game_approval_decided: 'החליטו על אישור משחק',
  late_cancel: 'ביטלו באיחור',
  suggest_feature_clicked: 'הציעו פיצ׳ר',
  community_cover_uploaded: 'העלו תמונת קהילה',
  friend_request_sent: 'שלחו בקשת חברות',
  friend_request_declined: 'דחו בקשת חברות',
  game_started: 'התחילו משחק',
  game_started_join_attempt: 'ניסיון הצטרפות במשחק חי',
  guest_removed: 'הסירו אורח',
  notification_pref_changed: 'שינו העדפות התראות',
  notifications_toggled: 'הפעילו/כיבו התראות',
  waitlist_joined: 'הצטרפו לרשימת המתנה',
};
// Automatic / lifecycle events that aren't meaningful "user actions".
const SKIP_EVENTS = new Set([
  'first_open', 'user_engagement', 'app_remove', 'session_start',
  'os_update', 'app_update', 'app_clear_data', 'app_exception',
  'screen_view', 'app_foregrounded', 'app_backgrounded',
]);

const CHANNEL_LABEL: Record<string, string> = {
  'Organic Search': 'חיפוש אורגני',
  Direct: 'ישיר',
  Referral: 'הפניה',
  'Organic Social': 'רשתות חברתיות',
  'Paid Search': 'חיפוש בתשלום',
  'Organic Shopping': 'חנות',
  Unassigned: 'לא מסווג',
  '(other)': 'אחר',
};

export type RangeKey = 'today' | 'yesterday' | '7d' | 'all';
interface RangeSpec {
  cur: { startDate: string; endDate: string };
  prev: { startDate: string; endDate: string } | null;
  startMs: number;
  endMs: number;
}
function rangeSpec(key: RangeKey): RangeSpec {
  const DAY = 86_400_000;
  const now = Date.now();
  const sot = new Date(new Date().setHours(0, 0, 0, 0)).getTime();
  switch (key) {
    case 'today':
      return { cur: { startDate: 'today', endDate: 'today' }, prev: { startDate: 'yesterday', endDate: 'yesterday' }, startMs: sot, endMs: now };
    case 'yesterday':
      return { cur: { startDate: 'yesterday', endDate: 'yesterday' }, prev: { startDate: '2daysAgo', endDate: '2daysAgo' }, startMs: sot - DAY, endMs: sot };
    case '7d':
      return { cur: { startDate: '7daysAgo', endDate: 'today' }, prev: { startDate: '14daysAgo', endDate: '8daysAgo' }, startMs: now - 7 * DAY, endMs: now };
    case 'all':
    default:
      return { cur: { startDate: '2020-01-01', endDate: 'today' }, prev: null, startMs: 0, endMs: now };
  }
}

// Short-lived cache so re-opening the Analytics screen (or switching tabs
// and back) within a few minutes reuses the result instead of re-reading
// Firestore. Pull-to-refresh passes { force: true } to bypass it.
const CACHE_TTL_MS = 3 * 60_000;
const fullCache = new Map<RangeKey, { at: number; data: AnalyticsFull }>();

export async function fetchAnalyticsFull(
  rangeKey: RangeKey,
  opts: { force?: boolean } = {},
): Promise<AnalyticsFull> {
  if (!opts.force) {
    const hit = fullCache.get(rangeKey);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;
  }
  const spec = rangeSpec(rangeKey);
  const empty: AnalyticsFull = {
    activeUsers: 0, activeUsersDelta: null,
    newUsers: 0, newUsersDelta: null,
    returnRate: 0, returnRateDelta: null,
    avgEngagementSec: 0, avgEngagementDelta: null,
    totalUsers: 0, inCommunity: 0, notInCommunity: 0,
    createdGame: 0, registeredGame: 0, createdCommunity: 0,
    topActions: [], acquisition: [], devices: [], pushSent: 0, pushOpened: 0,
    friendsSent: 0, friendsAccepted: 0,
  };

  // ── GA4 (best-effort) ────────────────────────────────────────────
  if (has.analytics()) {
    try {
      const token = await googleOAuthToken();

      const totals = await ga(token, {
        dateRanges: spec.prev ? [spec.cur, spec.prev] : [spec.cur],
        metrics: [
          { name: 'activeUsers' },
          { name: 'newUsers' },
          { name: 'averageSessionDuration' },
        ],
      });
      const r0 = totals.rows ?? [];
      // dateRange 0 = current, 1 = previous (GA returns a dateRange dimension)
      const byRange: Record<string, any[]> = { '0': [], '1': [] };
      (r0).forEach((row: any) => {
        const idx = row.dimensionValues?.[0]?.value ?? '0';
        byRange[idx] = row.metricValues ?? [];
      });
      // When no dimension, GA returns one row per dateRange in order.
      const cm = r0[0]?.metricValues ?? [];
      const pm = r0[1]?.metricValues ?? [];
      empty.activeUsers = num(cm[0]?.value);
      empty.newUsers = num(cm[1]?.value);
      empty.avgEngagementSec = Math.round(num(cm[2]?.value));
      empty.activeUsersDelta = delta(empty.activeUsers, num(pm[0]?.value));
      empty.newUsersDelta = delta(empty.newUsers, num(pm[1]?.value));
      empty.avgEngagementDelta = delta(empty.avgEngagementSec, num(pm[2]?.value));

      // returning %  (newVsReturning dimension)
      const ret = await ga(token, {
        dateRanges: [spec.cur],
        dimensions: [{ name: 'newVsReturning' }],
        metrics: [{ name: 'activeUsers' }],
      }).catch(() => ({ rows: [] }));
      let returning = 0, allu = 0;
      (ret.rows ?? []).forEach((row: any) => {
        const v = num(row.metricValues?.[0]?.value);
        allu += v;
        if ((row.dimensionValues?.[0]?.value ?? '').toLowerCase().includes('return')) returning += v;
      });
      empty.returnRate = allu ? returning / allu : 0;

      // devices by OS
      const os = await ga(token, {
        dateRanges: [spec.cur],
        dimensions: [{ name: 'operatingSystem' }],
        metrics: [{ name: 'activeUsers' }],
      }).catch(() => ({ rows: [] }));
      empty.devices = (os.rows ?? []).map((row: any) => ({
        name: row.dimensionValues?.[0]?.value ?? '—',
        value: num(row.metricValues?.[0]?.value),
      })).sort((a: NameCount, b: NameCount) => b.value - a.value);

      // acquisition channel
      const acq = await ga(token, {
        dateRanges: [spec.cur],
        dimensions: [{ name: 'firstUserDefaultChannelGroup' }],
        metrics: [{ name: 'activeUsers' }],
        orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }],
        limit: 8,
      }).catch(() => ({ rows: [] }));
      empty.acquisition = (acq.rows ?? []).map((row: any) => {
        const raw = row.dimensionValues?.[0]?.value ?? '—';
        return { name: CHANNEL_LABEL[raw] ?? raw, value: num(row.metricValues?.[0]?.value) };
      });

      // events — return ALL meaningful ones (the screen shows top N + "show more")
      const ev = await ga(token, {
        dateRanges: [spec.cur],
        dimensions: [{ name: 'eventName' }],
        metrics: [{ name: 'eventCount' }],
        orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
        limit: 100,
      }).catch(() => ({ rows: [] }));
      empty.topActions = (ev.rows ?? [])
        .map((row: any) => ({ raw: row.dimensionValues?.[0]?.value ?? '', value: num(row.metricValues?.[0]?.value) }))
        .filter((e: any) => !SKIP_EVENTS.has(e.raw))
        .map((e: any) => ({ name: EVENT_LABEL[e.raw] ?? e.raw, value: e.value }));
    } catch {
      /* GA unavailable — keep zeros */
    }
  }

  // ── Firestore funnels (best-effort) ──────────────────────────────
  if (has.firebase()) {
    try {
      // For a bounded range we read only the docs created in that window
      // (huge saving vs. scanning whole collections). All-time still scans.
      // users + groups are read in full: users are needed for the all-time
      // totals/test-filtering, groups for current community membership; both
      // are small collections so the cost is minor.
      const allTime = spec.startMs <= 0;
      const [users, groups, games, notifs, friendReqs] = await Promise.all([
        listAll('users'),
        listAll('groups'),
        allTime
          ? listAll('games')
          : queryByCreatedAt('games', spec.startMs, spec.endMs, 'integer').catch(() => []),
        allTime
          ? listAll('notifications', 4000).catch(() => [])
          : queryByCreatedAt('notifications', spec.startMs, spec.endMs, 'timestamp').catch(() => []),
        listAll('friendRequests').catch(() => []),
      ]);
      // Friend requests — sent (all docs) vs accepted (status). Cumulative.
      empty.friendsSent = friendReqs.length;
      empty.friendsAccepted = friendReqs.filter((r) => r.status === 'accepted').length;
      const real = users.filter((u) => !isTestAccount(u.email, u.name) && u.name !== 'משתמש שהוסר');
      const realIds = new Set(real.map((u) => u.id));
      empty.totalUsers = real.length;
      const inRange = (ms: unknown) => {
        const t = Number(ms ?? 0);
        return t >= spec.startMs && t <= spec.endMs;
      };

      // Community membership is a current-state metric (no per-member join
      // timestamp exists), so it reflects "now" regardless of the range.
      const inCommunity = new Set<string>();
      groups.forEach((g) => {
        [...(g.playerIds ?? []), ...(g.adminIds ?? [])].forEach((id: string) => {
          if (realIds.has(id)) inCommunity.add(id);
        });
      });
      empty.inCommunity = inCommunity.size;
      empty.notInCommunity = Math.max(0, real.length - inCommunity.size);

      // Range-filtered by creation time.
      const creators = new Set<string>();
      const registered = new Set<string>();
      games.forEach((g) => {
        if (!inRange(g.createdAt)) return;
        if (g.createdBy && realIds.has(g.createdBy)) creators.add(g.createdBy);
        [...(g.participantIds ?? []), ...(g.players ?? [])].forEach((id: string) => {
          if (realIds.has(id)) registered.add(id);
        });
      });
      empty.createdGame = creators.size;
      empty.registeredGame = registered.size;

      const groupCreators = new Set<string>();
      groups.forEach((g) => {
        if (!inRange(g.createdAt)) return;
        const c = g.creatorId ?? (g.adminIds ?? [])[0];
        if (c && realIds.has(c)) groupCreators.add(c);
      });
      empty.createdCommunity = groupCreators.size;

      // push: notifications in range. "opened" ≈ recipient marked it read
      // in-app (we have no true push-tap signal), so the rate is a proxy.
      const inPeriod = notifs.filter((n) => inRange(n.createdAt));
      empty.pushSent = inPeriod.length;
      empty.pushOpened = inPeriod.filter((n) => n.read === true).length;
    } catch {
      /* Firestore unavailable */
    }
  }

  fullCache.set(rangeKey, { at: Date.now(), data: empty });
  return empty;
}
