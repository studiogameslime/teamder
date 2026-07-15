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
import { getServerOffsetMs, syncServerClock } from '@/services/serverClock';
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
        status?: string;
        startsAt?: number;
        endedAt?: number;
        liveMatch?: { activeIntervals?: Array<{ s: number; e: number }> };
      };
      const now = Date.now();
      // Only sync a FINISHED game — mid-evening the timer intervals are still
      // partial and the merge write would overwrite the real end-of-game totals.
      if (g.status && g.status !== 'finished') return false;

      // Read ONLY the minutes the live-match TIMER was running — the evening-level
      // `activeIntervals` (appended on each pause/end). Timer epochs are stamped in
      // SERVER time (serverNow); Health Connect records are DEVICE-LOCAL — so
      // convert back to local (subtract the clock offset), clamp each window to a
      // sane span + to now, drop invalid, then COALESCE overlaps so no window is
      // read (and summed) twice.
      //
      // Prime the offset FIRST: a summary opened from the end-of-evening push cold-
      // launches straight here without ever mounting a timer screen, so
      // getServerOffsetMs() would still be 0 and the windows would be shifted off
      // the real wearable data by the device's clock skew. syncServerClock()
      // hydrates the persisted game-day offset (and refreshes) — best-effort.
      await syncServerClock().catch(() => 0);
      const offset = getServerOffsetMs();
      const sorted = (
        Array.isArray(g.liveMatch?.activeIntervals) ? g.liveMatch!.activeIntervals : []
      )
        .map((iv) => ({ from: iv.s - offset, to: iv.e - offset }))
        .map((iv) => ({ from: iv.from, to: Math.min(iv.to, iv.from + MAX_GAME_MS, now) }))
        .filter(
          (iv) => Number.isFinite(iv.from) && Number.isFinite(iv.to) && iv.to > iv.from,
        )
        .sort((a, b) => a.from - b.from);
      const merged: Array<{ from: number; to: number }> = [];
      for (const iv of sorted) {
        const last = merged[merged.length - 1];
        if (last && iv.from <= last.to) last.to = Math.max(last.to, iv.to);
        else merged.push({ ...iv });
      }
      // Total active time can never exceed a pickup evening (belt-and-suspenders).
      let budget = MAX_GAME_MS;
      const intervals: Array<{ from: number; to: number }> = [];
      for (const iv of merged) {
        if (budget <= 0) break;
        const span = Math.min(iv.to - iv.from, budget);
        intervals.push({ from: iv.from, to: iv.from + span });
        budget -= span;
      }

      let session: Awaited<ReturnType<typeof healthService.readSession>>;
      if (intervals.length > 0) {
        session = await healthService.readSessionMulti(intervals);
      } else {
        // Fallback for games with no timer-interval data (older games / the timer
        // was never used): the coarse whole-game window, capped. startsAt/endedAt
        // are wall-clock (device-local) — no offset conversion.
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
