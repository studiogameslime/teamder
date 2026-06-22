// playerStatsService — the data behind the dedicated "סטטיסטיקה" screen.
//
// Everything here is DERIVED from data we already keep, in at most three
// reads: one games query (array-contains participantIds, same index the
// achievements derivation uses) plus the two pairStats halves (a==uid /
// b==uid). No new tracking is required.
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

export interface NamedStat {
  uid: UserId;
  count: number;
}

export interface PlayerStatsSummary {
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

export const playerStatsService = {
  async compute(
    userId: UserId,
    ctx: { goals?: number; assists?: number } = {},
  ): Promise<PlayerStatsSummary> {
    const goals = Math.max(0, ctx.goals ?? 0);
    const assists = Math.max(0, ctx.assists ?? 0);
    if (!userId || USE_MOCK_DATA) return emptySummary(goals, assists);

    // ── Games scan: attendance + co-attendance per teammate ──────────────
    let attendedGames = 0;
    let totalRegistered = 0;
    const withPlayer: Record<string, number> = {};
    try {
      const snap = await getDocs(
        query(col.games(), where('participantIds', 'array-contains', userId)),
      );
      const now = Date.now();
      for (const d of snap.docs) {
        const g = d.data() as {
          status?: string;
          startsAt?: number;
          players?: string[];
          arrivals?: Record<string, string>;
        };
        if (g.status !== 'finished') continue;
        if (typeof g.startsAt === 'number' && g.startsAt >= now) continue;
        const players = g.players ?? [];
        if (!players.includes(userId)) continue;
        const arrivals = g.arrivals ?? {};
        totalRegistered += 1;
        // Canonical attended gate — shared with the Profile count + History.
        if (!isAttendedGame(g, userId, now)) continue;
        attendedGames += 1;
        for (const pid of players) {
          if (pid === userId || arrivals[pid] === 'no_show') continue;
          withPlayer[pid] = (withPlayer[pid] ?? 0) + 1;
        }
      }
    } catch (err) {
      logError('playerStats.games', err, { userId });
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
    try {
      const [asA, asB] = await Promise.all([
        getDocs(query(col.pairStats(), where('a', '==', userId))),
        getDocs(query(col.pairStats(), where('b', '==', userId))),
      ]);
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
          winsA?: number;
          winsB?: number;
          assistsAToB?: number;
          assistsBToA?: number;
        };
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
          winsA?: number;
          winsB?: number;
          assistsAToB?: number;
          assistsBToA?: number;
        };
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
      logError('playerStats.pairs', err, { userId });
    }

    return {
      attendedGames,
      totalRegistered,
      attendanceRate,
      goals,
      assists,
      goalsPerEvening,
      distinctPlayers,
      mostPlayedWith,
      mostWinsWith,
      biggestVictim,
      nemesis,
      mostAssistedTo,
      mostAssistedBy,
    };
  },
};
