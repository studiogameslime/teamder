// availabilityFeedService — powers the home-screen "פנויים לשחק לידך" calendar.
//
// Returns, for today + the next 6 days, how many players are available in each
// time-window (morning/noon/evening/night) WITHIN THE VIEWER'S radius and NOT
// already registered to a game in that window. Counts only — never identities
// (privacy: the availability screen discloses this).
//
// Heavy cross-user aggregation happens server-side in the `availabilityCounts`
// callable (added in functions). Mock mode returns a realistic fixture so the
// UI renders and can be verified on the emulator.

import { httpsCallable } from 'firebase/functions';
import { USE_MOCK_DATA, getFirebase } from '@/firebase/config';
import type { TimeBucket, WeekdayIndex } from '@/types';
import { logError } from './errorLog';

export const TIME_WINDOWS: TimeBucket[] = ['morning', 'noon', 'evening', 'night'];

export interface AvailabilityDayCounts {
  /** Start-of-day epoch ms for this calendar day. */
  dateMs: number;
  /** 0=Sun … 6=Sat. */
  weekday: WeekdayIndex;
  isToday: boolean;
  /** Available-and-free player count per time-window. */
  windows: Record<TimeBucket, number>;
}

export interface AvailabilityCounts {
  /** The viewer's radius (km) used for the counts — for the header chip. */
  radiusKm: number;
  /** Whether the viewer has set a home location; false → prompt to set it. */
  hasLocation: boolean;
  /** today + next 6 days, in order. */
  days: AvailabilityDayCounts[];
}

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function buildMock(): AvailabilityCounts {
  const todayStart = startOfDay(Date.now());
  // Demo counts keyed by weekday so it looks stable/realistic (evening busiest,
  // a Thursday-evening peak of 8, quiet Shabbat nights).
  const byWeekday: Record<number, [number, number, number, number]> = {
    0: [0, 1, 5, 2], // Sun
    1: [1, 0, 5, 2], // Mon
    2: [0, 1, 4, 1], // Tue
    3: [2, 0, 6, 3], // Wed
    4: [1, 2, 8, 4], // Thu
    5: [3, 4, 2, 0], // Fri
    6: [5, 6, 1, 0], // Sat
  };
  const days: AvailabilityDayCounts[] = [];
  for (let i = 0; i < 7; i++) {
    const dateMs = todayStart + i * 86_400_000;
    const weekday = new Date(dateMs).getDay() as WeekdayIndex;
    const [m, n, e, ni] = byWeekday[weekday] ?? [0, 0, 0, 0];
    days.push({
      dateMs,
      weekday,
      isToday: i === 0,
      windows: { morning: m, noon: n, evening: e, night: ni },
    });
  }
  return { radiusKm: 25, hasLocation: true, days };
}

// Short in-memory cache. The callable aggregates across all opted-in users +
// every game in a 7-day window, so it's read-heavy; the home card mounts on
// every tab focus. A 5-minute TTL collapses those repeated opens into one
// server call without the numbers ever feeling stale (availability changes on
// the order of hours, not seconds). Cleared on a fresh app launch.
const CACHE_TTL_MS = 5 * 60 * 1000;
let cached: { at: number; value: AvailabilityCounts } | null = null;
let inFlight: Promise<AvailabilityCounts> | null = null;

export const availabilityFeedService = {
  async getAvailabilityCounts(): Promise<AvailabilityCounts> {
    if (USE_MOCK_DATA) return buildMock();
    const now = Date.now();
    if (cached && now - cached.at < CACHE_TTL_MS) return cached.value;
    // De-dupe concurrent callers (e.g. two screens mounting at once) onto a
    // single in-flight request.
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        const { functions } = getFirebase();
        const fn = httpsCallable(functions, 'availabilityCounts');
        const res = await fn({});
        const value = res.data as AvailabilityCounts;
        cached = { at: Date.now(), value };
        return value;
      } catch (err) {
        logError('getAvailabilityCounts', err, {});
        // Fail-soft: an empty (no-location) result so the home card hides
        // itself rather than crashing the home screen. NOT cached — a
        // transient error shouldn't suppress the card for 5 minutes.
        return { radiusKm: 0, hasLocation: false, days: [] };
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  },
  /** Drop the cache — call after the viewer edits their availability so the
   *  radius/counts refresh on the next home open. */
  invalidate() {
    cached = null;
  },
};
