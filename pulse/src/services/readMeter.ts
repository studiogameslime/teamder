// Per-source Firestore read meter. Cloud Monitoring tells us the TOTAL reads
// (and splits them by type: QUERY / LOOKUP / NOT_FOUND) but never by collection
// or by who issued them. So we tally Pulse's OWN reads here, attributed to the
// collection/operation that caused them — that's how the quota screen can show
// "of today's reads, Pulse itself read N (users X · games Y · …)", and the rest
// is the live app. Counts reset daily (US-Pacific day, to match Google's quota
// reset). This is an attribution aid, not billing — approximate by design.

import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'readMeter.v1';

interface Meter {
  day: string;
  counts: Record<string, number>;
}

// US-Pacific day key (UTC-8, ignoring DST — close enough for attribution and
// matches the quota screen's "resets ~10:00 Israel" framing).
function dayKey(ms: number = Date.now()): string {
  const d = new Date(ms - 8 * 3600_000);
  return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
}

let mem: Meter | null = null;
let loadPromise: Promise<Meter> | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

async function load(): Promise<Meter> {
  if (mem) return mem;
  if (!loadPromise) {
    loadPromise = (async () => {
      try {
        const raw = await AsyncStorage.getItem(KEY);
        const parsed = raw ? (JSON.parse(raw) as Meter) : null;
        mem = parsed && parsed.day === dayKey() ? parsed : { day: dayKey(), counts: {} };
      } catch {
        mem = { day: dayKey(), counts: {} };
      }
      return mem;
    })();
  }
  return loadPromise;
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(async () => {
    flushTimer = null;
    try {
      if (mem) await AsyncStorage.setItem(KEY, JSON.stringify(mem));
    } catch {
      /* best-effort */
    }
  }, 1500);
}

// Record `n` document reads against a labelled source. Fire-and-forget.
export function recordRead(source: string, n: number): void {
  if (n <= 0) return;
  void load().then((m) => {
    const today = dayKey();
    if (m.day !== today) {
      m.day = today;
      m.counts = {};
    }
    m.counts[source] = (m.counts[source] ?? 0) + n;
    scheduleFlush();
  });
}

export interface ReadMeterReport {
  day: string;
  total: number;
  sources: { source: string; reads: number }[];
}

export async function getReadMeter(): Promise<ReadMeterReport> {
  const m = await load();
  const today = dayKey();
  const counts = m.day === today ? m.counts : {};
  const sources = Object.entries(counts)
    .map(([source, reads]) => ({ source, reads }))
    .sort((a, b) => b.reads - a.reads);
  const total = sources.reduce((s, x) => s + x.reads, 0);
  return { day: today, total, sources };
}
