import { observeCaughtError } from '../utils/errorObservation';
// playerStatsService — the data behind the dedicated "סטטיסטיקה" screen.
//
// Everything here is DERIVED from data we already keep. The core uses three
// queries: one games query (array-contains participantIds, same index the
// achievements derivation uses) plus the two pairStats halves (a==uid /
// b==uid). Highlights additionally load owner-only standings and personal
// per-evening rows with bounded concurrency. No new tracking is required.
//
//   • numeric:   attended games, attendance %, distinct teammates, goals,
//                goals-per-evening
//   • relational: the named superlatives — most-played-with, most-wins-with,
//                 biggest victim (you beat them most), nemesis (they beat you
//                 most). Each is a {uid, count}; the screen resolves names.

import { getDocs, query, where } from 'firebase/firestore';
import { col } from '@/firebase/firestore';
import { USE_MOCK_DATA } from '@/firebase/config';
import { logError } from '@/services/errorLog';
import { isAttendedGame } from '@/utils/playedGames';
import type { UserId } from '@/types';
import { loadPersonalHighlights } from './personalHighlightsService';
import type { PersonalHighlights, PersonalRound } from '@/utils/personalStatistics';
import { didEveningHappen } from '@/utils/eveningPlayed';
import { personalPartnerResults, type PersonalPartnerResults } from '@/utils/personalPartnerStats';

export interface NamedStat {
  uid: UserId;
  count: number;
}

export interface PlayerStatsSummary {
  /** Consecutive attended, past registered rounds across clubs; absent if dates are incomplete. */
  attendanceStreak?: { current: number; best: number };
  highlights?: PersonalHighlights;
  attendedGames: number;
  totalRegistered: number;
  /** attended / registered, 0-100. */
  attendanceRate: number;
  goals: number;
  /** lifetime assists (admin-attributed in advanced-match rounds). */
  assists: number;
  /** goals per evening attended, one decimal. */
  goalsPerEvening: number;
  /** distinct teammates ever shared a finished game with. */
  distinctPlayers: number;
  mostPlayedWith: NamedStat | null;
  regularPartnerResults?: PersonalPartnerResults | null;
  mostWinsWith: NamedStat | null;
  /** opponent you beat the most (head-to-head). */
  biggestVictim: NamedStat | null;
  /** opponent who beat you the most. */
  nemesis: NamedStat | null;
  /** teammate you SET UP the most (most goals you assisted them). */
  mostAssistedTo: NamedStat | null;
  /** teammate who SET YOU UP the most (most goals they assisted you). */
  mostAssistedBy: NamedStat | null;
}

function emptySummary(goals: number, assists: number): PlayerStatsSummary {
  return {
    attendedGames: 0,
    totalRegistered: 0,
    attendanceRate: 0,
    goals,
    assists,
    goalsPerEvening: 0,
    distinctPlayers: 0,
    mostPlayedWith: null,
    mostWinsWith: null,
    biggestVictim: null,
    nemesis: null,
    mostAssistedTo: null,
    mostAssistedBy: null,
  };
}

function topEntry(map: Record<string, number>): NamedStat | null {
  let best: NamedStat | null = null;
  for (const [uid, count] of Object.entries(map)) {
    if (count > 0 && (!best || count > best.count)) best = { uid, count };
  }
  return best;
}

async function readStatsSource<T>(source: 'games' | 'pairs', userId: UserId, read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    observeCaughtError(error, { source: 'src/services/playerStatsService.ts', handler: 'readStatsSource', site: `playerStats:${source}` });
    logError(`playerStats.${source}`, error, { userId });
    throw error;
  }
}

