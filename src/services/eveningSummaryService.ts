// eveningSummaryService — builds the shareable "סיכום הערב" model for one
// player in one finished game, from data across phases:
//   • phase 1  goals/assists/wins/losses/rounds → gamePlayerStats + eveningScore
//   • phase 2  contribution% / held-the-pitch / GF-GA → games/{id}/roundHistory
//   • phase 3  physical panel + funny numbers → games/{id}/physical/{uid}
//   • phase 4  heatmap + DNA radar → the same physical doc (heatGrid + metrics)
//
// Every richer section is OPTIONAL: when its data doesn't exist yet (a game
// finished before phase 2 shipped, a player with no wearable) the field is
// null and the card simply doesn't render that section.

import {
  collection,
  doc,
  getDoc,
  getDocs,
} from 'firebase/firestore';
import { gameService } from '@/services/gameService';
import { userService } from '@/services/userService';
import { USE_MOCK_DATA, getFirebase } from '@/firebase/config';
import { logError } from '@/services/errorLog';
import { eveningScore, pickTitle } from '@/utils/eveningScore';
import {
  reduceRounds,
  computeFun,
  computeRadar,
  computeHeatZones,
  type RoundHistoryDoc,
  type PhysicalDoc,
  type FunNumbers,
  type RadarShape,
  type HeatZones,
} from '@/utils/eveningStats';
import type { UserId } from '@/types';

export { eveningScore } from '@/utils/eveningScore';

export interface EveningPhysical {
  distanceKm: number;
  topSpeedKmh: number;
  sprints: number;
  maxHr: number;
  avgSpeedKmh: number;
  steps: number;
  calories: number;
  effortScore: number;
  hrZones: { light: number; moderate: number; intense: number; peak: number };
  source: string;
}

export interface EveningHeatmap {
  grid: number[];
  rows: number;
  cols: number;
  zones: HeatZones;
}

export interface EveningSummaryModel {
  gameId: string;
  uid: UserId;
  playerName: string;
  dateLabel: string;
  communityName: string;
  /** mini-games the player was on the field for. */
  rounds: number;
  /** total mini-games in the evening (≥ rounds); player sat the rest out. */
  totalRounds: number;
  /** whether the evening total is actually KNOWN (roundHistory exists). Old
   *  games predating roundHistory can't know it — don't claim "played all". */
  totalKnown: boolean;
  wins: number;
  losses: number;
  winRate: number;
  goals: number;
  assists: number;
  score: number;
  title: string;
  titleEmoji: string;
  // phase 2
  contribution: { pct: number; touched: number; teamGoals: number } | null;
  heldPitch: number;
  teamGoalsFor: number;
  teamGoalsAgainst: number;
  // phase 3
  physical: EveningPhysical | null;
  fun: FunNumbers | null;
  // phase 4
  radar: RadarShape | null;
  heatmap: EveningHeatmap | null;
}

const WEEKDAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

function formatDateLabel(ms?: number): string {
  if (!ms || !Number.isFinite(ms)) return '';
  const d = new Date(ms);
  return `יום ${WEEKDAYS[d.getDay()]}, ${d.getDate()}.${d.getMonth() + 1}`;
}

interface GameStatRow {
  goals: number;
  assists: number;
  wins: number;
  losses: number;
  rounds: number;
}

function readStatRow(data: Record<string, unknown> | undefined): GameStatRow {
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return {
    goals: n(data?.goals),
    assists: n(data?.assists),
    wins: n(data?.wins),
    losses: n(data?.losses),
    rounds: n(data?.rounds),
  };
}

function toPhysical(p: PhysicalDoc): EveningPhysical {
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return {
    distanceKm: Math.round((n(p.distanceM) / 1000) * 10) / 10,
    topSpeedKmh: Math.round(n(p.topSpeedKmh) * 10) / 10,
    sprints: Math.round(n(p.sprints)),
    maxHr: Math.round(n(p.maxHr)),
    avgSpeedKmh: Math.round(n(p.avgSpeedKmh) * 10) / 10,
    steps: Math.round(n(p.steps)),
    calories: Math.round(n(p.calories)),
    effortScore: Math.round(n(p.effortScore)),
    hrZones: {
      light: Math.round(n(p.hrZones?.light)),
      moderate: Math.round(n(p.hrZones?.moderate)),
      intense: Math.round(n(p.hrZones?.intense)),
      peak: Math.round(n(p.hrZones?.peak)),
    },
    source: typeof p.source === 'string' ? p.source : 'wear',
  };
}

