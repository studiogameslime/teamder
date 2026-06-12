// serverClock — a shared, device-independent time base for the live-match
// timer.
//
// THE PROBLEM. The timer is stored as three numbers (running,
// timerLastStartedAt, timerAccumulatedMs) and every device reconstructs
// the displayed time as `accumulated + (now - lastStartedAt)`. If each
// device uses its OWN wall clock for `now`, two phones whose clocks differ
// by N seconds render the SAME anchor as times that differ by N seconds —
// so "everyone sees the same clock" silently breaks for anyone with a
// skewed clock.
//
// THE FIX. Measure, once per session, the offset between this device's
// clock and the server's clock (NTP-style: probe a tiny callable a few
// times, keep the sample with the lowest round-trip). Then:
//   • timer anchors are STAMPED with `serverNow()` (server-time base), and
//   • every reader computes elapsed using `serverNow()`,
// so each device's local skew cancels out and all surfaces agree.
//
// Accuracy is sub-second (good to ~RTT/2 of the best probe), which is far
// tighter than human perception of a match clock. If probing fails we fall
// back to a zero offset (i.e. the old local-clock behaviour) — never throw.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getFirebase } from '@/firebase/config';

const OFFSET_STORAGE_KEY = '@teamder/serverClockOffset';
/** How many probes per sync. We keep the lowest-RTT sample. */
const PROBE_COUNT = 3;
/** Re-sync if the cached offset is older than this. */
const RESYNC_AFTER_MS = 5 * 60 * 1000;

/** serverNow() - Date.now(), in ms. Hydrated from cache, refined by probes. */
let offsetMs = 0;
/** Epoch (local) of the last successful probe; 0 = never. */
let lastSyncAt = 0;
/** Guards against overlapping syncs. */
let inFlight: Promise<number> | null = null;
let hydrated = false;

/**
 * Current best estimate of the server's wall clock, in ms epoch. Use this
 * EVERYWHERE the timer is stamped or rendered instead of `Date.now()`.
 * Cheap and synchronous — safe to call on every tick.
 */
export function serverNow(): number {
  return Date.now() + offsetMs;
}

/** The measured offset (serverNow - localNow), in ms. Exposed so the
 *  native widget — which shares this device's clock — can reuse the exact
 *  same correction instead of measuring its own. */
export function getServerOffsetMs(): number {
  return offsetMs;
}

/** Best-effort hydrate of the cached offset from disk. Lets a cold start
 *  begin with a sane correction before the first probe returns. */
async function hydrateFromCache(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  try {
    const raw = await AsyncStorage.getItem(OFFSET_STORAGE_KEY);
    if (raw != null) {
      const n = Number(raw);
      if (Number.isFinite(n)) offsetMs = n;
    }
  } catch {
    // Non-fatal; we just start from a zero offset.
  }
}

async function probeOnce(): Promise<{ offset: number; rtt: number } | null> {
  try {
    // Lazy require mirrors the rest of the app's callable call sites and
    // avoids pulling firebase/functions into bundles that never sync.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { httpsCallable } = require('firebase/functions');
    const fn = httpsCallable(getFirebase().functions, 'getServerTime');
    const t0 = Date.now();
    const res = await fn();
    const t1 = Date.now();
    const serverTime = Number((res?.data as { now?: number } | undefined)?.now);
    if (!Number.isFinite(serverTime)) return null;
    const rtt = t1 - t0;
    // Assume the server stamped at the midpoint of the round-trip, so the
    // server's clock at receipt (t1) was ~serverTime + rtt/2. Offset is
    // that minus our local clock at t1.
    const offset = serverTime + rtt / 2 - t1;
    return { offset, rtt };
  } catch {
    return null;
  }
}

/**
 * Measure the server-clock offset and update `serverNow()`. Probes a few
 * times and keeps the lowest-RTT sample (least network noise). Idempotent
 * and de-duped: concurrent callers share one in-flight sync. Resolves to
 * the current offset; never rejects.
 */
export async function syncServerClock(force = false): Promise<number> {
  await hydrateFromCache();
  if (!force && lastSyncAt > 0 && Date.now() - lastSyncAt < RESYNC_AFTER_MS) {
    return offsetMs;
  }
  if (inFlight) return inFlight;

  inFlight = (async () => {
    let best: { offset: number; rtt: number } | null = null;
    for (let i = 0; i < PROBE_COUNT; i++) {
      const sample = await probeOnce();
      if (sample && (best == null || sample.rtt < best.rtt)) best = sample;
    }
    if (best) {
      offsetMs = best.offset;
      lastSyncAt = Date.now();
      try {
        await AsyncStorage.setItem(OFFSET_STORAGE_KEY, String(offsetMs));
      } catch {
        // Non-fatal — the in-memory offset still applies this session.
      }
    }
    inFlight = null;
    return offsetMs;
  })();

  return inFlight;
}
