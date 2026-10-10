// Thin AsyncStorage wrapper: JSON helpers, "seen review IDs" tracking, and
// cached snapshots so screens render instantly (and offline) from the last
// successful poll.

import AsyncStorage from '@react-native-async-storage/async-storage';
import type {
  AnalyticsSummary,
  AppStats,
  AppUser,
  DownloadsSummary,
  RatingSummary,
  RevenueSummary,
  Review,
} from '../types';

async function getJSON<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
async function setJSON(key: string, value: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* non-fatal */
  }
}

// ── seen review ids (for new-review detection) ─────────────────────
const SEEN_KEY = 'seenReviewIds';

export async function getSeen(): Promise<Set<string>> {
  const arr = await getJSON<string[]>(SEEN_KEY, []);
  return new Set(arr);
}
export async function addSeen(ids: string[]): Promise<void> {
  const cur = await getSeen();
  ids.forEach((id) => cur.add(id));
  // keep the set bounded
  const trimmed = Array.from(cur).slice(-2000);
  await setJSON(SEEN_KEY, trimmed);
}
// First run: seed seen with current reviews so we don't notify for the
// entire backlog. Returns true if this was the seeding run.
export async function seedIfFirstRun(ids: string[]): Promise<boolean> {
  const seeded = await AsyncStorage.getItem('seenSeeded');
  if (seeded) return false;
  await setJSON(SEEN_KEY, ids.slice(-2000));
  await AsyncStorage.setItem('seenSeeded', '1');
  return true;
}

// ── generic "seen ids" tracking, keyed by source ───────────────────
// Same first-run-seed + bounded-set semantics as reviews, but parameterised
// so each new-item stream (chat messages, chat reports, …) keeps its own set.
const seenKey = (k: string) => `seen:${k}`;
const seededKey = (k: string) => `seenSeeded:${k}`;

export async function getSeenSet(key: string): Promise<Set<string>> {
  return new Set(await getJSON<string[]>(seenKey(key), []));
}
export async function addSeenSet(key: string, ids: string[]): Promise<void> {
  const cur = await getSeenSet(key);
  ids.forEach((id) => cur.add(id));
  await setJSON(seenKey(key), Array.from(cur).slice(-2000));
}
export async function seedIfFirstRunSet(key: string, ids: string[]): Promise<boolean> {
  const seeded = await AsyncStorage.getItem(seededKey(key));
  if (seeded) return false;
  await setJSON(seenKey(key), ids.slice(-2000));
  await AsyncStorage.setItem(seededKey(key), '1');
  return true;
}

// ── cached snapshots ───────────────────────────────────────────────
export interface Snapshot {
  reviews: Review[];
  ratings: RatingSummary[];
  revenue: RevenueSummary | null;
  analytics: AnalyticsSummary | null;
  users: AppUser[];
  appStats: AppStats | null;
  downloads: DownloadsSummary | null;
  updatedAt: string | null;
}

const SNAP_KEY = 'snapshot';
export const emptySnapshot: Snapshot = {
  reviews: [],
  ratings: [],
  revenue: null,
  analytics: null,
  users: [],
  appStats: null,
  downloads: null,
  updatedAt: null,
};

export function getSnapshot(): Promise<Snapshot> {
  return getJSON<Snapshot>(SNAP_KEY, emptySnapshot);
}
export function saveSnapshot(s: Snapshot): Promise<void> {
  return setJSON(SNAP_KEY, s);
}
