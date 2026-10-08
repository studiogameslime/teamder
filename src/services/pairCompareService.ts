// Two players, inside ONE club, in ONE slice of its history.
//
// This replaces two readers that disagreed with each other:
//
//   • `playerCompareService` — strictly per-club, but with no season control
//     and no pair record at all.
//   • `gameService.getPairStats` — a full pair record, but GLOBAL: read from
//     `pairStats/{a__b}`, a document with no groupId, no seasonId and no way
//     to filter by either. A pair who play in two clubs carried one club's
//     record onto the other's screen.
//
// Everything here is per-club, because the screen above it names a club. The
// source is `communityPairStats/{groupId__a__b}` for the running season and
// the season archive for a closed one — the same two sources the club's own
// chemistry section already reads, so the two can never disagree.
//
// ⚠️ ONE DOCUMENT, not the club's whole pair collection. `clubChemistryService`
// fetches every pair because it has to pick six winners out of them; this
// screen knows exactly which pair it wants, and the real club has 301 of them.

import { doc, getDoc } from 'firebase/firestore';

import { USE_MOCK_DATA, getFirebase } from '@/firebase/config';
import { gameService } from '@/services/gameService';
import { groupService } from '@/services/groupService';
import { userService } from '@/services/userService';
import { seasonHistoryService } from '@/services/seasonHistoryService';
import { logError, isExpectedDenial } from '@/services/errorLog';
import {
  EMPTY_PAIR,
  mergePairs,
  type PairTotals,
} from '@/utils/clubChemistry';
import { mergeAllTime, type TableSlice } from '@/utils/allTimeTable';
import { orientPair, pairKey, winPct, type OrientedPair } from '@/utils/pairOrientation';
import type { StatsScope } from '@/components/stats/SeasonScopeBar';
import { comparePoints, type ChampionshipRow } from '@/utils/championship';
import type { GroupId, GroupSeasons, UserId } from '@/types';
import { mockPairCompare } from '@/data/mockPairCompare';

/** One player's identity on the screen. */
export interface PairSide {
  uid: UserId;
  name: string;
  avatarId?: string;
  photoUrl?: string;
  /**
   * The player has a stat row in the slice on screen.
   *
   * FALSE is not "zero of everything": it is "did not play this season", and
   * the screen says so rather than printing a column of zeros beside a
   * teammate who did play. The distinction was the whole point of
   * `playerCompareService` learning to return null; here it is per-side.
   */
  played: boolean;
  row: ChampionshipRow | null;
}

export type CompareFormat = 'int' | 'pct' | 'avg1';

export interface CompareRow {
  key: string;
  label: string;
  /** null = this player has no value for the row (did not play the slice). */
  a: number | null;
  b: number | null;
  format: CompareFormat;
  /** Which side the row favours. 'tie' also means "not scored". */
  winner: 'a' | 'b' | 'tie';
  /** Rows that are shown but never counted towards "who leads". */
  unscored?: boolean;
}

export interface PairCompareModel {
  club: { id: GroupId; name: string };
  /** The viewer. */
  a: PairSide;
  /** The other player. */
  b: PairSide;
  /** The pair record, already turned to face the viewer. */
  pair: OrientedPair;
  /** True when a pair document existed at all for this slice. */
  pairKnown: boolean;
  together: {
    winPct: number | null;
    cleanSheetPct: number | null;
    assistsTotal: number;
  };
  h2h: {
    winPctViewer: number | null;
    winPctOther: number | null;
    /** 'a' = viewer leads the series, 'b' = other, 'tie' = level. */
    leader: 'a' | 'b' | 'tie';
  };
  comparison: CompareRow[];
  verdict: { leader: 'a' | 'b' | 'tie'; aLeads: number; bLeads: number; total: number };
  /**
   * Club-table position, 1-based.
   *
   * Null when the slice has no table to rank in, or the player is not in it.
   * NEVER the live table's position printed over a past season — that is the
   * single worst thing this screen could do, and the reason the rank comes
   * from the same slice as everything else.
   */
  rankA: number | null;
  rankB: number | null;
  rankTotal: number;
  /**
   * When the club's pair counters start.
   *
   * Shown to the reader, because "26 משחקונים יחד" reads as a lifetime and is
   * not one: the per-club rollup began mid-2026 for every club that has it.
   */
  chemistrySince: number | null;
}

/**
 * Rank a slice's rows the way the club table does — through the SAME
 * comparator the club table uses, not a copy of it.
 *
 * Re-applying it here is what lets a MERGED all-time slice (whose rows arrive
 * in map-insertion order) be ranked by the same rule as a single season,
 * instead of by an accident of insertion.
 */
