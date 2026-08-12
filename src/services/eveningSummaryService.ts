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
import { eveningScore } from '@/utils/eveningScore';
import {
  pickEveningTitle,
  pickEveningInsights,
  type InsightLine,
  type NarrativeStats,
} from '@/utils/eveningNarrative';
import {
  reduceRounds,
  type RoundHistoryDoc,
} from '@/utils/eveningStats';
import type { UserId } from '@/types';

export { eveningScore } from '@/utils/eveningScore';

/** One club-table metric (goals / assists / wins) as of tonight. */
export interface EveningMetric {
  key: 'goals' | 'assists' | 'wins';
  value: number;
  rank: number;
  /** Places climbed tonight (+ = up). */
  delta: number;
  /** Who you went past tonight — NAMES are capped, the count is the truth. */
  passed: string[];
  passedCount: number;
  /** Who went past you. Same split. */
  passedBy: string[];
  passedByCount: number;
  /** The player directly above you, and by how much. */
  aheadName: string | null;
  aheadGap: number | null;
}

const METRIC_ORDER: EveningMetric['key'][] = ['goals', 'assists', 'wins'];

/**
 * Read the server-computed per-metric block. Everything is validated on the
 * way in: a metric with no rank is dropped rather than rendered as "מקום 0",
 * and names are filtered to real strings so a partial write can't put
 * "undefined" on the card.
 */
function readMetrics(raw: unknown): EveningMetric[] {
  if (!raw || typeof raw !== 'object') return [];
  const src = raw as Record<string, unknown>;
  const strList = (v: unknown): string[] =>
    Array.isArray(v)
      ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      : [];
  const out: EveningMetric[] = [];
  for (const key of METRIC_ORDER) {
    const m = src[key];
    if (!m || typeof m !== 'object') continue;
    const d = m as Record<string, unknown>;
    const rank = typeof d.rank === 'number' ? d.rank : 0;
    if (rank <= 0) continue;
    out.push({
      key,
      value: typeof d.value === 'number' ? d.value : 0,
      rank,
      delta: typeof d.delta === 'number' ? d.delta : 0,
      passed: strList(d.passed),
      passedCount:
        typeof d.passedCount === 'number' ? d.passedCount : strList(d.passed).length,
      passedBy: strList(d.passedBy),
      passedByCount:
        typeof d.passedByCount === 'number'
          ? d.passedByCount
          : strList(d.passedBy).length,
      aheadName: typeof d.aheadName === 'string' ? d.aheadName : null,
      aheadGap: typeof d.aheadGap === 'number' ? d.aheadGap : null,
    });
  }
  return out;
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
  /** situational "alive" strips picked by this player's actual performance. */
  insights: InsightLine[];
  // Comparison vs the player's previous evening + their community-table standing.
  // Computed at end-of-evening (onGameRosterChanged) AFTER the ranking is final,
  // stored at eveningStandings/{gameId__uid} — the card reads it, never re-ranks.
  scoreDelta: number | null; // score − previous evening's score
  rank: number | null; // 1-based place in the community table
  rankTotal: number | null;
  rankDelta: number | null; // places climbed since before this evening (+ = up)
  /** Where tonight's score placed me among everyone who played tonight. */
  scoreRank: number | null;
  scoreTotal: number | null;
  /** Per-metric standing in the club, with the names actually passed tonight.
   *  Computed server-side at end-of-evening from the before/after orderings. */
  metrics: EveningMetric[];
  // phase 2
  heldPitch: number;
  teamGoalsFor: number;
  teamGoalsAgainst: number;
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
  teamGoalsFor: number;
  teamGoalsAgainst: number;
  /** whether gamePlayerStats carried the authoritative team-goals fields (they
   *  were added with this feature; older per-game docs lack them). */
  hasTeamGoals: boolean;
}

function readStatRow(data: Record<string, unknown> | undefined): GameStatRow {
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return {
    goals: n(data?.goals),
    assists: n(data?.assists),
    wins: n(data?.wins),
    losses: n(data?.losses),
    rounds: n(data?.rounds),
    teamGoalsFor: n(data?.teamGoalsFor),
    teamGoalsAgainst: n(data?.teamGoalsAgainst),
    hasTeamGoals: typeof data?.teamGoalsFor === 'number',
  };
}

