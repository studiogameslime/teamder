// physicalSyncService — after a game, reads the player's wearable session and
// uploads the physical metrics via the saveGamePhysical callable.
//
// Safe no-op when there's no wearable binding (healthService.isAvailable() is
// false) or in mock mode — so it can be fired-and-forgotten from the summary
// screen without guards at the call site.
//
// NOTE: the GPS heatmap was dropped (no ExerciseRoute permission), so no route/
// pitch-calibration processing happens here anymore — just the physical metrics.

import { doc, getDoc } from 'firebase/firestore';
import { Platform, NativeModules } from 'react-native';
import { getFirebase, USE_MOCK_DATA } from '@/firebase/config';
import { healthService } from '@/services/healthService';
import { logError } from '@/services/errorLog';

const DEFAULT_WINDOW_MS = 3 * 60 * 60 * 1000; // fallback pre-kickoff span
// A pickup evening never runs longer than this. The Game doc has no reliable
// end timestamp, so we CAP the read window at kickoff + this span — otherwise
// opening the summary the next morning would ingest a player's overnight
// sleep/commute HR/steps instead of the ~90-minute game.
const MAX_GAME_MS = 4 * 60 * 60 * 1000;

export const physicalSyncService = {
  /** Ingest + upload this player's physical stats for a finished game. */
  async syncForGame(gameId: string): Promise<boolean> {
    if (!gameId || USE_MOCK_DATA) return false;
    if (!healthService.isAvailable()) return false;
    // Ensure Health Connect access before reading — prompts the permission
    // sheet the first time, then stays silent (declined users aren't nagged).
    if (!(await healthService.ensurePermissions())) return false;
    try {
      const db = getFirebase().db;
      const snap = await getDoc(doc(db, 'games', gameId));
      if (!snap.exists()) return false;
      const g = snap.data() as { startsAt?: number; endedAt?: number };
      const now = Date.now();
      const from = typeof g.startsAt === 'number' ? g.startsAt : now - DEFAULT_WINDOW_MS;
      const rawEnd = typeof g.endedAt === 'number' ? g.endedAt : now;
      // Bound the window: never past kickoff + MAX_GAME_MS, never past now.
      const to = Math.min(rawEnd, from + MAX_GAME_MS, now);

      const session = await healthService.readSession(from, to);
      if (!session) return false;

      const metrics = {
        distanceM: session.distanceM,
        topSpeedKmh: session.topSpeedKmh,
        avgSpeedKmh: session.avgSpeedKmh,
        sprints: session.sprints,
        steps: session.steps,
        calories: session.calories,
        maxHr: session.maxHr,
        avgHr: session.avgHr,
        effortScore: session.effortScore,
        hrZones: session.hrZones,
        source: session.source,
      };

      // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
      const { httpsCallable } = require('firebase/functions');
      await httpsCallable(getFirebase().functions, 'saveGamePhysical')({ gameId, metrics });
      return true;
    } catch (err) {
      logError('physicalSync.syncForGame', err, { gameId });
      return false;
    }
  },

  /**
   * Drain physical sessions our OWN Galaxy Watch recorded via Wear Health
   * Services and relayed over the Data Layer. The watch (see
   * plugins/wear-src/wear/.../health/ExerciseRecorderService) records steps /
   * distance / calories / speed / heart-rate with the watch's on-device sensors
   * — NOT Health Connect — so it needs no `android.permission.health.*` and
   * sidesteps Google Play's Health-apps declaration gate. It sends each finished
   * session to the phone at `/teamder/physical`; the native WearPhysicalService
   * queues them in SharedPreferences (the phone may not be running when the
   * watch sends). Here we pull that queue and persist each via saveGamePhysical,
   * signed as THIS authenticated user — the same write path the (gated-off)
   * Health Connect flow used, so the evening-summary panel is source-agnostic.
   *
   * Android-only, best-effort: a no-op when the bridge / method is absent (older
   * build, iOS, mock). Returns true if at least one session was persisted.
   */
  async drainWatchPhysical(): Promise<boolean> {
    if (USE_MOCK_DATA || Platform.OS !== 'android') return false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bridge = (NativeModules as any).WatchBridge;
    if (!bridge?.consumePendingPhysical) return false;
    try {
      const raw: string = await bridge.consumePendingPhysical();
      if (!raw) return false;
      const items = JSON.parse(raw) as Array<{
        gameId?: string;
        metrics?: Record<string, unknown>;
      }>;
      if (!Array.isArray(items) || items.length === 0) return false;

      // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
      const { httpsCallable } = require('firebase/functions');
      const call = httpsCallable(getFirebase().functions, 'saveGamePhysical');
      let persisted = false;
      for (const item of items) {
        const gameId = item?.gameId;
        const metrics = item?.metrics;
        if (!gameId || !metrics || typeof metrics !== 'object') continue;
        try {
          await call({ gameId, metrics: { ...metrics, source: 'wear' } });
          persisted = true;
        } catch (err) {
          // One bad game (e.g. no longer a participant) must not drop the rest.
          logError('physicalSync.drainWatchPhysical.item', err, { gameId });
        }
      }
      return persisted;
    } catch (err) {
      logError('physicalSync.drainWatchPhysical', err);
      return false;
    }
  },
};
