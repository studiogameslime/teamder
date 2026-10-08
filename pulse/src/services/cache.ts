import AsyncStorage from '@react-native-async-storage/async-storage';

// Tiny in-memory TTL cache. The Pulse collections are all small — the read
// cost came from re-scanning them on every screen open/focus. Wrapping each
// fetch here means repeated opens within the TTL cost ZERO Firestore reads;
// pull-to-refresh passes force=true to bypass. It's a personal dashboard, so a
// few minutes of staleness is fine (the user explicitly doesn't mind).

// We cache the in-flight PROMISE, not just the resolved value. That way several
// screens/bodies that fire the same fetch at once (e.g. the Dev-Inbox mounts
// four bodies together) share ONE request instead of each scanning the
// collection — no thundering herd on a cold cache.
const store = new Map<string, { at: number; p: Promise<unknown> }>();

const DISK_PREFIX = 'pulse.cache.';

// Default freshness window for cached reads.
export const CACHE_TTL = 5 * 60_000;

export function cached<T>(
  key: string,
  fn: () => Promise<T>,
  opts: { ttl?: number; force?: boolean } = {},
): Promise<T> {
  const ttl = opts.ttl ?? CACHE_TTL;
  const hit = store.get(key);
  if (!opts.force && hit && Date.now() - hit.at < ttl) {
    return hit.p as Promise<T>;
  }
  const p = fn();
  store.set(key, { at: Date.now(), p });
  // Never cache a failure — drop it so the next call retries.
  p.catch(() => {
    if (store.get(key)?.p === p) store.delete(key);
  });
  return p;
}

// ── Disk mirror ──────────────────────────────────────────────────────────
// The in-memory cache above dies with the process, so a COLD start always
// paid full price — which is what made the dashboard open on spinners. These
// two helpers mirror a result to AsyncStorage and read it back, so a screen
// can paint last-known numbers in the first frame and let the network catch
// up behind it. Deliberately opt-in per call site: only worth it for data
// that's expensive to fetch and harmless to show slightly stale.

/** Store a value for the next cold start. Fire-and-forget; never throws. */
export function persist(key: string, value: unknown): void {
  void AsyncStorage.setItem(`${DISK_PREFIX}${key}`, JSON.stringify(value)).catch(
    () => {},
  );
}

/** Last stored value for `key`, or null when nothing is stored / it's corrupt. */
export async function readPersisted<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(`${DISK_PREFIX}${key}`);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

// Drop one key (after a write) or everything.
export function invalidate(key?: string): void {
  if (key) store.delete(key);
  else store.clear();
}