function mockModel(gameId: string, uid: UserId): EveningSummaryModel {
  const goals = 4;
  const assists = 3;
  const wins = 5;
  const losses = 2;
  const rounds = 7;
  const mockNarrative: NarrativeStats = {
    goals, assists, wins, losses, gamesPlayed: rounds, totalRounds: 12,
    heldPitch: 2, scoringStreak: 3,
    bestMiniGame: { round: 3, goals: 2, assists: 1 },
    pen: { scored: 1, saved: 1, missed: 0, conceded: 0 },
  };
  const t = pickEveningTitle(mockNarrative, `${gameId}:${uid}`);
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
    score: eveningScore({
      goals, assists, wins, gamesPlayed: rounds,
      pen: mockNarrative.pen,
    }),
    title: t.title,
    titleEmoji: t.emoji,
    insights: pickEveningInsights(mockNarrative, `${gameId}:${uid}`),
    scoreDelta: 0.6,
    rank: 3,
    rankTotal: 24,
    rankDelta: 2,
    scoreRank: 3,
    scoreTotal: 15,
    metrics: [
      {
        key: 'goals', value: 31, rank: 4, delta: 3,
        passed: ['שלומי', 'יוסי', 'נדב'], passedCount: 3,
        passedBy: [], passedByCount: 0,
        aheadName: 'דניאל', aheadGap: 2,
      },
      {
        key: 'assists', value: 23, rank: 6, delta: -1,
        passed: [], passedCount: 0,
        passedBy: ['אבי'], passedByCount: 1,
        aheadName: 'אבי', aheadGap: 2,
      },
      {
        key: 'wins', value: 48, rank: 2, delta: 0,
        passed: [], passedCount: 0, passedBy: [], passedByCount: 0,
        aheadName: 'דניאל', aheadGap: 5,
      },
    ],
    heldPitch: 5,
    teamGoalsFor: 17,
    teamGoalsAgainst: 9,
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
      // sections. The roundHistory read is OPTIONAL — an old game predating it,
      // or a denied/failed read, degrades to "no contribution", never crashes.
      const [game, statSnap, roundSnap, name, standSnap] =
        await Promise.all([
          gameService.getGameById(gameId).catch(() => null),
          getDoc(doc(db, 'gamePlayerStats', `${gameId}__${uid}`)).catch(() => null),
          getDocs(collection(db, 'games', gameId, 'roundHistory')).catch(() => null),
          (viewerName
            ? Promise.resolve(viewerName)
            : userService.getUserById(uid).then((u) => u?.name ?? '')
          ).catch(() => ''),
          getDoc(doc(db, 'eveningStandings', `${gameId}__${uid}`)).catch(
            () => null,
          ),
        ]);
      const stand =
        standSnap && standSnap.exists()
          ? (standSnap.data() as Record<string, unknown>)
          : null;
      const numOrNull = (v: unknown) =>
        typeof v === 'number' && Number.isFinite(v) ? v : null;

      const row = readStatRow(
        statSnap && statSnap.exists() ? statSnap.data() : undefined,
      );

      // phase 2 — derive from round history (empty for old games)
      const rounds = roundSnap
        ? roundSnap.docs.map((d) => d.data() as RoundHistoryDoc)
        : [];
      const rs = reduceRounds(uid, rounds);

      const decided = row.wins + row.losses;
      // Evening total = number of roundHistory docs (one per committed mini-
      // game). Accurate for games from this feature onward; OLD games have no
      // roundHistory, so we fall back to the played count (total unknowable).
      const totalRounds = Math.max(rounds.length, row.rounds);
      // roundHistory docs are written best-effort (outside the atomic stats
      // batch), so some can be missing while gamePlayerStats.rounds (the
      // player's authoritative played count) is complete. If roundHistory shows
      // FEWER of this player's rounds than they actually played, the log is
      // incomplete and its total can't be trusted — so don't claim the total is
      // "known" (which would make the card assert "played ALL N" to a player who
      // sat rounds out).
      const totalKnown = rounds.length > 0 && rs.playedRounds >= row.rounds;

      // GF/GA: prefer the AUTHORITATIVE gamePlayerStats team goals (committed in
      // the atomic round batch) over the best-effort roundHistory reduction,
      // which under-counts when a roundHistory write failed.
      const teamGoalsFor = row.hasTeamGoals ? row.teamGoalsFor : rs.teamGoalsFor;
      const teamGoalsAgainst = row.hasTeamGoals ? row.teamGoalsAgainst : rs.teamGoalsAgainst;

      // Community benchmark: the "perfect 10" goals/assists targets are the
      // group's historical average of the top scorer's / top assister's evening
      // total ("מלך השערים" per מחזור), maintained on communityStats by the
      // evening-standings Cloud Function. Absent (new group / read failed) →
      // eveningScore falls back to its DEFAULT_*_FOR_10. Never blocks the card.
      const benchSnap = game?.groupId
        ? await getDoc(doc(db, 'communityStats', game.groupId)).catch(() => null)
        : null;
      const bench =
        benchSnap && benchSnap.exists()
          ? (benchSnap.data() as {
              kingGoalsSum?: number;
              kingGoalsCount?: number;
              kingAssistsSum?: number;
              kingAssistsCount?: number;
            })
          : null;
      const avgOrUndef = (sum?: number, count?: number) =>
        typeof sum === 'number' && typeof count === 'number' && count > 0
          ? sum / count
          : undefined;
      const goalsFor10 = avgOrUndef(bench?.kingGoalsSum, bench?.kingGoalsCount);
      const assistsFor10 = avgOrUndef(
        bench?.kingAssistsSum,
        bench?.kingAssistsCount,
      );

      // Score + adaptive narrative, from the full performance picture. Seed the
      // copy per (game, player) so it's varied across players yet stable for a
      // given game.
      const narrative: NarrativeStats = {
        goals: row.goals,
        assists: row.assists,
        wins: row.wins,
        losses: row.losses,
        gamesPlayed: row.rounds,
        totalRounds,
        heldPitch: rs.heldPitch,
        scoringStreak: rs.scoringStreak,
        bestMiniGame: rs.bestMiniGame,
        pen: rs.pen,
      };
      const seed = `${gameId}:${uid}`;
      const t = pickEveningTitle(narrative, seed);
      // Prefer the score the SERVER stored. It is the one that ranked this
      // evening's players against each other, the one saved as the club's
      // lastEveningScore, and the one every other surface reads — so a card
      // showing a locally recomputed number put "מקום 12 מתוך 15" next to a
      // score that wasn't what produced that place. The local computation
      // stays as the fallback for evenings with no standing doc (and it also
      // folds in penalties, which the server's stats rows don't carry).
      const localScore = eveningScore({
        goals: row.goals,
        assists: row.assists,
        wins: row.wins,
        gamesPlayed: row.rounds,
        goalsFor10,
        assistsFor10,
        pen: rs.pen,
      });
      const storedScore = numOrNull(stand?.score);
      const score = storedScore ?? localScore;

      return {
        gameId,
        uid,
        playerName: (name as string) || 'שחקן',
        dateLabel: formatDateLabel(game?.startsAt),
        communityName: game?.title || 'המשחק',
        rounds: row.rounds,
        totalRounds,
        totalKnown,
        wins: row.wins,
        losses: row.losses,
        winRate: decided > 0 ? Math.round((row.wins / decided) * 100) : 0,
        goals: row.goals,
        assists: row.assists,
        score,
        title: t.title,
        titleEmoji: t.emoji,
        insights: pickEveningInsights(narrative, seed),
        scoreDelta: numOrNull(stand?.scoreDelta),
        rank: numOrNull(stand?.rank),
        rankTotal: numOrNull(stand?.rankTotal),
        rankDelta: numOrNull(stand?.rankDelta),
        scoreRank: numOrNull(stand?.scoreRank),
        scoreTotal: numOrNull(stand?.scoreTotal),
        metrics: readMetrics(stand?.metrics),
        heldPitch: rs.heldPitch,
        teamGoalsFor,
        teamGoalsAgainst,
      };
    } catch (err) {
      logError('getEveningSummary', err, { gameId, uid });
      return null;
    }
  },
};
