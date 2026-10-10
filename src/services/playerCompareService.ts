// LEGACY, retained outside the active App.tsx import graph (2026-10-10).
// Current comparison screens use pairCompareService.ts and communityPairStats.
// The historical comments below do not describe the current comparison pipeline.
// See docs/features/entry/legacy-and-hidden.md before reusing or removing this file.
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
import { groupService } from '@/services/groupService';
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
  ties: number;
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
  // points the metrics already cover (would double-count the leader). Nullable
  // for an unranked player, which no longer happens: the service now returns
  // null for the whole comparison rather than build one around a missing row.
  rankA: number | null;
  rankB: number | null;
  rankTotal: number;
}

interface Row {
  uid: UserId;
  goals: number;
  assists: number;
  wins: number;
  ties: number;
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
    ties: row.ties,
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
   * Returns null when either player has no stat row in the club — see the
   * guard below, which is what makes `he.compareUnavailable` reachable.
   */
  async getComparison(
    groupId: GroupId,
    uidA: UserId,
    uidB: UserId,
  ): Promise<ComparisonModel | null> {
    if (!groupId || !uidA || !uidB || uidA === uidB) return null;
    try {
      // The club FIRST, and for the same reason the stats screen reads it
      // first: the evening scan has to know WHICH SEASON it is counting.
      //
      // Everything else on this card comes from communityPlayerStats, which a
      // season close winds back to zero — so an unscoped scan put one lifetime
      // column among season columns. On the one club that runs seasons the
      // card read goals 0-0, assists 0-0, אחוז ניצחון 0%-0%, ממוצע גולים
      // למחזור 0.0-0.0 and then מחזורים 22-20, crowned the viewer on that one
      // row, and printed "אתה מוביל 👑 ב-1 מתוך 6 קטגוריות" over five zeros.
      // It also broke every per-game rate on the card, which divides season
      // goals by lifetime evenings. The club league table hit this first and
      // suppressed the override outright (see CommunityChampionship); here the
      // scan can simply be given the season, which keeps the authoritative
      // finished-nights count AND puts it in the same scope as the rest.
      // One extra document read is the price of the card agreeing with itself.
      const group = await groupService.get(groupId).catch(() => null);
      const season =
        group?.seasons?.enabled && group.seasons.currentId
          ? {
              currentId: group.seasons.currentId,
              currentNo: group.seasons.currentNo ?? 1,
            }
          : undefined;
      // getCommunityStats gives the AUTHORITATIVE "מחזורים" (finished-nights
      // scan) — same source the champions table reads — so the compare card
      // doesn't disagree with it over the drift-prone `games` rollup.
      const [champ, stats, ua, ub] = await Promise.all([
        gameService.getCommunityChampionship(groupId).catch(() => null),
        gameService.getCommunityStats(groupId, season).catch(() => null),
        userService.getUserById(uidA).catch(() => null),
        userService.getUserById(uidB).catch(() => null),
      ]);

      const rows = (champ?.players ?? []) as Row[];
      const byId = new Map(rows.map((r) => [r.uid, r]));
      const attended = stats?.attendedByUser ?? {};
      // The null this function has promised since it was written, and never
      // returned: both players fell back to a zero row unconditionally, so
      // `he.compareUnavailable` ("אין מספיק נתונים להשוואה עדיין") was
      // unreachable and the screen rendered a card of 0-0 rows instead. The
      // champions table only carries a player once something has happened to
      // him (goals, assists, wins or an evening on the roster), so a missing
      // row IS "nothing to compare yet" — including the whole club in the
      // window between a season close and its next sealed evening, when the
      // table is empty for everybody.
      const baseA = byId.get(uidA);
      const baseB = byId.get(uidB);
      if (!baseA || !baseB) return null;
      const zero: Row = {
        uid: '',
        goals: 0,
        assists: 0,
        wins: 0,
        ties: 0,
        losses: 0,
        games: 0,
        rounds: 0,
        penScored: 0,
        penSaved: 0,
      };
      const rowA = { ...zero, ...baseA, uid: uidA, games: attended[uidA] ?? baseA.games };
      const rowB = { ...zero, ...baseB, uid: uidB, games: attended[uidB] ?? baseB.games };

      const a = toPlayer(rowA, ua?.name ?? 'שחקן', ua?.avatarId ?? '', ua?.photoUrl ?? '');
      const b = toPlayer(rowB, ub?.name ?? 'שחקן', ub?.avatarId ?? '', ub?.photoUrl ?? '');

      const metrics: CompareMetric[] = [
        metric('goals', 'גולים', a.goals, b.goals, 'int'),
        metric('assists', 'בישולים', a.assists, b.assists, 'int'),
        metric('winPct', 'אחוז ניצחון', a.winPct, b.winPct, 'pct'),
        metric('gpg', 'ממוצע גולים למחזור', a.goalsPerGame, b.goalsPerGame, 'avg1'),
        metric('games', 'מחזורים', a.games, b.games, 'int'),
        // "משחקים", the name the 22.09 copy pass gave the mini-games
        // everywhere. The row above is `games`, the EVENINGS, and it is called
        // מחזורים — the pair the app keeps distinct is מחזורים / משחקים, two
        // words that share nothing. This row read "משחקונים" against a club
        // stats screen one tap away printing the same number as "משחקים".
        metric('rounds', 'משחקים', a.rounds, b.rounds, 'int'),
      ];
      // Draws only when one of them has any — a three-team club never draws,
      // and a 0-vs-0 row teaches nothing. Same rule as the penalty rows below
      // and as the club table's ties column.
      if (a.ties > 0 || b.ties > 0) {
        // Shown, but NEVER scored. `metric()` awards the row to whoever has the
        // bigger number, and the counts feed the head-to-head verdict — but
        // more draws is not better than fewer, it is just a different way the
        // evening went. Forcing 'tie' keeps the row informative and keeps it
        // out of the "who leads" tally.
        metrics.push({
          ...metric('ties', 'תיקו', a.ties, b.ties, 'int'),
          winner: 'tie',
        });
      }
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