function rankRows(rows: readonly ChampionshipRow[]): ChampionshipRow[] {
  return [...rows].sort(comparePoints);
}

function row(
  key: string,
  label: string,
  a: number | null,
  b: number | null,
  format: CompareFormat,
  unscored = false,
): CompareRow {
  const winner: CompareRow['winner'] =
    unscored || a === null || b === null || a === b ? 'tie' : (key === 'losses' ? a < b : a > b) ? 'a' : 'b';
  return { key, label, a, b, format, winner, unscored };
}

/** A per-club pair document, or null when the two have never shared a round. */
async function readLivePair(
  groupId: GroupId,
  uidA: UserId,
  uidB: UserId,
): Promise<PairTotals | null> {
  const n = (v: unknown): number =>
    typeof v === 'number' && Number.isFinite(v) ? v : 0;
  try {
    const { db } = getFirebase();
    const snap = await getDoc(
      doc(db, 'communityPairStats', `${groupId}__${pairKey(uidA, uidB)}`),
    );
    if (!snap.exists()) return null;
    const x = snap.data() as Record<string, unknown>;
    // Field by field, like every other reader in this app: a field the
    // document gains and this function does not name simply would not exist.
    // The legacy, non-directional `assists` is NOT read — see
    // `clubChemistryService` for why a card must not print a breakdown beside
    // a total that covers more history than the breakdown does.
    return {
      sameTeam: n(x.sameTeam),
      winsTogether: n(x.winsTogether),
      lossesTogether: n(x.lossesTogether),
      cleanSheetsTogether: n(x.cleanSheetsTogether),
      against: n(x.against),
      winsA: n(x.winsA),
      winsB: n(x.winsB),
      assistsAToB: n(x.assistsAToB),
      assistsBToA: n(x.assistsBToA),
    };
  } catch (err) {
    if (!isExpectedDenial(err)) logError('pairCompareLivePair', err, { groupId });
    throw err;
  }
}

/** `communityStats/{groupId}.chemistrySince` — the pair window's first day. */
async function readChemistrySince(groupId: GroupId): Promise<number | null> {
  try {
    const { db } = getFirebase();
    const snap = await getDoc(doc(db, 'communityStats', groupId));
    const v = snap.exists() ? snap.get('chemistrySince') : null;
    return typeof v === 'number' && v > 0 ? v : null;
  } catch (err) {
    if (!isExpectedDenial(err)) logError('pairCompareSince', err, { groupId });
    return null;
  }
}

export interface PairCompareInput {
  groupId: GroupId;
  viewerId: UserId;
  otherId: UserId;
  scope: StatsScope;
  /** Closed seasons, already loaded by the screen (it needs them for the bar). */
  pastSeasonIds: readonly string[];
  seasons?: GroupSeasons;
}

