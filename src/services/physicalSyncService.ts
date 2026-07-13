// physicalSyncService — after a game, reads the player's wearable session,
// derives the heatmap (using the community's pitch calibration to drop
// off-pitch/bench time), and uploads it via the saveGamePhysical callable.
//
// Safe no-op when there's no wearable binding (healthService.isAvailable() is
// false) or in mock mode — so it can be fired-and-forgotten from the summary
// screen without guards at the call site.

import { doc, getDoc } from 'firebase/firestore';
import { getFirebase, USE_MOCK_DATA } from '@/firebase/config';
import { healthService } from '@/services/healthService';
import { pitchCalibrationService } from '@/services/pitchCalibrationService';
import { routeToHeatGrid, normalizeToPitch } from '@/utils/physical';
import { logError } from '@/services/errorLog';

const HEAT_ROWS = 6;
const HEAT_COLS = 4;
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
      const g = snap.data() as { startsAt?: number; endedAt?: number; groupId?: string };
      const now = Date.now();
      const from = typeof g.startsAt === 'number' ? g.startsAt : now - DEFAULT_WINDOW_MS;
      const rawEnd = typeof g.endedAt === 'number' ? g.endedAt : now;
      // Bound the window: never past kickoff + MAX_GAME_MS, never past now.
      const to = Math.min(rawEnd, from + MAX_GAME_MS, now);

      const session = await healthService.readSession(from, to);
      if (!session) return false;

      // Heatmap: normalize the GPS route into the calibrated pitch (points that
      // fall outside the rectangle — the sideline/bench — are dropped).
      let heat: { heatGrid: number[]; gridRows: number; gridCols: number } | null = null;
      const corners = await pitchCalibrationService.loadCorners(g.groupId);
      if (corners && session.route.length) {
        const pts = session.route
          .map((p) => normalizeToPitch(p, corners))
          .filter((p): p is { x: number; y: number } => !!p);
        if (pts.length) {
          heat = {
            heatGrid: routeToHeatGrid(pts, HEAT_ROWS, HEAT_COLS),
            gridRows: HEAT_ROWS,
            gridCols: HEAT_COLS,
          };
        }
      }

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
        ...(heat ?? {}),
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
