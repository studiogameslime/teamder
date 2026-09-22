// CommunityStatsScreen — the club's collective statistics dashboard.
//
// Aggregates everything the community has accumulated: total goals / assists /
// mini-games / evenings, the leaderboards (top scorer, assister, winner, most
// loyal), a top-10 scorers table, and a few fun superlatives (deadliest
// goals-per-mini-game ratio, organisation rate, average attendance).
//
// Data comes from two rollups already maintained by the backend:
//   • getCommunityChampionship → cumulative per-player goals/assists/rounds/
//     wins/games (communityPlayerStats) + club totals.
//   • getCommunityStats → evenings held, organisation rate, attendance, and
//     active-member counts.
// No new collection needed — everything here is derived client-side.

import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';

import { ScreenHeader } from '@/components/ScreenHeader';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { InfoTip } from '@/components/InfoTip';
import { UserAvatar } from '@/components/UserAvatar';
import { SoccerBallLoader } from '@/components/SoccerBallLoader';
import { CountUp } from '@/components/anim/CountUp';
import { AppearItem } from '@/components/anim/AppearItem';
import { StatDonut } from '@/components/community/StatDonut';
import { CommunityChampionship } from '@/components/community/CommunityChampionship';
import { gameService } from '@/services/gameService';
import { userService } from '@/services';
import { groupService } from '@/services';
import { type ChampionshipRow } from '@/utils/championship';
import { penaltyKing, penaltyKeeperKing, pctOf } from '@/utils/penaltyStats';
import { colors, spacing, typography, radius, RTL_LABEL_ALIGN } from '@/theme';
import { ChemistrySection } from '@/components/chemistry/ChemistrySection';
import { he } from '@/i18n/he';
import type { CommunitiesStackParamList } from '@/navigation/CommunitiesStack';
import { mergeAllTime, type TableSlice } from '@/utils/allTimeTable';
import { mergePairs, type PairTotals } from '@/utils/clubChemistry';
import {
  seasonHistoryService,
  type FinishedSeason,
  type FinishedSeasonTable,
} from '@/services/seasonHistoryService';
import { clubChemistryService } from '@/services/clubChemistryService';
import type { GroupSeasons, User } from '@/types';

type Params = RouteProp<CommunitiesStackParamList, 'CommunityStats'>;

/** The running season, everything ever played, or one sealed season. */
type Scope = { k: 'current' } | { k: 'all' } | { k: 'season'; id: string };
type Resolved = Pick<User, 'id' | 'name' | 'avatarId' | 'photoUrl'>;

const MEDALS = ['#F4B73E', '#9AA4B2', '#CD7F32']; // gold / silver / bronze

interface ChampData {
  totalGoals: number;
  totalRounds: number;
  tiedRounds: number;
  shootoutRounds: number;
  scorelessRounds: number;
  guestGoals: number;
  ownGoals: number;
  players: ChampionshipRow[];
}
interface StatsData {
  totalFinished: number;
  organizationRate: number;
  avgAttendance: number;
  activeThisMonth: number;
  activeThisYear: number;
  longestStreak: number;
  longestStreakUid: string | null;
  // Most-loyal-by-attendance, from the SAME finished-nights scan as the streak
  // (so "הכי מתמיד" can never be smaller than "הרצף הארוך" — both count the
  // exact same attendance events, unlike the communityPlayerStats rollup which
  // can lag). topPlayers[0] = the player who attended the most nights.
  topPlayers: Array<{ uid: string; attended: number }>;
  /** The same scan, unscoped — what the club has done in its whole life.
   *  Badges, the club level and the "כל הזמנים" scope read from here. */
  lifetime: {
    totalFinished: number;
    totalCancelled: number;
    organizationRate: number;
    activeThisMonth: number;
    /** A year means a year. The season-scoped twin intersects the 365-day
     *  window with the season filter, so it reads a handful of days after a
     *  close while the label still says "השנה". */
    activeThisYear: number;
    /** The club's longest-ever run, and its holder. A record is permanent. */
    longestStreak: number;
    longestStreakUid: string | null;
  };
}
interface DeadlyDuo {
  uidA: string;
  uidB: string;
  assists: number;
}

/** FULL display name. The club board used to show first names only, which in
 *  a club with two Elirans said nothing about who actually leads (manager
 *  request). Rows are `numberOfLines={1}`, so a long name ellipsises rather
 *  than breaking the layout. */
function fullName(name: string): string {
  return (name || '').trim();
}
/** Highest-by-metric row, ignoring zeros. */
function leaderBy(
  players: ChampionshipRow[],
  pick: (r: ChampionshipRow) => number,
): ChampionshipRow | null {
  let best: ChampionshipRow | null = null;
  let bestV = 0;
  for (const p of players) {
    const v = pick(p);
    if (v > bestV) {
      bestV = v;
      best = p;
    }
  }
  return best;
}

