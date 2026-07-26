// playerCompareService — builds the comparison model for two players within a
// single community. STRICTLY per-community: every figure comes from that club's
// own rollup, never the player's app-wide totals.
//   • getCommunityChampionship  → each player's cumulative goals/assists/
//     wins/losses/games/rounds (communityPlayerStats, filtered by groupId).
// No head-to-head / "together" here on purpose: those live only in the GLOBAL
// pairStats doc (cross-community) — there's no per-community wins/against/
// together aggregate yet — so surfacing them would leak app-wide data into a
// per-community card. (A per-community h2h needs a backend rollup; TODO.)
// No new backend. The screen captures the card to a PNG and shares it, exactly
// like the evening summary.

import { gameService } from '@/services/gameService';
import { userService } from '@/services/userService';
import { logError } from '@/services/errorLog';
import type { UserId, GroupId } from '@/types';

export interface ComparePlayer {
  uid: UserId;
  name: string;
  /** Built-in avatar id (source of truth) + legacy photo fallback. */
  avatarId: string;
  photo: string;
  games: number;
  goals: number;
  assists: number;
  wins: number;
  losses: number;
  rounds: number;
  /** Penalty-shootout: scored (kicker) + saved (keeper). */
  penScored: number;
  penSaved: number;
  /** derived */
  winPct: number;
  goalsPerGame: number;
}

export type MetricFormat = 'int' | 'pct' | 'avg1';

export interface CompareMetric {
  key: string;
  label: string;
  a: number;
  b: number;
  format: MetricFormat;
  /** 'a' = viewer leads, 'b' = other leads, 'tie'. */
  winner: 'a' | 'b' | 'tie';
}

export interface ComparisonModel {
  /** a = the viewer ("you"); b = the other player. */
  a: ComparePlayer;
  b: ComparePlayer;
  metrics: CompareMetric[];
  verdict: { leader: 'a' | 'b' | 'tie'; aLeads: number; bLeads: number; total: number };
  // Community-table standing (1-based) for each player. Shown as its own row —
  // NOT folded into the verdict count, since rank is derived from the same
  // points the metrics already cover (would double-count the leader). null when
  // a player has no ranked stat row yet.
  rankA: number | null;
  rankB: number | null;
  rankTotal: number;
}

interface Row {
  uid: UserId;
  goals: number;
  assists: number;
  wins: number;
  losses: number;
  games: number;
  rounds: number;
  penScored: number;
  penSaved: number;
}

function toPlayer(
  row: Row,
  name: string,
  avatarId: string,
  photo: string,
): ComparePlayer {
  const decided = row.wins + row.losses;
  return {
    uid: row.uid,
    name,
    avatarId,
    photo,
    games: row.games,
    goals: row.goals,
    assists: row.assists,
    wins: row.wins,
    losses: row.losses,
    rounds: row.rounds,
    penScored: row.penScored,
    penSaved: row.penSaved,
    winPct: decided > 0 ? Math.round((row.wins / decided) * 100) : 0,
    goalsPerGame: row.games > 0 ? Math.round((row.goals / row.games) * 10) / 10 : 0,
  };
}

function metric(
  key: string,
  label: string,
  a: number,
  b: number,
  format: MetricFormat,
): CompareMetric {
  const winner: CompareMetric['winner'] = a > b ? 'a' : b > a ? 'b' : 'tie';
  return { key, label, a, b, format, winner };
}

export const playerCompareService = {
  /**
   * Compare `uidA` (the viewer) with `uidB` inside `groupId`.
   * Returns null when either player has no stat row in the club.
   */
  async getComparison(
    groupId: GroupId,
    uidA: UserId,
    uidB: UserId,
  ): Promise<ComparisonModel | null> {
    if (!groupId || !uidA || !uidB || uidA === uidB) return null;
    try {
      // getCommunityStats gives the AUTHORITATIVE "משחקים" (finished-nights
      // scan) — same source the champions table reads — so the compare card
      // doesn't disagree with it over the drift-prone `games` rollup.
      const [champ, stats, ua, ub] = await Promise.all([
        gameService.getCommunityChampionship(groupId).catch(() => null),
        gameService.getCommunityStats(groupId).catch(() => null),
        userService.getUserById(uidA).catch(() => null),
        userService.getUserById(uidB).catch(() => null),
      ]);

      const rows = (champ?.players ?? []) as Row[];
      const byId = new Map(rows.map((r) => [r.uid, r]));
      const attended = stats?.attendedByUser ?? {};
      const zero: Row = {
        uid: '',
        goals: 0,
        assists: 0,
        wins: 0,
        losses: 0,
        games: 0,
        rounds: 0,
        penScored: 0,
        penSaved: 0,
      };
      const rowA = { ...zero, ...(byId.get(uidA) ?? {}), uid: uidA, games: attended[uidA] ?? byId.get(uidA)?.games ?? 0 };
      const rowB = { ...zero, ...(byId.get(uidB) ?? {}), uid: uidB, games: attended[uidB] ?? byId.get(uidB)?.games ?? 0 };

      const a = toPlayer(rowA, ua?.name ?? 'שחקן', ua?.avatarId ?? '', ua?.photoUrl ?? '');
      const b = toPlayer(rowB, ub?.name ?? 'שחקן', ub?.avatarId ?? '', ub?.photoUrl ?? '');

      const metrics: CompareMetric[] = [
        metric('goals', 'גולים', a.goals, b.goals, 'int'),
        metric('assists', 'בישולים', a.assists, b.assists, 'int'),
        metric('winPct', 'אחוז ניצחון', a.winPct, b.winPct, 'pct'),
        metric('gpg', 'ממוצע גולים לערב', a.goalsPerGame, b.goalsPerGame, 'avg1'),
        metric('games', 'משחקים', a.games, b.games, 'int'),
        metric('rounds', 'משחקונים', a.rounds, b.rounds, 'int'),
      ];
      // Penalty rows only when at least one of the two has taken/faced any —
      // otherwise every comparison would carry two 0-vs-0 rows.
      if (a.penScored > 0 || b.penScored > 0) {
        metrics.push(metric('penScored', 'פנדלים שהוכנסו', a.penScored, b.penScored, 'int'));
      }
      if (a.penSaved > 0 || b.penSaved > 0) {
        metrics.push(metric('penSaved', 'פנדלים שנעצרו', a.penSaved, b.penSaved, 'int'));
      }

      const aLeads = metrics.filter((m) => m.winner === 'a').length;
      const bLeads = metrics.filter((m) => m.winner === 'b').length;
      const verdict = {
        leader: (aLeads > bLeads ? 'a' : bLeads > aLeads ? 'b' : 'tie') as
          | 'a'
          | 'b'
          | 'tie',
        aLeads,
        bLeads,
        total: metrics.length,
      };

      // Community-table position = index in the points-ranked champ list.
      const idxA = rows.findIndex((r) => r.uid === uidA);
      const idxB = rows.findIndex((r) => r.uid === uidB);
      return {
        a,
        b,
        metrics,
        verdict,
        rankA: idxA >= 0 ? idxA + 1 : null,
        rankB: idxB >= 0 ? idxB + 1 : null,
        rankTotal: rows.length,
      };
    } catch (err) {
      logError('getComparison', err, { groupId, uidA, uidB });
      return null;
    }
  },
};
