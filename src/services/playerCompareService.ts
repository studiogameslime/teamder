// playerCompareService — builds the head-to-head comparison model for two
// players within a community. Pure aggregation over existing sources:
//   • getCommunityChampionship  → each player's cumulative goals/assists/
//     wins/losses/games/rounds (communityPlayerStats rollup).
//   • getPairStats              → true head-to-head (winsAgainst/lossesAgainst,
//     opposing sides) + "together" record (winsTogether/lossesTogether).
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
  /** Opposing-sides record between them (from the viewer's POV). null = never. */
  headToHead: { aWins: number; bWins: number; total: number } | null;
  /** Same-team record. null = never played together. */
  together: { wins: number; losses: number; pct: number; total: number } | null;
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
      const [champ, pair, ua, ub] = await Promise.all([
        gameService.getCommunityChampionship(groupId).catch(() => null),
        gameService.getPairStats(uidA, uidB, groupId).catch(() => null),
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

      // Head-to-head (opposing sides). winsAgainst = uidA's side beat uidB's.
      const h2hTotal =
        (pair?.winsAgainst ?? 0) + (pair?.lossesAgainst ?? 0);
      const headToHead =
        h2hTotal > 0
          ? {
              aWins: pair?.winsAgainst ?? 0,
              bWins: pair?.lossesAgainst ?? 0,
              total: h2hTotal,
            }
          : null;

      // Together (same team).
      const togTotal = (pair?.winsTogether ?? 0) + (pair?.lossesTogether ?? 0);
      const together =
        togTotal > 0
          ? {
              wins: pair?.winsTogether ?? 0,
              losses: pair?.lossesTogether ?? 0,
              pct: Math.round(((pair?.winsTogether ?? 0) / togTotal) * 100),
              total: togTotal,
            }
          : null;

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

      return { a, b, metrics, headToHead, together, verdict };
    } catch (err) {
      logError('getComparison', err, { groupId, uidA, uidB });
      return null;
    }
  },
};
