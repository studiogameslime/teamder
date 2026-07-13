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
}

interface Row {
  uid: UserId;
  goals: number;
  assists: number;
  wins: number;
  losses: number;
  games: number;
  rounds: number;
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
      const [champ, ua, ub] = await Promise.all([
        gameService.getCommunityChampionship(groupId).catch(() => null),
        userService.getUserById(uidA).catch(() => null),
        userService.getUserById(uidB).catch(() => null),
      ]);

      const rows = (champ?.players ?? []) as Row[];
      const byId = new Map(rows.map((r) => [r.uid, r]));
      const zero: Row = {
        uid: '',
        goals: 0,
        assists: 0,
        wins: 0,
        losses: 0,
        games: 0,
        rounds: 0,
      };
      const rowA = { ...zero, ...(byId.get(uidA) ?? {}), uid: uidA };
      const rowB = { ...zero, ...(byId.get(uidB) ?? {}), uid: uidB };

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

      return { a, b, metrics, verdict };
    } catch (err) {
      logError('getComparison', err, { groupId, uidA, uidB });
      return null;
    }
  },
};