export const pairCompareService = {
  /**
   * Everything the unified screen renders, for one scope.
   *
   * Returns null only when the slice cannot be assembled honestly — a missing
   * archive in an all-time sum, for instance. An empty pair is NOT a failure:
   * two club members who have never shared a mini-game are a perfectly normal
   * answer, and the screen has empty states for it.
   */
  async load(input: PairCompareInput): Promise<PairCompareModel | null> {
    const { groupId, viewerId, otherId, scope, pastSeasonIds, seasons } = input;
    if (!groupId || !viewerId || !otherId || viewerId === otherId) return null;
    if (USE_MOCK_DATA) return mockPairCompare(input);

    try {
      const [group, ua, ub] = await Promise.all([
        groupService.get(groupId).catch(() => null),
        userService.getUserById(viewerId).catch(() => null),
        userService.getUserById(otherId).catch(() => null),
      ]);

      // ── The slice ────────────────────────────────────────────────────────
      let pairTotals: PairTotals | null = null;
      let players: ChampionshipRow[] = [];
      let names: Record<string, string> = {};
      let since: number | null = null;
      /** Evenings attended, the authoritative scan — running season only. */
      let attended: Record<string, number> = {};

      if (scope.k === 'season') {
        const table = await seasonHistoryService.table(groupId, scope.id);
        if (!table) return null;
        pairTotals = table.pairs?.[pairKey(viewerId, otherId)] ?? null;
        players = table.players ?? [];
        names = table.names ?? {};
        // A sealed season's window is the season. Quoting the club's
        // chemistry start date over it would be quoting the wrong window.
        since = null;
      } else if (scope.k === 'all') {
        // Live + every archive. Nothing recomputes: the archives are the
        // sealed record of the seasons they closed, so this is addition over
        // numbers that were already agreed.
        const [livePair, champ, archives, sinceAt] = await Promise.all([
          readLivePair(groupId, viewerId, otherId),
          gameService.getCommunityChampionship(groupId, undefined, true),
          Promise.all(
            pastSeasonIds.map((id) => seasonHistoryService.table(groupId, id)),
          ),
          readChemistrySince(groupId),
        ]);
        // A gap would UNDERSTATE the total, and an understated lifetime is
        // worse than no lifetime. Same refusal the club stats screen makes.
        if (archives.some((t) => !t)) return null;
        if ((seasons?.count ?? 0) > 0 && pastSeasonIds.length === 0) return null;
        const live: TableSlice = {
          totalGoals: champ?.totalGoals ?? 0,
          totalRounds: champ?.totalRounds ?? 0,
          tiedRounds: champ?.tiedRounds ?? 0,
          shootoutRounds: champ?.shootoutRounds ?? 0,
          scorelessRounds: champ?.scorelessRounds ?? 0,
          countedRounds: champ?.countedRounds ?? 0,
          guestGoals: champ?.guestGoals ?? 0,
          ownGoals: champ?.ownGoals ?? 0,
          players: champ?.players ?? [],
        };
        const merged = mergeAllTime([
          live,
          ...(archives as NonNullable<(typeof archives)[number]>[]),
        ]);
        players = merged.players;
        names = merged.names ?? {};
        // Summed through the SAME `mergePairs` the club's chemistry uses, on
        // a one-key record, so all-time here and all-time there can never add
        // up differently. The key is arbitrary; only the value is read back.
        const K = 'p';
        const summed = (archives as NonNullable<(typeof archives)[number]>[]).reduce<
          Record<string, PairTotals>
        >(
          (acc, t) =>
            mergePairs(acc, { [K]: t.pairs?.[pairKey(viewerId, otherId)] ?? EMPTY_PAIR }),
          { [K]: livePair ?? EMPTY_PAIR },
        );
        pairTotals = summed[K];
        since = sinceAt;
      } else {
        // The running season — the live documents ARE it.
        const seasonArg =
          group?.seasons?.enabled && group.seasons.currentId
            ? {
                currentId: group.seasons.currentId,
                currentNo: group.seasons.currentNo ?? 1,
              }
            : undefined;
        const [livePair, champ, stats, sinceAt] = await Promise.all([
          readLivePair(groupId, viewerId, otherId),
          gameService.getCommunityChampionship(groupId, undefined, true),
          gameService.getCommunityStats(groupId, seasonArg, true),
          readChemistrySince(groupId),
        ]);
        pairTotals = livePair;
        players = champ?.players ?? [];
        attended = stats?.attendedByUser ?? {};
        since = sinceAt;
      }

      // ── The two sides ────────────────────────────────────────────────────
      const byUid = new Map(players.map((p) => [p.uid, p]));
      // `attended` is the authoritative evening count and only exists for the
      // running season; a sealed slice keeps the count it was sealed with.
      const withGames = (r: ChampionshipRow | undefined): ChampionshipRow | null =>
        r ? { ...r, games: attended[r.uid] ?? r.games } : null;
      const rowA = withGames(byUid.get(viewerId));
      const rowB = withGames(byUid.get(otherId));

      const side = (
        uid: UserId,
        u: { name?: string; avatarId?: string; photoUrl?: string } | null,
        r: ChampionshipRow | null,
      ): PairSide => ({
        uid,
        name: u?.name || names[uid] || he_playerFallback,
        avatarId: u?.avatarId,
        photoUrl: u?.photoUrl,
        played: !!r,
        row: r,
      });

      const a = side(viewerId, ua, rowA);
      const b = side(otherId, ub, rowB);

      // ── The pair ─────────────────────────────────────────────────────────
      const pair = orientPair(viewerId, otherId, pairTotals);
      const pairKnown = pairTotals != null;

      // ── The comparison rows ──────────────────────────────────────────────
      const v = (r: ChampionshipRow | null, f: (x: ChampionshipRow) => number) =>
        r ? f(r) : null;
      const gpg = (r: ChampionshipRow | null) =>
        r ? (r.games > 0 ? Math.round((r.goals / r.games) * 10) / 10 : 0) : null;
      const pct = (r: ChampionshipRow | null) =>
        r ? winPct(r.wins, r.losses) : null;

      const comparison: CompareRow[] = [
        row('goals', LBL.goals, v(rowA, (r) => r.goals), v(rowB, (r) => r.goals), 'int'),
        row('assists', LBL.assists, v(rowA, (r) => r.assists), v(rowB, (r) => r.assists), 'int'),
        row('wins', LBL.wins, v(rowA, (r) => r.wins), v(rowB, (r) => r.wins), 'int'),
        row('losses', LBL.losses, v(rowA, (r) => r.losses), v(rowB, (r) => r.losses), 'int'),
        row('winPct', LBL.winPct, pct(rowA), pct(rowB), 'pct'),
        row('rounds', LBL.rounds, v(rowA, (r) => r.rounds), v(rowB, (r) => r.rounds), 'int'),
        row('games', LBL.games, v(rowA, (r) => r.games), v(rowB, (r) => r.games), 'int'),
        row('gpg', LBL.gpg, gpg(rowA), gpg(rowB), 'avg1'),
      ];
      // Draws are NOT a row here any more.
      //
      // They were, as an unscored row — more draws is not better than fewer.
      // But an unscored row on a card whose every other row declares a winner
      // reads as a contest nobody won, and a reader asked exactly that:
      // "מה זה התיקו פה? כי אם זה ביננו אז תמיד יהיה לשנינו את אותו מספר"
      // (Pulse, מתן לוי). He was reading it as a head-to-head tally — which
      // it never was; it is each player's own draws in the club. A row that
      // can favour neither side, on a card built to say who is ahead, is the
      // one row that earns its space least. The number is still on the club
      // table, where it belongs.
      // The rest only when at least one of the two has any — otherwise every
      // comparison would carry three 0-vs-0 rows.
      const csA = v(rowA, (r) => r.cleanSheets);
      const csB = v(rowB, (r) => r.cleanSheets);
      if ((csA ?? 0) > 0 || (csB ?? 0) > 0) {
        comparison.push(row('cleanSheets', LBL.cleanSheets, csA, csB, 'int'));
      }
      const psA = v(rowA, (r) => r.penScored);
      const psB = v(rowB, (r) => r.penScored);
      if ((psA ?? 0) > 0 || (psB ?? 0) > 0) {
        comparison.push(row('penScored', LBL.penScored, psA, psB, 'int'));
      }
      const pvA = v(rowA, (r) => r.penSaved);
      const pvB = v(rowB, (r) => r.penSaved);
      if ((pvA ?? 0) > 0 || (pvB ?? 0) > 0) {
        comparison.push(row('penSaved', LBL.penSaved, pvA, pvB, 'int'));
      }

      const scored = comparison.filter((r) => !r.unscored);
      const aLeads = scored.filter((r) => r.winner === 'a').length;
      const bLeads = scored.filter((r) => r.winner === 'b').length;

      // ── Rank, from the SAME slice ────────────────────────────────────────
      const ranked = rankRows(players);
      const idxA = ranked.findIndex((r) => r.uid === viewerId);
      const idxB = ranked.findIndex((r) => r.uid === otherId);

      return {
        club: { id: groupId, name: group?.name ?? '' },
        a,
        b,
        pair,
        pairKnown,
        together: {
          winPct: winPct(pair.winsTogether, pair.lossesTogether),
          cleanSheetPct:
            pair.roundsTogether > 0
              ? Math.round((pair.cleanSheetsTogether / pair.roundsTogether) * 100)
              : null,
          assistsTotal: pair.assistsViewerToOther + pair.assistsOtherToViewer,
        },
        h2h: {
          winPctViewer: winPct(pair.winsViewer, pair.winsOther),
          winPctOther: winPct(pair.winsOther, pair.winsViewer),
          leader:
            pair.winsViewer > pair.winsOther
              ? 'a'
              : pair.winsOther > pair.winsViewer
                ? 'b'
                : 'tie',
        },
        comparison,
        verdict: {
          leader: aLeads > bLeads ? 'a' : bLeads > aLeads ? 'b' : 'tie',
          aLeads,
          bLeads,
          total: scored.length,
        },
        rankA: idxA >= 0 ? idxA + 1 : null,
        rankB: idxB >= 0 ? idxB + 1 : null,
        rankTotal: ranked.length,
        chemistrySince: since,
      };
    } catch (err) {
      logError('pairCompareLoad', err, { groupId, viewerId, otherId, scope: scope.k });
      return null;
    }
  },
};

// Labels live beside the rows they name rather than in the renderer, so the
// "who leads" tally and the printed row can never fall out of step.
const LBL = {
  goals: 'גולים',
  assists: 'בישולים',
  wins: 'ניצחונות',
  losses: 'הפסדים',
  ties: 'תיקו',
  winPct: 'אחוז ניצחון',
  // "משחקים", like every other pair surface — the 22.09 rename reached the
  // screens but not this table, so one row kept the old word (reported).
  rounds: 'משחקים',
  games: 'מחזורים',
  gpg: 'ממוצע גולים למחזור',
  cleanSheets: 'שערים נקיים',
  penScored: 'פנדלים שהוכנסו',
  penSaved: 'פנדלים שנעצרו',
} as const;

const he_playerFallback = 'שחקן';