export function CommunityStatsScreen() {
  const nav = useNavigation<{ navigate: (s: string, p?: unknown) => void }>();
  const { groupId } = useRoute<Params>().params;
  // Which season these numbers belong to, when the club runs them.
  //
  // Without this the table simply RESETS one day and says nothing: a member
  // opens the club, finds their goals gone, and has no way to learn that a
  // season closed. The numbers on this screen are the running season's — that
  // is what a season IS — so the screen has to say so.
  const [seasons, setSeasons] = useState<GroupSeasons | undefined>(undefined);
  // The seasons this club has already finished, and which one the screen is
  // currently showing.
  //
  // `null` is the running season — the live rows, which ARE that season. A
  // seasonId is one that ended, read out of its archive and never recomputed.
  // Without this the previous season becomes unreachable the moment it closes:
  // the hall of fame lists who won what and then has nothing behind it, and
  // the member who wants to know how many goals they finished on has to take
  // the trophy's word for it.
  const [pastSeasons, setPastSeasons] = useState<FinishedSeason[]>([]);
  // Whether the archive list has come back — successfully or not.
  //
  // An empty `pastSeasons` is a real answer for a club that has closed
  // nothing, and an unfinished fetch for a club that has. All-time cannot
  // tell the two apart without this flag, and summing it too early prints
  // the live rows alone as the club's lifetime — the exact number the
  // all-time scope exists to correct.
  const [pastLoaded, setPastLoaded] = useState(false);
  // The screen opened straight on all-time (a club that switched seasons
  // off). That slice needs one more round-trip than the live rows, and
  // until it lands every tile would read 0 — the exact number this default
  // exists to stop showing. So the loader stays up for it.
  const [openedOnAllTime, setOpenedOnAllTime] = useState(false);
  // Which slice of the club's history the whole screen is showing.
  //
  // A union, not a nullable id with a magic string for "all": a sentinel leaks
  // straight into the archive fetch and into the table's `seasonId`, and the
  // first thing it would do is ask Firestore for a season called "__all".
  const [scope, setScope] = useState<Scope>({ k: 'current' });
  const [archive, setArchive] = useState<FinishedSeasonTable | null>(null);
  /** Every past season, merged with the live rows. Fetched once, then cached —
   *  switching back and forth must not cost a read each time. */
  const [allTime, setAllTime] = useState<TableSlice | null>(null);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [champ, setChamp] = useState<ChampData | null>(null);
  const [stats, setStats] = useState<StatsData | null>(null);
  const [duo, setDuo] = useState<DeadlyDuo | null>(null);
  const [people, setPeople] = useState<Record<string, Resolved>>({});
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [attended, setAttended] = useState<Record<string, number>>({});
  const [subtitle, setSubtitle] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      // The club FIRST, because the evening scan has to know which season it
      // is counting. Everything else on this screen is already season-scoped
      // (the close zeroes communityStats and communityPlayerStats), and the
      // scan was not — so a brand-new season showed zero goals beside a
      // lifetime count of evenings, a lifetime organisation rate and a
      // lifetime streak. One extra document read is the price of the four
      // tiles agreeing with each other.
      const g = await groupService.get(groupId).catch(() => null);
      const scope =
        g?.seasons?.enabled && g.seasons.currentId
          ? { currentId: g.seasons.currentId, currentNo: g.seasons.currentNo ?? 1 }
          : undefined;
      const [c, s, d] = await Promise.all([
        gameService.getCommunityChampionship(groupId).catch(() => null),
        gameService.getCommunityStats(groupId, scope).catch(() => null),
        gameService.getCommunityDeadlyDuo(groupId).catch(() => null),
      ]);
      if (!alive) return;
      if (s) setAttended(s.attendedByUser ?? {});
      if (g) {
        setSubtitle(g.name);
        setSeasons(g.seasons);
        // Seasons switched OFF after the club had already closed one.
        //
        // Turning the feature off CLOSES the running season, and a close
        // zeroes communityStats/communityPlayerStats. So "the running season"
        // — the live rows this screen starts on — is no longer a season at
        // all: it is whatever has been played since the club stopped running
        // them, and on the morning it was switched off it is zero. Beside it
        // the evening scan is lifetime (it is season-scoped only while
        // `enabled`), so the screen opened on 22 מחזורים next to 0 גולים,
        // 0 בישולים and 0 משחקים.
        //
        // For a club that no longer runs seasons the club's record IS the
        // all-time slice, so that is where the screen opens. The other scopes
        // stay in the picker; nothing is hidden.
        if (g.seasons && !g.seasons.enabled && (g.seasons.count ?? 0) > 0) {
          setScope({ k: 'all' });
          setOpenedOnAllTime(true);
        }
        // Only for a club that has actually closed a season; everyone else
        // pays nothing.
        if ((g.seasons?.count ?? 0) > 0) {
          // One read of the cards feeds the season picker. (It used to also
          // answer the badges' lifetime goal total; the badges now live on
          // CommunityDetails and read their own copy.)
          seasonHistoryService
            .list(groupId)
            .then((list) => {
              if (!alive) return;
              // 'error' is NOT an empty archive — leave the list alone and let
              // the all-time slice refuse to sum a history it cannot see.
              if (list !== 'error') setPastSeasons(list);
              setPastLoaded(true);
            })
            .catch(() => {
              if (alive) setPastLoaded(true);
            });
        } else {
          setPastLoaded(true);
        }
        setMemberIds(g.playerIds ?? []);
      }
      setChamp(
        c ?? {
          totalGoals: 0,
          totalRounds: 0,
          tiedRounds: 0,
          shootoutRounds: 0,
          scorelessRounds: 0,
          guestGoals: 0,
          ownGoals: 0,
          players: [],
        },
      );
      setStats(
        s ?? {
          lifetime: {
            totalFinished: 0,
            totalCancelled: 0,
            organizationRate: 0,
            activeThisMonth: 0,
            activeThisYear: 0,
            longestStreak: 0,
            longestStreakUid: null,
          },
          totalFinished: 0,
          organizationRate: 0,
          avgAttendance: 0,
          activeThisMonth: 0,
          activeThisYear: 0,
          longestStreak: 0,
          longestStreakUid: null,
          topPlayers: [],
        },
      );
      setDuo(d);
      // Resolve the players we'll actually show (top scorers + any leader +
      // the deadly duo + the longest-streak holder).
      const ids = new Set<string>();
      (c?.players ?? []).slice(0, 10).forEach((r) => ids.add(r.uid));
      (c?.players ?? []).forEach((r) => {
        if (
          r.assists > 0 || r.wins > 0 || r.games > 0 ||
          r.penScored > 0 || r.penSaved > 0 || r.ownGoals > 0
        )
          ids.add(r.uid);
      });
      if (d) { ids.add(d.uidA); ids.add(d.uidB); }
      // BOTH, because the row renders the LIFETIME holder and the prefetch
      // only ever asked for the season-scoped one — so on exactly the clubs
      // the lifetime switch was written for, the club's own record rendered
      // "— הגיע 22 מחזורים ברצף", with no name on it.
      if (s?.longestStreakUid) ids.add(s.longestStreakUid);
      if (s?.lifetime?.longestStreakUid) ids.add(s.lifetime.longestStreakUid);
      if (s?.topPlayers?.[0]?.uid) ids.add(s.topPlayers[0].uid);
      const fetched = await Promise.all(
        Array.from(ids).map((id) => userService.getUserById(id).catch(() => null)),
      );
      if (!alive) return;
      const map: Record<string, Resolved> = {};
      fetched.forEach((u) => {
        if (u) map[u.id] = u;
      });
      setPeople(map);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [groupId]);

  // Fetch a past season's archive the first time it is picked, and keep the
  // live numbers untouched underneath — switching back is free.
  useEffect(() => {
    if (scope.k === 'current') {
      setArchive(null);
      return;
    }
    let alive = true;
    setArchiveBusy(true);

    // All-time cannot be summed before the list of closed seasons is in. This
    // matters now that all-time is where a seasons-off club OPENS: the list is
    // still in flight on that first paint, and summing an empty archive would
    // show the live rows — the post-close remainder — labelled "כל הזמנים".
    // Stay on the loading line; the effect re-runs when the list lands.
    if (scope.k === 'all' && !pastLoaded) {
      return () => {
        alive = false;
      };
    }

    // All-time is the live rows PLUS every archive. Nothing recomputes: the
    // archives are the sealed record of the seasons they closed, so this is
    // addition over numbers that were already agreed.
    const load =
      scope.k === 'all'
        ? Promise.all([
            ...pastSeasons.map((ps) => seasonHistoryService.table(groupId, ps.seasonId)),
            // The live pair documents, for the chemistry sum only — the table
            // above already has the live rows from `champ`. Fetched here rather
            // than lifted to the screen so the running-season tab keeps letting
            // ChemistrySection fetch its own, `chemistrySince` included: that
            // tab prints "מאז <date>" and the sum has no single such date.
            clubChemistryService
              .get(groupId)
              .then((c) => c.pairs)
              .catch(() => ({}) as Record<string, PairTotals>),
          ]).then((results) => {
            const livePairs = results.pop() as Record<string, PairTotals>;
            const archives = results as Array<FinishedSeasonTable | null>;
            if (archives.some((a) => !a)) return null; // a gap would understate
            // The list itself failed to load (it returns 'error', never []),
            // so the club's closed seasons are missing from the sum. Same
            // answer as a missing archive: refuse, do not understate.
            if ((seasons?.count ?? 0) > 0 && pastSeasons.length === 0) return null;
            const live: TableSlice = {
              totalGoals: champ?.totalGoals ?? 0,
              totalRounds: champ?.totalRounds ?? 0,
              tiedRounds: champ?.tiedRounds ?? 0,
              shootoutRounds: champ?.shootoutRounds ?? 0,
              scorelessRounds: champ?.scorelessRounds ?? 0,
              guestGoals: champ?.guestGoals ?? 0,
              ownGoals: champ?.ownGoals ?? 0,
              players: champ?.players ?? [],
            };
            const merged = mergeAllTime([live, ...(archives as FinishedSeasonTable[])]);
            // Chemistry across every season, summed the same way the table is.
            // The live rows hold the RUNNING season only — a close zeroes them
            // — so all-time chemistry is the live window plus each sealed one,
            // and it exists nowhere as a stored number.
            return {
              ...merged,
              pairs: (archives as FinishedSeasonTable[]).reduce(
                (acc, a) => mergePairs(acc, a.pairs ?? {}),
                livePairs,
              ),
            };
          })
        : seasonHistoryService.table(groupId, scope.id);

    void load
      .then((t) => {
        if (!alive) return;
        setArchiveBusy(false);
        if (!t) {
          // A slice that will not load is not an empty one. Showing the live
          // rows under another heading would be worse than any message, so the
          // screen returns to the running season.
          setScope({ k: 'current' });
          return;
        }
        if (scope.k === 'all') setAllTime(t as TableSlice);
        else setArchive(t as FinishedSeasonTable);
      })
      .catch(() => {
        if (!alive) return;
        setArchiveBusy(false);
        setScope({ k: 'current' });
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, scope, pastSeasons, pastLoaded, seasons, champ]);

  /** The card of the season on screen, for its evening count and its dates. */
  const scopedCard = useMemo(
    () =>
      scope.k === 'season'
        ? (pastSeasons.find((x) => x.seasonId === scope.id) ?? null)
        : null,
    [scope, pastSeasons],
  );

  // Everything below reads ONE of these, never `champ`/`duo` directly: the
  // screen renders a past season through the same derivation as the running
  // one, because the archive was built to hold exactly the same counters.
  // `scope` flips the instant the chip is tapped; `archive` only arrives a
  // network round-trip later. Deriving from `champ` in that gap printed the
  // RUNNING season's numbers — its top scorer, its tiles, its whole table —
  // under a heading that already said "עונה 1". Nothing marked them as stale,
  // so they simply read as that season's record.
  const slice: TableSlice | null =
    scope.k === 'all' ? allTime : scope.k === 'season' ? archive : null;
  const scopeLoading = scope.k !== 'current' && !slice;
  const viewChamp: ChampData | null = useMemo(
    () =>
      scopeLoading
        ? null
        : slice
        ? {
            totalGoals: slice.totalGoals,
            totalRounds: slice.totalRounds,
            tiedRounds: slice.tiedRounds,
            shootoutRounds: slice.shootoutRounds,
            scorelessRounds: slice.scorelessRounds,
            guestGoals: slice.guestGoals,
            ownGoals: slice.ownGoals,
            players: slice.players,
          }
        : champ,
    [slice, champ, scopeLoading],
  );
  // The all-time duo is left to "כימיה במועדון", which now covers every scope
  // and names the same pair under הצמד הקטלני. Printing it here as well would
  // put one fact on one screen twice — and the fun-facts row is the weaker of
  // the two, having no card behind it.
  const viewDuo =
    scope.k === 'current' ? duo : scope.k === 'season' ? (archive?.duo ?? null) : null;

  /**
   * The pairs "כימיה במועדון" describes in the scope on screen.
   *
   *   current  undefined → the section fetches the live documents itself
   *   season   the sealed pairs of that season
   *   all      every season summed, live included
   *
   * `null` while a scope's data is in flight, never the live pairs: the table
   * has already been caught showing the running season under a closed
   * season's heading, and chemistry would do it with people's names on it.
   */
  const chemistryPairs: Record<string, PairTotals> | null | undefined =
    scope.k === 'current'
      ? undefined
      : scope.k === 'season'
        ? (archive?.pairs ?? null)
        : ((allTime as TableSlice & { pairs?: Record<string, PairTotals> })?.pairs ?? null);

  const derived = useMemo(() => {
    const players = viewChamp?.players ?? [];
    const totalAssists = players.reduce((a, p) => a + p.assists, 0);
    const totalWins = players.reduce((a, p) => a + p.wins, 0);
    const totalGoals = viewChamp?.totalGoals ?? 0;
    const totalRounds = viewChamp?.totalRounds ?? 0;
    const tiedRounds = viewChamp?.tiedRounds ?? 0;
    const shootoutRounds = viewChamp?.shootoutRounds ?? 0;
    const scorelessRounds = viewChamp?.scorelessRounds ?? 0;
    // Goals scored by guests across the club — a separate breakout, NOT folded
    // into totalGoals (which is real ranked players only). Drives its own row.
    const guestGoals = viewChamp?.guestGoals ?? 0;
    const goalsPerMini = totalRounds > 0 ? totalGoals / totalRounds : 0;
    const drawPct = totalRounds > 0 ? Math.round((tiedRounds / totalRounds) * 100) : 0;
    const shootoutPct =
      totalRounds > 0 ? Math.round((shootoutRounds / totalRounds) * 100) : 0;
    const scorelessPct =
      totalRounds > 0 ? Math.round((scorelessRounds / totalRounds) * 100) : 0;
    // Club-wide penalty conversion — sum every player's scored/taken. Drives
    // the "דיוק מהנקודה הלבנה" fun fact. Gated on penTakenTotal > 0.
    const penTakenTotal = players.reduce((a, p) => a + (p.penTaken ?? 0), 0);
    const penScoredTotal = players.reduce((a, p) => a + (p.penScored ?? 0), 0);
    const penAccuracyPct = pctOf(penScoredTotal, penTakenTotal);
    // `players` is ranked by POINTS (goals*2+assists), so players[0] is NOT
    // necessarily the top scorer — pick the max-goals player explicitly.
    const topScorer = players.length
      ? players.reduce((best, p) => (p.goals > best.goals ? p : best))
      : null;
    // Share of goals that came off an assist — each assisted goal carries exactly
    // one assist, so assists ÷ goals is the assisted-goal rate. Capped at 100%
    // defensively. Uses the reliable per-player assist totals (not the partial
    // communityPairStats), so it's accurate for historical goals too.
    const assistedGoalsPct =
      totalGoals > 0 ? Math.min(100, Math.round((totalAssists / totalGoals) * 100)) : 0;
    return {
      players,
      totalGoals,
      totalRounds,
      tiedRounds,
      drawPct,
      shootoutRounds,
      shootoutPct,
      scorelessRounds,
      scorelessPct,
      guestGoals,
      // Own goals — club total (for the fun fact) + the player who scored the
      // most (a dubious crown). null when nobody has an own goal yet.
      totalOwnGoals: viewChamp?.ownGoals ?? 0,
      ownGoalKing: leaderBy(players, (p) => p.ownGoals),
      penTakenTotal,
      penAccuracyPct,
      totalAssists,
      totalWins,
      goalsPerMini,
      assistedGoalsPct,
      topScorer,
      topAssister: leaderBy(players, (p) => p.assists),
      topWinner: leaderBy(players, (p) => p.wins),
      // The defensive crown — most mini-games finished without conceding.
      // null until somebody has one, like every other leader here.
      cleanSheetKing: leaderBy(players, (p) => p.cleanSheets),
      // Penalty leaders — tested derivation (tie-break on success%, then
      // attempts, then uid). null when nobody has scored/saved a penalty yet.
      penaltyKing: penaltyKing(
        players.map((p) => ({ userId: p.uid, penScored: p.penScored, penTaken: p.penTaken })),
      ),
      penaltyKeeperKing: penaltyKeeperKing(
        players.map((p) => ({ userId: p.uid, penSaved: p.penSaved, penFaced: p.penFaced })),
      ),
    };
  }, [viewChamp]);

  // "הכי מתמיד" = most nights attended, taken from the finished-nights scan in
  // getCommunityStats (topPlayers[0]) — NOT the communityPlayerStats `games`
  // rollup, which can lag behind and produced the "4 vs 5-in-a-row" mismatch
  // (a streak can never exceed total attendance when both share a source).
  const mostLoyal = useMemo(() => {
    // A season that is over has no nights left to scan — the games were
    // archived with it. Its `games` column is that exact count, frozen, and it
    // is the number the season's "הכי מתמיד" title was awarded on. All-time
    // sums the same column across every season.
    if (scope.k !== 'current') {
      if (!slice) return null;
      const top = leaderBy(slice.players, (r) => r.games);
      return top ? { uid: top.uid, nights: top.games } : null;
    }
    const top = stats?.topPlayers?.[0];
    return top && top.attended > 0 ? { uid: top.uid, nights: top.attended } : null;
  }, [stats, slice, scope]);

  // The club's BADGES used to be derived here and rendered at the bottom of
  // this screen. They now live on CommunityDetails, under "נתוני מועדון"
  // (owner request via Eliran, 1.1.9) — see ClubAchievementsCard.
  //
  // The club LEVEL did not move with them: it was computed here and never
  // rendered anywhere, on this screen or any other, so `computeClubLevel`
  // (src/utils/clubLevel.ts) now has no caller at all. Left in place rather
  // than deleted — reviving it is a product decision, not a cleanup — but do
  // not read the line above as "the level is on the club page now".

  // Names, with the season's frozen copy as the fallback.
  //
  // /users is still preferred while it answers — an avatar and a changed name
  // are both nicer than a two-month-old string. But a player who has since
  // deleted their account or left the club resolves to nothing there, and a
  // sealed season has to stay readable: the archive kept their name for
  // exactly this.
  const name = (uid?: string) => {
    if (!uid) return '—';
    const live = people[uid] ? fullName(people[uid].name) : '';
    return live || slice?.names?.[uid] || '—';
  };
  const resolved = (uid: string): Resolved =>
    people[uid] ?? { id: uid, name: slice?.names?.[uid] ?? '' };

  // The first paint is not finished until the slice the screen OPENED on is
  // in hand. Resolves either way: the all-time load that fails puts the scope
  // back on the live rows, and the condition falls with it.
  const bootLoading = loading || (openedOnAllTime && scope.k === 'all' && !allTime);

  /**
   * Is the scope on screen the club's WHOLE LIFE?
   *
   * Two rows of "נתונים מעניינים" print a lifetime figure — the organisation
   * rate ("מכל המחזורים שתוכננו במועדון אי פעם") and the longest attendance
   * streak ("הרצף הארוך של המועדון אי פעם"). Reported, with the streak circled
   * in red: "נתון של רצף הגעה למחזורים שהוא כללי אמור להיות בכל הזמנים ולא
   * בעונה הספציפית" — on a screen headed עונה 2 that read 0 מחזורים, 0
   * משחקים, and then "מתן לוי הגיע 22 מחזורים ברצף".
   *
   * `scope.k !== 'season'` does not answer that: the running season is the
   * specific season he was looking at, and it is the only scope that screen
   * had selected. Saying "אי פעם" inside the sentence is not enough either —
   * that wording was already there.
   *
   * The live rows stop being the club's lifetime at the first CLOSE, because
   * the close is what zeroes them — and that same close is what puts the
   * "כל הזמנים" chip on screen to receive these rows. So: before it, the
   * running season IS all of the club's history and the rows stay put (a club
   * that never ran a season would otherwise lose them entirely, with no chip
   * anywhere to find them under); after it, they belong to all-time alone.
   */
  const lifetimeScope = scope.k === 'all' || (seasons?.count ?? 0) === 0;

  const isEmpty =
    !loading &&
    // NEVER while a past season is selected. The empty state replaces the
    // whole scroll view — including the season picker — so a club whose
    // archive is still loading, or whose chosen season really was empty, would
    // land on a dead end with no way back to the running season.
    scope.k === 'current' &&
    // NOR while the club has seasons in its archive. Scoping the evening scan
    // to the running season made this state reachable for the first time: a
    // club whose new season has not had an evening yet now genuinely counts
    // zero, and the empty view swallowed the very picker that leads to the
    // seasons it DOES have. "עדיין אין נתונים" is true of tonight and false of
    // the club.
    (seasons?.count ?? 0) === 0 &&
    derived.totalGoals === 0 &&
    (stats?.totalFinished ?? 0) === 0 &&
    derived.players.length === 0;

  /**
   * Evenings (מחזורים) the club HELD in the scope on screen.
   *
   * The same number the "מחזורים" tile prints, and now also the denominator of
   * the club table's attendance column — one expression, so the column can
   * never disagree with the tile directly above it. Each scope keeps its own
   * source: a sealed season's length off its card, all-time off the UNSCOPED
   * evening scan, and the running season off the scoped one.
   *
   * Undefined, not 0, while the scan has not landed: the table treats a
   * missing denominator as "nothing to divide by" and hides the column,
   * whereas a 0 would look like a club that has never played.
   */
  const eveningsInScope = useMemo((): number | undefined => {
    if (scopedCard) return scopedCard.completedRounds;
    if (!stats) return undefined;
    return scope.k === 'all'
      ? (stats.lifetime?.totalFinished ?? 0)
      : stats.totalFinished;
  }, [scopedCard, scope, stats]);

  // Leaders/goal-based tiles only make sense once goals have been recorded —
  // otherwise every card is a "—". A club with finished evenings but no scoring
  // still shows the attendance/evenings tiles + achievements, just not leaders.
  const hasScoring = derived.totalGoals > 0 && derived.players.length > 0;

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScreenHeader title={he.communityStatsScreenTitle} subtitle={subtitle || undefined} />

      {bootLoading ? (
        <View style={styles.center}>
          <SoccerBallLoader />
          <Text style={styles.loadingText}>{he.communityStatsLoading}</Text>
        </View>
      ) : isEmpty ? (
        <EmptyState
          icon="stats-chart-outline"
          title={he.communityStatsEmptyTitle}
          hint={he.communityStatsEmptyBody}
        />
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
        >
          {/* בורר התצוגה. מופיע לכל מועדון שמנהל עונות — גם לפני שנסגרה
              עונה ראשונה, כי בלעדיו אי אפשר לדעת שהמספרים על המסך הם של
              העונה ולא של כל הזמנים. זו בדיוק השאלה שנשאלה. */}
          {/* Shown whenever there is more than one thing to look at — a running
              season, or an archive. Gating it on `enabled` alone meant a club
              that turned seasons OFF after a close saw a table of zeros (the
              close had emptied it) with no route to "כל הזמנים" and no route
              to its own archived seasons. It read as though the club had been
              wiped. */}
          {seasons?.enabled || (seasons?.count ?? 0) > 0 ? (
            <>
              {/* A picker needs something to pick. Before the club's first
                  close there is exactly one scope, and the row was a label
                  followed by a single chip that was always already selected.
                  Gated on the CLOSED COUNT, not on pastSeasons.length, so the
                  row does not pop in when the archive finishes loading.
                  The banner below still says the numbers belong to a season —
                  that was this row's other job, and it keeps doing it. */}
              {(seasons?.count ?? 0) > 0 ? (
              <View style={styles.scopeRow}>
                <Text style={styles.scopeLabel}>{he.communityStatsScopeLabel}</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.scopeChips}
                >
                  {/* העונה הרצה ראשונה — היא ברירת המחדל, וב-RTL היא נופלת
                      הכי ימינה, שם העין מתחילה. */}
                  {/* למועדון שכיבה את העונות זו כבר לא עונה: הכיבוי סגר את
                      הרצה, ומה שנשאר בשורות החיות הוא כל מה ששוחק מאז אותה
                      סגירה. השבב אומר בדיוק את זה, במקום "עונה 4 · עכשיו"
                      על עונה שמעולם לא רצה. */}
                  <ScopeChip
                    text={
                      seasons && !seasons.enabled && (seasons.count ?? 0) > 0
                        ? he.communityStatsScopeSinceOff(seasons.count ?? 1)
                        : he.communityStatsScopeCurrent(seasons?.currentNo ?? 1)
                    }
                    active={scope.k === 'current'}
                    onPress={() => setScope({ k: 'current' })}
                  />
                  {/* כל הזמנים = השורות החיות ועוד כל עונה שנסגרה. אחרי
                      הסגירה הראשונה זה המקום היחיד שעונה על "כמה שערים
                      הבקעתי במועדון הזה אי פעם".
                      Only once there IS a closed season to add. Offered to a
                      club with none, it was a chip identical to the one beside
                      it whose note read "0 העונות שנסגרו". */}
                  {pastSeasons.length > 0 ? (
                    <ScopeChip
                      text={he.communityStatsScopeAllTime}
                      active={scope.k === 'all'}
                      onPress={() => setScope({ k: 'all' })}
                    />
                  ) : null}
                  {pastSeasons.map((ps) => (
                    <ScopeChip
                      key={ps.seasonId}
                      text={he.communityStatsScopePast(ps.no)}
                      active={scope.k === 'season' && scope.id === ps.seasonId}
                      onPress={() => setScope({ k: 'season', id: ps.seasonId })}
                    />
                  ))}
                </ScrollView>
              </View>
              ) : null}
              {/* The table below belongs to ONE season. Said out loud, because
                  otherwise the numbers reset one day with no explanation.
                  BELOW the picker, not above it: this block renders only for
                  the running season, so while it sat on top the chips jumped
                  up two lines the moment you tapped a past season — the row
                  you were aiming at moved out from under your finger. Under
                  the picker every scope has exactly one explanatory line in
                  exactly one place. */}
              {seasons?.enabled && scope.k === 'current' ? (
                <Pressable
                  style={styles.seasonBanner}
                  onPress={() =>
                    (seasons.count ?? 0) > 0
                      ? nav.navigate('SeasonHistory', { groupId })
                      : undefined
                  }
                  accessibilityRole={(seasons.count ?? 0) > 0 ? 'button' : 'text'}
                >
                  <Text style={styles.seasonBannerText}>
                    {/* A club whose new season has no goals yet is not an empty
                        club — it is a club between seasons, and that is a very
                        different sentence. Half this screen (the top scorer, the
                        leaders, the donuts, the duo, eight fun facts) is gated on
                        `> 0` and goes dark in one paint on the first evening after
                        a close; without this the ten-year member reads it as
                        "מחקו לי הכל". */}
                    {(seasons.count ?? 0) > 0 && !hasScoring
                      ? he.communityStatsSeasonFresh(seasons.currentNo ?? 1)
                      : he.communityStatsSeasonBanner(seasons.currentNo ?? 1)}
                  </Text>
                  {(seasons.count ?? 0) > 0 ? (
                    <Text style={styles.seasonBannerLink}>
                      {!hasScoring
                        ? he.communityStatsSeasonFreshCta
                        : he.seasonHistoryCta}
                    </Text>
                  ) : null}
                </Pressable>
              ) : null}
              {scope.k === 'all' ? (
                <Text style={styles.scopeNote}>
                  {archiveBusy
                    ? he.communityStatsScopeLoading
                    : seasons && !seasons.enabled
                      ? he.communityStatsScopeAllTimeNoteOff(pastSeasons.length)
                      : he.communityStatsScopeAllTimeNote(pastSeasons.length)}
                </Text>
              ) : null}
              {scopedCard ? (
                <View style={styles.scopeNoteRow}>
                <Text style={styles.scopeNote}>
                  {archiveBusy
                    ? he.communityStatsScopeLoading
                    : he.communityStatsScopeClosedNote(
                        scopedCard.no,
                        new Date(scopedCard.endsAt).toLocaleDateString('he-IL', {
                          day: 'numeric',
                          month: 'long',
                          year: 'numeric',
                        }),
                      )}
                </Text>
                {/* The half that explains what is NOT here. It used to be
                    three more lines of the same permanent paragraph. */}
                {!archiveBusy ? (
                  <InfoTip text={he.communityStatsScopeClosedInfo} />
                ) : null}
                </View>
              ) : null}
              {/* The club's table for a finished season is right here, and the
                  reader's own season is one tap away — but only for a season
                  that ENDED. There is nothing to summarise about the one being
                  played, and the scope chip already says which is on screen. */}
              {scopedCard ? (
                <Button
                  title={he.seasonsMySummaryOfCta(scopedCard.no)}
                  variant="outline"
                  fullWidth
                  onPress={() =>
                    nav.navigate('SeasonSummary', {
                      groupId,
                      seasonId: scopedCard.seasonId,
                    })
                  }
                />
              ) : null}
            </>
          ) : null}

          {/* NO hero card for מלך השערים.
              It sat above "המועדון במספרים" as a wide card with a star ribbon
              and a 64px avatar, which made one of the eight club titles look
              like a different KIND of thing from the seven listed below it.
              It is not: it is the goals column's leader, exactly as מלך
              הבישולים is the assists column's. It is now the first row of
              מובילי המועדון, where it is compared with its peers instead of
              being staged above them. (Owner, 22.09.) */}
          {/* ── המועדון במספרים (4) ── */}
          <SectionTitle icon="bar-chart" text={he.communityStatsSectionNumbers} />
          <View style={styles.heroGrid}>
            <HeroTile icon={<MaterialCommunityIcons name="soccer" size={24} color={colors.primary} />} tint={colors.primary} value={derived.totalGoals} label={he.communityStatsGoals} />
            <HeroTile icon={<MaterialCommunityIcons name="shoe-cleat" size={24} color="#7C3AED" />} tint="#7C3AED" value={derived.totalAssists} label={he.communityStatsAssists} />
            <HeroTile icon={<MaterialCommunityIcons name="soccer-field" size={24} color="#0EA5E9" />} tint="#0EA5E9" value={derived.totalRounds} label={he.communityStatsMiniGames} />
            <HeroTile icon={<MaterialCommunityIcons name="calendar-month" size={24} color={colors.success} />} tint={colors.success} value={eveningsInScope ?? 0} label={he.communityStatsEvenings} />
          </View>

          {/* ── מובילי המועדון ── (only once goals exist; else all "—") */}
          {hasScoring ? (
          <>
          <SectionTitle icon="trophy" text={he.communityStatsSectionLeaders} />
          {/* All eight titles, one list, right-aligned: avatar on the right,
              category + name, animated value on the left. מלך השערים leads it
              — goals before assists, the order the club table itself sorts by. */}
          <Card style={styles.leadersCard}>
            {(
              [
                derived.topScorer && {
                  title: he.communityStatsTopScorer,
                  uid: derived.topScorer.uid,
                  value: derived.topScorer.goals,
                  unit: 'שערים',
                  tint: colors.primary,
                },
                derived.topAssister && {
                  title: he.communityStatsTopAssister,
                  uid: derived.topAssister.uid,
                  value: derived.topAssister.assists,
                  unit: 'בישולים',
                  tint: '#7C3AED',
                },
                derived.topWinner && {
                  title: he.communityStatsTopWinner,
                  uid: derived.topWinner.uid,
                  value: derived.topWinner.wins,
                  unit: 'נצחונות',
                  tint: colors.warning,
                },
                derived.cleanSheetKing && {
                  title: he.communityStatsCleanSheetKing,
                  uid: derived.cleanSheetKing.uid,
                  value: derived.cleanSheetKing.cleanSheets,
                  unit: 'שערים נקיים',
                  tint: colors.info,
                },
                mostLoyal && {
                  title: he.communityStatsMostLoyal,
                  uid: mostLoyal.uid,
                  value: mostLoyal.nights,
                  unit: 'ערבים',
                  tint: colors.success,
                },
                derived.penaltyKing && {
                  title: he.communityStatsPenaltyKing,
                  uid: derived.penaltyKing.userId,
                  // Headline the CONVERSION RATE (8% of 1000 ≠ 80% of 5). The raw
                  // "scored / attempts" sits below as the ratio.
                  value: derived.penaltyKing.pct,
                  suffix: '%',
                  unit: `${derived.penaltyKing.count}/${derived.penaltyKing.attempts}`,
                  tint: '#EF4444',
                },
                derived.penaltyKeeperKing && {
                  title: he.communityStatsPenaltyKeeperKing,
                  uid: derived.penaltyKeeperKing.userId,
                  value: derived.penaltyKeeperKing.pct,
                  suffix: '%',
                  unit: `${derived.penaltyKeeperKing.count}/${derived.penaltyKeeperKing.attempts}`,
                  tint: '#16A34A',
                },
                // The dubious crown — most own goals. Only when someone has one.
                derived.ownGoalKing && {
                  title: he.communityStatsOwnGoalKing,
                  uid: derived.ownGoalKing.uid,
                  value: derived.ownGoalKing.ownGoals,
                  unit: 'עצמיים',
                  tint: '#F59E0B',
                },
              ].filter(Boolean) as {
                title: string;
                uid: string;
                value: number;
                unit: string;
                tint: string;
                suffix?: string;
              }[]
            ).map((r, i, arr) => (
              <LeaderRow
                key={r.title}
                title={r.title}
                user={resolved(r.uid)}
                value={r.value}
                unit={r.unit}
                suffix={r.suffix}
                tint={r.tint}
                index={i}
                last={i === arr.length - 1}
              />
            ))}
          </Card>
          </>
          ) : null}

          {/* ── כימיה במועדון ── */}
          {/* After the leaders and before the fun facts: the leaders are about
              individuals, this is about who they play WITH, and the fun facts
              are club-wide. It reads in that order. */}
          {/* Every scope, not just the running season. The live pair documents
              are zeroed by a season close, so they describe the RUNNING season
              and nothing else — which is why a closed season showed no
              chemistry and all-time had none to show. A closed season's pairs
              were sealed into its archive all along and simply went unread;
              all-time is those archives plus the live window, summed.

              The all-time note is not decoration: these counters begin at the
              club's FIRST SEASON CLOSE, because before seasons existed nothing
              kept a per-pair record. Without the line, "כל הזמנים" claims a
              history it does not have. */}
          {scopeLoading ? null : (
            <>
              <SectionTitle icon="people" text={he.chemistrySection} />
              {lifetimeScope && (seasons?.count ?? 0) > 0 ? (
                <Text style={styles.chemistryNote}>{he.chemistryAllTimeNote}</Text>
              ) : null}
              <ChemistrySection groupId={groupId} pairs={chemistryPairs} />
            </>
          )}

          {/* ── נתונים מעניינים (מעל הטבלה — בקשת אלירן) ── */}
          <SectionTitle icon="sparkles" text={he.communityStatsSectionFun} />
          <Card style={styles.funCard}>
            {/* חלק המלך מוצג למעלה באריח "המצטיין". האחוזים כאן = דונאטים מונפשים. */}
            {derived.totalGoals > 0 && derived.totalAssists > 0 ? (
              <FunDonutRow index={0} pct={derived.assistedGoalsPct} tint="#7C3AED"
                text="מהגולים במועדון הגיעו אחרי בישול — כדורגל של עבודת צוות" />
            ) : null}
            {derived.penTakenTotal > 0 ? (
              <FunDonutRow index={1} pct={derived.penAccuracyPct} tint={colors.success}
                text="מהפנדלים במועדון הסתיימו בגול" />
            ) : null}
            {derived.totalRounds > 0 && derived.drawPct > 0 ? (
              <FunDonutRow index={2} pct={derived.drawPct} tint={colors.info}
                text="מהמשחקים הסתיימו בתיקו" />
            ) : null}
            {derived.scorelessRounds > 0 ? (
              <FunDonutRow index={3} pct={derived.scorelessPct} tint={colors.textMuted}
                text="מהמשחקים הסתיימו 0:0" />
            ) : null}
            {derived.shootoutRounds > 0 ? (
              <FunDonutRow index={4} pct={derived.shootoutPct} tint={colors.danger}
                text="מהמשחקים הוכרעו בפנדלים" />
            ) : null}
            {/* אחוז ההתארגנות נספר מסריקת המשחקים של המועדון, לא ממונה
                שהעונה שומרת — ולכן אין לו תשובה לעונה שנסגרה.
                LIFETIME, and gated on there being something to measure.
                It read `stats.organizationRate`, the season-scoped figure, and
                was the only donut here gated on the SCOPE instead of on its own
                value — so a club three days into a new season was told, in
                green, that 0% of its planned evenings had happened. That club
                had never cancelled an evening in its life: its real rate was
                96%, sitting unused in `lifetime` ten lines away. "No attempts
                yet" and "every attempt failed" are the same number, and this
                was rendering the second meaning. */}
            {/* Shown under "כל הזמנים", which is where a lifetime number
                belongs — and, before the club's first close, under the running
                season as well, because until then the two are the same thing.
                See `lifetimeScope`. It also stops the seasons-off club, which
                now OPENS on all-time, from losing its organisation rate. */}
            {lifetimeScope &&
            (stats?.lifetime?.totalFinished ?? 0) +
              (stats?.lifetime?.totalCancelled ?? 0) >
              0 ? (
              <FunDonutRow index={5} pct={Math.round((stats?.lifetime?.organizationRate ?? 0) * 100)}
                tint={colors.success} text="מכל המחזורים שתוכננו במועדון אי פעם יצאו לפועל" />
            ) : null}
            {/* עובדות טקסט (בלי אחוז) */}
            {viewDuo && viewDuo.assists > 0 ? (
              <FunRow
                icon="git-network-outline"
                tint="#7C3AED"
                parts={[
                  { t: name(viewDuo.uidA), em: 'name' },
                  { t: ' ו' },
                  { t: name(viewDuo.uidB), em: 'name' },
                  { t: ' הם הצמד עם הכי הרבה בישולים משותפים (' },
                  { t: `${viewDuo.assists}`, em: 'num' },
                  { t: ')' },
                ]}
              />
            ) : null}
            {/* The club's longest-ever run — a RECORD, so it is read from
                `lifetime` and not from the season rollup; reading the scoped
                figure made a club's 22-night record vanish from the app the
                morning after every close.

                Being a lifetime number is also why it is gated on
                `lifetimeScope` rather than on the scope alone: a record
                printed under a season that shows 0 מחזורים is the report this
                gate comes from. ("פעילים השנה", below, is the one row here
                still shown under a season — its scope is a 365-day window,
                which is neither the season nor the club's life, and it says
                "השנה" out loud.) */}
            {lifetimeScope && stats && (stats.lifetime?.longestStreak ?? stats.longestStreak) >= 2 ? (
              <FunRow
                icon="flame-outline"
                tint={colors.danger}
                parts={[
                  { t: name(stats.lifetime?.longestStreakUid ?? stats.longestStreakUid ?? undefined), em: 'name' },
                  { t: ' הגיע ' },
                  { t: `${stats.lifetime?.longestStreak ?? stats.longestStreak} מחזורים`, em: 'num' },
                  { t: ' ברצף — הרצף הארוך של המועדון אי פעם' },
                ]}
              />
            ) : null}
            {/* "פעילים השנה" נמדד מול היום, לא מול העונה — למחזור שנסגר
                לפני חצי שנה זו לא תשובה. במקום זה: כמה שחקנים בכלל שיחקו
                בעונה, מתוך השורות החתומות שלה. */}
            {scope.k !== 'current' ? (
              <FunRow
                icon="calendar-outline"
                tint={colors.primary}
                parts={[
                  { t: `${derived.players.length} שחקנים`, em: 'num' },
                  { t: scope.k === 'all' ? ' שיחקו במועדון' : ' שיחקו בעונה' },
                ]}
                last={!(derived.guestGoals > 0) && !(derived.totalOwnGoals > 0)}
              />
            ) : (
              <FunRow
                icon="calendar-outline"
                tint={colors.primary}
                parts={[
                  // LIFETIME. `activeThisYear` is a 365-day window INTERSECTED
                  // with the season filter, so the morning after a close it is
                  // a 365-day label on a several-day window: a club whose
                  // entire roster played this month read "0 שחקנים היו פעילים
                  // השנה". Every other row in this card carries the season
                  // banner above it to say what it is scoped to; the word
                  // "השנה" is the only scope this one declares, so it has to
                  // be true.
                  { t: `${stats?.lifetime?.activeThisYear ?? stats?.activeThisYear ?? 0} שחקנים`, em: 'num' },
                  { t: ' היו פעילים השנה' },
                ]}
                last={!(derived.guestGoals > 0) && !(derived.totalOwnGoals > 0)}
              />
            )}
            {/* גולים של אורחים — שורה נפרדת (רק אם קיים נתון). אורחים אינם
                בטבלה המדורגת, אז זו הדרך היחידה שהתרומה שלהם נספרת גלוי. */}
            {derived.guestGoals > 0 ? (
              <FunRow
                icon="people-outline"
                tint={colors.info}
                parts={[
                  { t: `${derived.guestGoals} גולים`, em: 'num' },
                  { t: ' הוכנסו על ידי אורחים' },
                ]}
                last={!(derived.totalOwnGoals > 0)}
              />
            ) : null}
            {/* שערים עצמיים — סה"כ במועדון (רק אם קיים נתון). */}
            {derived.totalOwnGoals > 0 ? (
              <FunRow
                icon="footsteps-outline"
                tint="#F59E0B"
                parts={[
                  { t: `${derived.totalOwnGoals} שערים עצמיים`, em: 'num' },
                  { t: ' נכבשו במועדון' },
                ]}
                last
              />
            ) : null}
          </Card>

          {/* טבלת הליגה המלאה — מתחת ל"נתונים מעניינים" (בקשת אלירן: הנתונים
              המעניינים מעל הטבלה). מציגה את כל חברי המועדון מדורגים. */}
          <CommunityChampionship
            groupId={groupId}
            memberIds={memberIds}
            attendedByUser={attended}
            seasonNo={
              scopedCard
                ? scopedCard.no
                : seasons?.enabled
                  ? (seasons.currentNo ?? 1)
                  : undefined
            }
            seasonId={scope.k === 'season' ? scope.id : undefined}
            rows={scope.k === 'all' ? allTime : undefined}
            // The denominator of the efficiency tab's attendance column, in
            // the SAME scope as the rows above — the tile two sections up
            // prints this exact number as "מחזורים".
            clubEvenings={eveningsInScope}
          />

          {/* "הישגי המועדון" moved to CommunityDetails, under the club's
              numbers — the owner asked for it on the club page, not buried at
              the bottom of the stats screen. */}

          <View style={{ height: spacing.xl }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function ScopeChip({
  text,
  active,
  onPress,
}: {
  text: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.scopeChip, active && styles.scopeChipOn]}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      hitSlop={6}
    >
      <Text style={[styles.scopeChipText, active && styles.scopeChipTextOn]}>
        {text}
      </Text>
    </Pressable>
  );
}

function SectionTitle({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  return (
    <View style={styles.sectionTitle}>
      <Ionicons name={icon} size={16} color={colors.primary} />
      <Text style={styles.sectionTitleText}>{text}</Text>
    </View>
  );
}

function HeroTile({
  icon,
  tint,
  value,
  label,
}: {
  icon: React.ReactNode;
  tint: string;
  value: number | string;
  label: string;
}) {
  return (
    <Card style={styles.heroTile}>
      <View style={[styles.heroIcon, { backgroundColor: tint + '1A' }]}>
        {icon}
      </View>
      <View style={styles.heroText}>
        {/* Numbers count up (0 → value) as the stats resolve. */}
        {typeof value === 'number' ? (
          <CountUp from={0} to={value} durationMs={1000} style={styles.heroValue} />
        ) : (
          <Text style={styles.heroValue}>{value}</Text>
        )}
        <Text style={styles.heroLabel} numberOfLines={1}>{label}</Text>
      </View>
    </Card>
  );
}

// One leader = a right-aligned list row: avatar (right), category + name
// (right-aligned) beside it, and the value (counts up) pinned to the left.
function LeaderRow({
  title,
  user,
  value,
  unit,
  tint,
  index,
  last,
  suffix,
}: {
  title: string;
  user: Resolved;
  value: number;
  unit: string;
  tint: string;
  index: number;
  last?: boolean;
  /** e.g. "%" for penalty leaders whose headline value is a success rate. */
  suffix?: string;
}) {
  return (
    <AppearItem index={index}>
      <View style={[styles.leaderRow, !last && styles.funDivider]}>
        <UserAvatar user={user} size={40} ring />
        <View style={styles.leaderMid}>
          <Text style={styles.leaderCat} numberOfLines={1}>{title}</Text>
          <Text style={styles.leaderName} numberOfLines={1}>{fullName(user.name)}</Text>
        </View>
        <View style={styles.leaderVal}>
          <CountUp
            from={0}
            to={value}
            durationMs={1000}
            suffix={suffix}
            style={[styles.leaderValNum, { color: tint }]}
          />
          <Text style={styles.leaderValUnit}>{unit}</Text>
        </View>
      </View>
    </AppearItem>
  );
}

// One row = a single flowing sentence (not columns), with the stat number and
// the player names emphasised inline (user request). `em:'num'` → bold + the
// row tint; `em:'name'` → bold in the main text colour.
type FunPart = { t: string; em?: 'num' | 'name' };

function FunRow({
  icon,
  tint,
  parts,
  last,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  tint: string;
  parts: FunPart[];
  last?: boolean;
}) {
  return (
    <View style={[styles.funRow, !last && styles.funDivider]}>
      <View style={[styles.funIcon, { backgroundColor: tint + '1A' }]}>
        <Ionicons name={icon} size={16} color={tint} />
      </View>
      <Text style={styles.funSentence}>
        {parts.map((p, i) => (
          <Text
            key={i}
            style={
              p.em === 'num'
                ? [styles.funEm, { color: tint }]
                : p.em === 'name'
                  ? styles.funEmName
                  : undefined
            }
          >
            {p.t}
          </Text>
        ))}
      </Text>
    </View>
  );
}

// A fun fact whose stat is a percentage → an animated donut (the "graph") on
// the right that sweeps to the value, with the descriptive sentence beside it.
function FunDonutRow({
  pct,
  tint,
  text,
  index,
  last,
}: {
  pct: number;
  tint: string;
  text: string;
  index: number;
  last?: boolean;
}) {
  return (
    <View style={[styles.funRow, !last && styles.funDivider]}>
      <StatDonut pct={pct} tint={tint} size={48} delayMs={index * 90} />
      <Text style={styles.funSentence}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  seasonBanner: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: 2,
  },
  seasonBannerText: {
    ...typography.caption,
    color: colors.text,
    fontWeight: '600',
    textAlign: RTL_LABEL_ALIGN,
  },
  seasonBannerLink: {
    ...typography.caption,
    color: colors.primary,
    textAlign: RTL_LABEL_ALIGN,
  },
  root: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.xl },
  loadingText: { ...typography.body, color: colors.textMuted },
  scroll: { padding: spacing.md, gap: spacing.sm },

  // Label first in source order → rightmost under forceRTL, chips running
  // leftwards from it.
  scopeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  scopeLabel: { ...typography.caption, color: colors.textMuted },
  scopeChips: { gap: spacing.xs, paddingVertical: 2 },
  scopeChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  scopeChipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  // ⚠️ writingDirection, not just an alignment: the chip now carries
  // "מאז שעונה 2 הסתיימה" beside "עונה 2 · עכשיו", and a Hebrew label that
  // mixes in a digit and a "·" is exactly the shape that renders its
  // punctuation on the wrong end when the base direction is left to autodetect.
  scopeChipText: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '600',
    textAlign: RTL_LABEL_ALIGN,
    writingDirection: 'rtl',
  },
  scopeChipTextOn: { color: '#fff' },
  scopeNoteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  scopeNote: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
    // The note opens with a number on the seasons-off club ("סכום של 2 עונות
    // שנסגרו…"), and a right-aligned paragraph whose base direction is still
    // being guessed puts that number and the full stop on the wrong side.
    writingDirection: 'rtl',
    lineHeight: 18,
    paddingHorizontal: spacing.xs,
  },

  sectionTitle: {
    // Under forceRTL, 'row' packs the first child (icon) to the RIGHT and
    // anchors the whole header right. ('row-reverse' wrongly pushed it left.)
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  sectionTitleText: { ...typography.body, color: colors.text, fontWeight: '800', textAlign: RTL_LABEL_ALIGN },

  // MVP hero (top scorer) — the dominant element at the top.
  // The mvp* styles that dressed the hero card are gone with it — a style
  // nothing renders is the residue that makes a file look bigger than it is.

  // hero grid — 2×2, compact horizontal tiles (icon + number/label)
  //
  // `row`, like every other row on this screen. Under forceRTL `row` puts the
  // first child on the visual RIGHT and `row-reverse` puts it on the LEFT —
  // the file says so itself four times below. These two were the only places
  // that used row-reverse for a WRAPPING grid, so the four tiles filled left
  // to right: the first number a Hebrew reader meets was the last one written.
  heroGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  heroTile: {
    width: '48.5%',
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  heroIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  heroText: { flex: 1, minWidth: 0 },
  heroValue: { ...typography.h2, color: colors.text, fontWeight: '900', fontVariant: ['tabular-nums'], textAlign: RTL_LABEL_ALIGN },
  heroLabel: { ...typography.caption, color: colors.textMuted, fontWeight: '700', textAlign: RTL_LABEL_ALIGN, marginTop: 2 },

  // leaders — right-aligned list rows
  leadersCard: { padding: 0, overflow: 'hidden' },
  // `row` (not row-reverse): under forceRTL the first child (avatar) sits on the
  // visual RIGHT, category/name flow to its left, value pinned far LEFT.
  leaderRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.md, paddingHorizontal: spacing.md },
  leaderMid: { flex: 1, minWidth: 0, alignItems: 'flex-start' },
  leaderCat: { ...typography.caption, color: colors.textMuted, fontWeight: '800', textAlign: RTL_LABEL_ALIGN },
  leaderName: { ...typography.body, color: colors.text, fontWeight: '900', textAlign: RTL_LABEL_ALIGN, marginTop: 1 },
  leaderVal: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  leaderValNum: { ...typography.h3, fontWeight: '900', fontVariant: ['tabular-nums'] },
  leaderValUnit: { ...typography.caption, color: colors.textMuted, fontWeight: '800' },

  // scorers table
  tableCard: { padding: spacing.sm },
  scorerRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
  scorerDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  rankBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankText: { ...typography.caption, color: colors.textMuted, fontWeight: '800', fontVariant: ['tabular-nums'] },
  rankTextMedal: { color: '#FFFFFF' },
  scorerName: { flex: 1, minWidth: 0, ...typography.body, color: colors.text, fontWeight: '700', textAlign: RTL_LABEL_ALIGN },
  assistPill: { flexDirection: 'row-reverse', alignItems: 'center', gap: 3, paddingHorizontal: 7, height: 24, borderRadius: 12, backgroundColor: '#7C3AED14' },
  assistPillText: { ...typography.caption, color: '#7C3AED', fontWeight: '800', fontVariant: ['tabular-nums'] },
  goalsPill: { flexDirection: 'row-reverse', alignItems: 'center', gap: 4, paddingHorizontal: 9, height: 26, borderRadius: 13, backgroundColor: colors.primary + '14' },
  goalsPillText: { ...typography.body, color: colors.primary, fontWeight: '900', fontVariant: ['tabular-nums'] },

  // fun facts
  funCard: { padding: 0, overflow: 'hidden' },
  // `row` (not row-reverse): under forceRTL the first child (icon) sits on the
  // visual RIGHT, with the sentence flowing to its left (user request).
  funRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.md, paddingHorizontal: spacing.md },
  funDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  funIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  funSentence: { ...typography.body, flex: 1, color: colors.textMuted, textAlign: RTL_LABEL_ALIGN, lineHeight: 24 },
  funEm: { fontWeight: '900', fontVariant: ['tabular-nums'] },
  funEmName: { fontWeight: '800', color: colors.text },

  // club level + achievements
  levelCard: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  levelDisc: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  levelDiscLabel: { ...typography.caption, color: '#FFFFFF', fontWeight: '700', opacity: 0.9, marginBottom: -4 },
  levelDiscNum: { ...typography.h1, color: '#FFFFFF', fontWeight: '900', fontVariant: ['tabular-nums'] },
  levelInfo: { flex: 1, minWidth: 0, gap: 6 },
  levelTier: { ...typography.h3, color: colors.text, fontWeight: '900', textAlign: RTL_LABEL_ALIGN },
  levelBarTrack: { height: 10, borderRadius: 999, backgroundColor: colors.surfaceMuted, overflow: 'hidden' },
  levelBarFill: { height: '100%', borderRadius: 999, backgroundColor: colors.primary },
  // The all-time chemistry caveat. Sits between the section title and the
  // cards, so it is read before the numbers it qualifies rather than after.
  chemistryNote: {
    fontSize: 11,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
    writingDirection: 'rtl',
    marginTop: -4,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  levelHint: { ...typography.caption, color: colors.textMuted, textAlign: RTL_LABEL_ALIGN },
});