export const playerStatsService = {
  async compute(
    userId: UserId,
    ctx: { goals?: number; assists?: number; onBase?: (summary: PlayerStatsSummary) => void; onHighlights?: (highlights: PersonalHighlights) => void; isCurrent?: () => boolean; recentHighlightsOnly?: boolean } = {},
  ): Promise<PlayerStatsSummary> {
    const goals = Math.max(0, ctx.goals ?? 0);
    const assists = Math.max(0, ctx.assists ?? 0);
    if (!userId) return emptySummary(goals, assists);
    // Mock: synthesize a plausible summary so the profile stats screen renders
    // with data (attendedGames > 0 flips the `hasData` gate) instead of the
    // empty state — lets the penalty tiles + numbers show in the emulator demo.
    if (USE_MOCK_DATA) {
      return {
        ...emptySummary(goals, assists),
        attendedGames: 28,
        totalRegistered: 30,
        attendanceRate: 93,
        goalsPerEvening: 28 > 0 ? Math.round((goals / 28) * 10) / 10 : 0,
        distinctPlayers: 22,
      };
    }

    // Independent sources start together; failure stays a failure of its source.
    const [snap, [asA, asB]] = await Promise.all([
      readStatsSource('games', userId, () => getDocs(
        query(col.games(), where('participantIds', 'array-contains', userId)),
      )),
      readStatsSource('pairs', userId, () => Promise.all([
        getDocs(query(col.pairStats(), where('a', '==', userId))),
        getDocs(query(col.pairStats(), where('b', '==', userId))),
      ])),
    ]);

    // ── Games scan: attendance + co-attendance per teammate ──────────────
    let attendedGames = 0;
    const attendedRounds: PersonalRound[] = [];
    let totalRegistered = 0;
    const attendance: Array<{ id: string; at: number; attended: boolean }> = [];
    let attendanceDatesComplete = true;
    const withPlayer: Record<string, number> = {};
    try {
      const now = Date.now();
      for (const d of snap.docs) {
        const g = d.data() as {
          status?: string;
          startsAt?: number;
          players?: string[];
          arrivals?: Record<string, string>;
          groupId?: string;
        };
        if (g.status !== 'finished') continue;
        if (typeof g.startsAt === 'number' && g.startsAt >= now) continue;
        const players = g.players ?? [];
        if (!players.includes(userId)) continue;
        const arrivals = g.arrivals ?? {};
        if (!didEveningHappen(g)) continue;
        totalRegistered += 1;
        // Canonical attended gate — shared with the Profile count + History.
        const attended = isAttendedGame(g, userId, now);
        if (typeof g.startsAt === 'number' && Number.isFinite(g.startsAt) && g.startsAt > 0) {
          attendance.push({ id: d.id, at: g.startsAt, attended });
        } else attendanceDatesComplete = false;
        if (!attended) continue;
        attendedGames += 1;
        attendedRounds.push({gameId:d.id,at:g.startsAt ?? 0,groupId:g.groupId});
        for (const pid of players) {
          if (pid === userId || arrivals[pid] === 'no_show') continue;
          withPlayer[pid] = (withPlayer[pid] ?? 0) + 1;
        }
      }
    } catch (err) {
    observeCaughtError(err, {"source":"src/services/playerStatsService.ts","handler":"compute","site":"playerStatsService:f492053211"});
      logError('playerStats.games', err, { userId });
      throw err;
    }

    const distinctPlayers = Object.keys(withPlayer).length;
    const mostPlayedWith = topEntry(withPlayer);
    const attendanceRate =
      totalRegistered > 0
        ? Math.round((attendedGames / totalRegistered) * 100)
        : 0;
    const goalsPerEvening =
      attendedGames > 0 ? Math.round((goals / attendedGames) * 10) / 10 : 0;

    // ── pairStats: most-wins-with + head-to-head victim / nemesis ────────
    let mostWinsWith: NamedStat | null = null;
    let biggestVictim: NamedStat | null = null;
    let nemesis: NamedStat | null = null;
    let mostAssistedTo: NamedStat | null = null;
    let mostAssistedBy: NamedStat | null = null;
    let regularPartnerResults: PersonalPartnerResults | null = null;
    try {
      let bestWith = 0;
      let bestVic = 0;
      let bestNem = 0;
      let bestAssistTo = 0;
      let bestAssistBy = 0;
      const consider = (
        partner: string,
        winsTogether: number,
        myWins: number,
        myLosses: number,
        iAssistedThem: number,
        theyAssistedMe: number,
      ) => {
        if (winsTogether > bestWith) {
          bestWith = winsTogether;
          mostWinsWith = { uid: partner, count: winsTogether };
        }
        if (myWins > bestVic) {
          bestVic = myWins;
          biggestVictim = { uid: partner, count: myWins };
        }
        if (myLosses > bestNem) {
          bestNem = myLosses;
          nemesis = { uid: partner, count: myLosses };
        }
        if (iAssistedThem > bestAssistTo) {
          bestAssistTo = iAssistedThem;
          mostAssistedTo = { uid: partner, count: iAssistedThem };
        }
        if (theyAssistedMe > bestAssistBy) {
          bestAssistBy = theyAssistedMe;
          mostAssistedBy = { uid: partner, count: theyAssistedMe };
        }
      };
      // winsA/winsB + assistsAToB/BToA are by SORTED-first uid. When I'm `a`,
      // my directional wins are winsA, my losses winsB, the assists I GAVE are
      // assistsAToB and assists I RECEIVED are assistsBToA; when I'm `b` it's
      // all mirrored.
      for (const d of asA.docs) {
        const x = d.data() as {
          b?: string;
          winsTogether?: number;
          sameTeam?: number;
          lossesTogether?: number;
          winsA?: number;
          winsB?: number;
          assistsAToB?: number;
          assistsBToA?: number;
        };
        if (x.b === mostPlayedWith?.uid) regularPartnerResults = personalPartnerResults(x);
        if (x.b)
          consider(
            x.b,
            x.winsTogether ?? 0,
            x.winsA ?? 0,
            x.winsB ?? 0,
            x.assistsAToB ?? 0,
            x.assistsBToA ?? 0,
          );
      }
      for (const d of asB.docs) {
        const x = d.data() as {
          a?: string;
          winsTogether?: number;
          sameTeam?: number;
          lossesTogether?: number;
          winsA?: number;
          winsB?: number;
          assistsAToB?: number;
          assistsBToA?: number;
        };
        if (x.a === mostPlayedWith?.uid) regularPartnerResults = personalPartnerResults(x);
        if (x.a)
          consider(
            x.a,
            x.winsTogether ?? 0,
            x.winsB ?? 0,
            x.winsA ?? 0,
            x.assistsBToA ?? 0,
            x.assistsAToB ?? 0,
          );
      }
    } catch (err) {
    observeCaughtError(err, {"source":"src/services/playerStatsService.ts","handler":"compute","site":"playerStatsService:e545ae83bd"});
      logError('playerStats.pairs', err, { userId });
      throw err;
    }

    const base: PlayerStatsSummary = {
      attendedGames,
      totalRegistered,
      attendanceRate,
      goals,
      assists,
      goalsPerEvening,
      distinctPlayers,
      mostPlayedWith,
      regularPartnerResults,
      mostWinsWith,
      biggestVictim,
      nemesis,
      mostAssistedTo,
      mostAssistedBy,
    };
    if (attendanceDatesComplete && attendance.length) {
      let current = 0, best = 0;
      for (const round of attendance.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))) {
        current = round.attended ? current + 1 : 0;
        best = Math.max(best, current);
      }
      base.attendanceStreak = { current, best };
    }
    // A blurred screen already ignores the result; do not begin its history reads.
    if (ctx.isCurrent?.() === false) return base;
    ctx.onBase?.(base);
    const highlightRounds = ctx.recentHighlightsOnly
      ? [...attendedRounds].sort((a, b) => b.at - a.at || b.gameId.localeCompare(a.gameId)).slice(0, 5)
      : attendedRounds;
    const highlights = await loadPersonalHighlights(userId, highlightRounds, {
      isCurrent: ctx.isCurrent,
      onProgress: ctx.onHighlights,
    });
    return { ...base, highlights };
  },
};
