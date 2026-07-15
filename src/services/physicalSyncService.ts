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
      const g = snap.data() as {
        startsAt?: number;
        endedAt?: number;
        liveMatch?: {
          activeIntervals?: Array<{ s: number; e: number }>;
          timerRunning?: boolean;
          timerLastStartedAt?: number | null;
        };
      };
      const now = Date.now();

      // Read ONLY the minutes the live-match TIMER was actually running — the
      // evening-level `activeIntervals` the timer appends on each pause/end.
      // This excludes pre-kickoff warmup, halftime pauses, and post-game, so
      // the physical summary reflects the played minutes, not the whole evening.
      const lm = g.liveMatch;
      const intervals = (Array.isArray(lm?.activeIntervals) ? lm!.activeIntervals : [])
        .map((iv) => ({ from: iv.s, to: Math.min(iv.e, now) }))
        .filter(
          (iv) =>
            typeof iv.from === 'number' &&
            typeof iv.to === 'number' &&
            iv.to > iv.from,
        );
      // Edge: summary opened while the timer is still running (before endEvening).
      if (lm?.timerRunning && typeof lm.timerLastStartedAt === 'number') {
        intervals.push({ from: lm.timerLastStartedAt, to: now });
      }

      let session: Awaited<ReturnType<typeof healthService.readSession>>;
      if (intervals.length > 0) {
        session = await healthService.readSessionMulti(intervals);
      } else {
        // Fallback for games with no timer-interval data (older games, or the
        // timer was never used): the coarse whole-game window, capped.
        const from =
          typeof g.startsAt === 'number' ? g.startsAt : now - DEFAULT_WINDOW_MS;
        const rawEnd = typeof g.endedAt === 'number' ? g.endedAt : now;
        const to = Math.min(rawEnd, from + MAX_GAME_MS, now);
        session = await healthService.readSession(from, to);
      }
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
};