function mockModel(gameId: string, uid: UserId): EveningSummaryModel {
  const goals = 4;
  const assists = 3;
  const wins = 5;
  const losses = 2;
  const rounds = 7;
  const winShare = wins / rounds;
  const t = pickTitle(goals, assists, winShare, rounds);
  const physicalDoc: PhysicalDoc = {
    distanceM: 6200,
    topSpeedKmh: 24.3,
    sprints: 18,
    maxHr: 178,
    avgSpeedKmh: 7.4,
    steps: 4850,
    calories: 640,
    effortScore: 82,
    hrZones: { light: 11, moderate: 14, intense: 9, peak: 7 },
    source: 'wear',
    gridRows: 6,
    gridCols: 4,
    // A heat-heavy attacking half (top rows).
    heatGrid: [
      0.9, 1.0, 0.8, 0.6, 0.7, 0.9, 0.7, 0.5, 0.5, 0.6, 0.5, 0.4, 0.3, 0.4,
      0.3, 0.2, 0.15, 0.2, 0.15, 0.1, 0.05, 0.1, 0.05, 0.05,
    ],
  };
  const zones = computeHeatZones(physicalDoc.heatGrid, physicalDoc.gridRows, physicalDoc.gridCols);
  return {
    gameId,
    uid,
    playerName: 'מתן לוי',
    dateLabel: 'יום רביעי, 8.7',
    communityName: 'מכבי חולון',
    rounds,
    totalRounds: 12,
    totalKnown: true,
    wins,
    losses,
    winRate: Math.round((wins / (wins + losses)) * 100),
    goals,
    assists,
    score: eveningScore(goals, assists, wins, rounds),
    title: t.title,
    titleEmoji: t.emoji,
    // pct mirrors the real derivation Math.round(touched/teamGoals*100) = 41.
    contribution: { pct: 41, touched: 7, teamGoals: 17 },
    heldPitch: 5,
    teamGoalsFor: 17,
    teamGoalsAgainst: 9,
    physical: toPhysical(physicalDoc),
    fun: computeFun(physicalDoc),
    radar: computeRadar(physicalDoc, goals, assists),
    heatmap: zones
      ? {
          grid: physicalDoc.heatGrid ?? [],
          rows: physicalDoc.gridRows ?? 0,
          cols: physicalDoc.gridCols ?? 0,
          zones,
        }
      : null,
  };
}

export const eveningSummaryService = {
  async getEveningSummary(
    gameId: string,
    uid: UserId,
    viewerName?: string,
  ): Promise<EveningSummaryModel | null> {
    if (!gameId || !uid) return null;
    if (USE_MOCK_DATA) return mockModel(gameId, uid);

    try {
      const db = getFirebase().db;
      // The core reads (game, per-game stat, name) drive the always-present
      // sections. The phase-2/3/4 reads (roundHistory, physical) are OPTIONAL —
      // an old game predating them, or a denied/failed read, must degrade to
      // "no contribution / no physical", never fail or crash the whole summary.
      const [game, statSnap, roundSnap, physSnap, name] = await Promise.all([
        gameService.getGameById(gameId).catch(() => null),
        getDoc(doc(db, 'gamePlayerStats', `${gameId}__${uid}`)).catch(() => null),
        getDocs(collection(db, 'games', gameId, 'roundHistory')).catch(() => null),
        getDoc(doc(db, 'games', gameId, 'physical', uid)).catch(() => null),
        (viewerName
          ? Promise.resolve(viewerName)
          : userService.getUserById(uid).then((u) => u?.name ?? '')
        ).catch(() => ''),
      ]);

      const row = readStatRow(
        statSnap && statSnap.exists() ? statSnap.data() : undefined,
      );

      // phase 2 — derive from round history (empty for old games)
      const rounds = roundSnap
        ? roundSnap.docs.map((d) => d.data() as RoundHistoryDoc)
        : [];
      const rs = reduceRounds(uid, rounds);

      // phase 3/4 — the wearable doc (may not exist)
      let physical: EveningPhysical | null = null;
      let fun: FunNumbers | null = null;
      let radar: RadarShape | null = null;
      let heatmap: EveningHeatmap | null = null;
      if (physSnap && physSnap.exists()) {
        const pd = physSnap.data() as PhysicalDoc;
        physical = toPhysical(pd);
        fun = computeFun(pd);
        radar = computeRadar(pd, row.goals, row.assists);
        const zones = computeHeatZones(pd.heatGrid, pd.gridRows, pd.gridCols);
        if (zones && pd.heatGrid && pd.gridRows && pd.gridCols) {
          heatmap = { grid: pd.heatGrid, rows: pd.gridRows, cols: pd.gridCols, zones };
        }
      }

      const decided = row.wins + row.losses;
      const winShare = row.rounds > 0 ? row.wins / row.rounds : 0;
      const t = pickTitle(row.goals, row.assists, winShare, row.rounds);
      // Evening total = number of roundHistory docs (one per committed mini-
      // game). Accurate for games from this feature onward; OLD games have no
      // roundHistory, so we fall back to the played count (total unknowable).
      const totalRounds = Math.max(rounds.length, row.rounds);

      return {
        gameId,
        uid,
        playerName: (name as string) || 'שחקן',
        dateLabel: formatDateLabel(game?.startsAt),
        communityName: game?.title || 'המשחק',
        rounds: row.rounds,
        totalRounds,
        totalKnown: rounds.length > 0,
        wins: row.wins,
        losses: row.losses,
        winRate: decided > 0 ? Math.round((row.wins / decided) * 100) : 0,
        goals: row.goals,
        assists: row.assists,
        score: eveningScore(row.goals, row.assists, row.wins, row.rounds),
        title: t.title,
        titleEmoji: t.emoji,
        contribution: rs.contribution,
        heldPitch: rs.heldPitch,
        teamGoalsFor: rs.teamGoalsFor,
        teamGoalsAgainst: rs.teamGoalsAgainst,
        physical,
        fun,
        radar,
        heatmap,
      };
    } catch (err) {
      logError('getEveningSummary', err, { gameId, uid });
      return null;
    }
  },
};
