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
import {
  RTL_LABEL_ALIGN,
  clubAccent,
  clubCardTint,
  clubShadow,
  clubSurface,
  colors,
  radius,
  spacing,
  typography,
} from '@/theme';
import { ChemistrySection } from '@/components/chemistry/ChemistrySection';
import { roundSummaryService } from '@/services/roundSummaryService';
import { eveningRecordsOf, type EveningStat } from '@/utils/eveningRecords';
import { ClubRecords } from '@/components/club/ClubRecords';
import { ResultsBreakdown } from '@/components/club/ResultsBreakdown';
import { buildClubRecords } from '@/utils/clubRecords';
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
  /** Mini-games the two outcome counters were measured over. */
  countedRounds: number;
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

export interface CommunityStatsScreenProps {
  /**
   * Set when the club numbers are rendered as a TAB of the club screen rather
   * than pushed as their own route. The shell then owns the chrome and passes
   * its hero + tab bar down as `header`.
   */
  groupId?: string;
  /** The shell's hero + tab bar. Sticks to the top of the scroll. */
  header?: React.ReactElement | null;
}

export function CommunityStatsScreen(props: CommunityStatsScreenProps = {}) {
  const nav = useNavigation<{ navigate: (s: string, p?: unknown) => void }>();
  const routeParams = useRoute<Params>().params as Params['params'] | undefined;
  // One of the two always holds it: embedded, the shell passes it; standalone,
  // the CommunityStats route cannot be reached without it.
  const groupId: string = props.groupId ?? routeParams!.groupId;
  const embedded = !!props.groupId;
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
  // The scope list is collapsed behind the summary row, as in the reference.
  const [scopeOpen, setScopeOpen] = useState(false);
  /**
   * The club's sealed evenings, for the three evening records.
   *
   * Refetched whenever the SCOPE changes, because a season's record has to be
   * that season's evening — showing a lifetime best under a season heading is
   * the bug this whole screen has been fixing. The window comes from the
   * season's own boundaries: a past season has `startsAt`/`endsAt`, and the
   * running season begins where the last sealed one ended.
   */
  const [eveningStats, setEveningStats] = useState<EveningStat[]>([]);

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
          countedRounds: 0,
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
              countedRounds: champ?.countedRounds ?? 0,
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

  /**
   * The window the evening records are computed over, derived from the scope.
   *
   *   all      no window — every summary the club has
   *   season   that season's own `startsAt`/`endsAt`
   *   current  from where the last sealed season ended, or no window for a
   *            club that has never closed one
   */
  const recordWindow = useMemo((): { from?: number; to?: number } => {
    if (scope.k === 'all') return {};
    if (scope.k === 'season') {
      return scopedCard
        ? { from: scopedCard.startsAt, to: scopedCard.endsAt }
        : // A season whose archive has not loaded yet. An unbounded window
          // here would show a lifetime record under a season heading, so the
          // impossible window hides the cards until it arrives.
          { from: Number.MAX_SAFE_INTEGER };
    }
    const lastSealed = pastSeasons.reduce((m, p) => Math.max(m, p.endsAt), 0);
    return lastSealed > 0 ? { from: lastSealed } : {};
  }, [scope, scopedCard, pastSeasons]);

  useEffect(() => {
    if (!groupId) return;
    let alive = true;
    roundSummaryService
      .listEveningStats(groupId, recordWindow)
      .then((r) => {
        if (alive) setEveningStats(r.evenings);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [groupId, recordWindow]);

  const eveningRecords = useMemo(
    () => eveningRecordsOf(eveningStats),
    [eveningStats],
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
            countedRounds: slice.countedRounds,
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
    // The sample the two outcome counters were measured over. `totalRounds`
    // counts every mini-game the club ever played; these two started counting
    // when they were deployed. Dividing by the wrong one is what made the 0:0
    // rate read 3% on a club where it is far higher.
    const countedRounds = viewChamp?.countedRounds ?? 0;
    // Goals scored by guests across the club — a separate breakout, NOT folded
    // into totalGoals (which is real ranked players only). Drives its own row.
    const guestGoals = viewChamp?.guestGoals ?? 0;
    const goalsPerMini = totalRounds > 0 ? totalGoals / totalRounds : 0;
    const drawPct = totalRounds > 0 ? Math.round((tiedRounds / totalRounds) * 100) : 0;
    const shootoutPct =
      countedRounds > 0 ? Math.round((shootoutRounds / countedRounds) * 100) : 0;
    const scorelessPct =
      countedRounds > 0 ? Math.round((scorelessRounds / countedRounds) * 100) : 0;
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
      countedRounds,
      // Detectable, exactly, and only because `countedRounds` exists: the club
      // played more mini-games than the counters saw.
      partialCoverage: countedRounds > 0 && countedRounds < totalRounds,
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

  /**
   * What the summary row says. Built from the SAME strings the chips use, so
   * the collapsed row can never name a different scope from the one selected
   * in the list underneath it.
   */
  const scopeTitle =
    scope.k === 'all'
      ? he.communityStatsScopeAllTime
      : scope.k === 'season'
        ? he.communityStatsScopePast(
            pastSeasons.find((p) => p.seasonId === scope.id)?.no ?? 1,
          )
        : seasons && !seasons.enabled && (seasons.count ?? 0) > 0
          ? he.communityStatsScopeSinceOff(seasons.count ?? 1)
          : // The bar names the scope and nothing else. The chip below it still
            // says "· עכשיו" because in a LIST of seasons that is what tells
            // you which one is running; alone on the bar it is decoration.
            he.communityStatsScopeSeasonPlain(seasons?.currentNo ?? 1);

  /**
   * "שיאי המועדון". Each record carries its OWN scope rule rather than the
   * area carrying one, which is why the builder takes nulls: under a season
   * the club keeps two of the four, instead of the whole area disappearing.
   *
   *   streak        lifetime only — a record is permanent, and printing the
   *                 club's 22-night record beside a table reading 0 מחזורים
   *                 is the bug the `lifetimeScope` gate below was added for.
   *   most attended any scope — `topPlayers` is scanned per scope.
   *   attendance    any scope — a mean over that scope's finished nights.
   *   organization  lifetime only — the season-scoped rate was wrong; see the
   *                 note on the donut that reads it.
   */
  const clubRecords = buildClubRecords({
    // The streak the SCOPE is about, not a lifetime figure shown under a
    // season heading.
    //
    // The earlier gate passed 0 under a season and made the record vanish,
    // which left the section with three cards in a season and four in
    // all-time. That was a fix for the wrong half of the problem: the bug it
    // was written for was printing the club's 22-night LIFETIME record beside
    // a season table reading 0 מחזורים — and `StatsData` already carries the
    // season-scoped streak beside the lifetime one. Showing a season its own
    // streak is correct, and keeps the grid at four in every scope.
    longestStreak: lifetimeScope
      ? (stats?.lifetime?.longestStreak ?? stats?.longestStreak ?? 0)
      : (stats?.longestStreak ?? 0),
    longestStreakUid: lifetimeScope
      ? (stats?.lifetime?.longestStreakUid ?? stats?.longestStreakUid ?? null)
      : (stats?.longestStreakUid ?? null),
    totalFinished: stats?.totalFinished ?? 0,
    mostGoalsEvening: eveningRecords.goals,
    mostShootoutsEvening: eveningRecords.shootouts,
    longestEvening: eveningRecords.rounds,
    // `name()` answers '—' for an unknown uid. The builder wants a null, so it
    // can drop the record instead of hanging a dash where a person goes.
    nameOf: (uid: string) => {
      const n = name(uid);
      return n === '—' ? null : n;
    },
  });

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
    // Embedded, the shell above already claimed the top inset.
    <SafeAreaView style={styles.root} edges={embedded ? [] : ['top']}>
      {embedded ? null : (
        <ScreenHeader
          title={he.communityStatsScreenTitle}
          subtitle={subtitle || undefined}
        />
      )}

      {bootLoading ? (
        <>
          {props.header}
          <View style={styles.center}>
            <SoccerBallLoader />
            <Text style={styles.loadingText}>{he.communityStatsLoading}</Text>
          </View>
        </>
      ) : isEmpty ? (
        <>
          {props.header}
          <EmptyState
            icon="stats-chart-outline"
            title={he.communityStatsEmptyTitle}
            hint={he.communityStatsEmptyBody}
          />
        </>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
        >
          {embedded && props.header ? (
            <View style={styles.headerBleed}>{props.header}</View>
          ) : null}
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
              <View>
              {/* The reference's scope control: a white row with a calendar on
                  the leading edge and the chosen scope closing it on the left.
                  Tapping opens the list in place — the club can have any number
                  of past seasons, and a chip row for eight of them was a
                  horizontal scroll nobody found. */}
              <Pressable
                style={styles.scopeBar}
                onPress={() => setScopeOpen((v) => !v)}
                accessibilityRole="button"
                accessibilityState={{ expanded: scopeOpen }}
                accessibilityLabel={he.communityStatsScopeLabel}
              >
                <Ionicons name="calendar" size={20} color={clubAccent.blue} />
                <Text style={styles.scopeCurrent} numberOfLines={1}>
                  {scopeTitle}
                </Text>
                <Ionicons
                  name={scopeOpen ? 'chevron-up' : 'chevron-down'}
                  size={18}
                  color={clubAccent.blue}
                />
              </Pressable>
              {scopeOpen ? (
              <View style={styles.scopeRow}>
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
                    onPress={() => { setScope({ k: 'current' }); setScopeOpen(false); }}
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
                      onPress={() => { setScope({ k: 'all' }); setScopeOpen(false); }}
                    />
                  ) : null}
                  {pastSeasons.map((ps) => (
                    <ScopeChip
                      key={ps.seasonId}
                      text={he.communityStatsScopePast(ps.no)}
                      active={scope.k === 'season' && scope.id === ps.seasonId}
                      onPress={() => { setScope({ k: 'season', id: ps.seasonId }); setScopeOpen(false); }}
                    />
                  ))}
                </ScrollView>
              </View>
              ) : null}
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
              {/* A banner, not a button any more. It used to open
                  "עונות קודמות ותארים", and that screen is gone (23.09) — its
                  medal cabinet moved into the personal season summary. The
                  route it offered is now the chip row three lines above this
                  banner: tap a past season and the whole screen becomes that
                  season, with "סיכום העונה שלי" at the bottom of it. A link
                  pointing at something already on screen is one control too
                  many. */}
              {/* Only the fresh-season line survives. The ordinary
                  "הטבלה מציגה את עונה N" paragraph showed on the DEFAULT scope,
                  is not in the reference, and repeated what the selector above
                  it already says. The fresh-season line is a different thing
                  and stays: after a close, half this screen is gated on `> 0`
                  and goes dark in one paint, and without a sentence the
                  ten-year member reads it as "מחקו לי הכל". */}
              {seasons?.enabled &&
              scope.k === 'current' &&
              (seasons.count ?? 0) > 0 &&
              !hasScoring ? (
                <View style={styles.seasonBanner}>
                  <Text style={styles.seasonBannerText}>
                    {/* A club whose new season has no goals yet is not an empty
                        club — it is a club between seasons, and that is a very
                        different sentence. Half this screen (the top scorer, the
                        leaders, the donuts, the duo, eight fun facts) is gated on
                        `> 0` and goes dark in one paint on the first evening after
                        a close; without this the ten-year member reads it as
                        "מחקו לי הכל". */}
                    {he.communityStatsSeasonFresh(seasons.currentNo ?? 1)}
                  </Text>
                  {/* Kept ONLY on the fresh-season line, where it names the
                      chip to press. On the ordinary line it used to read
                      "עונות קודמות ותארים", which was the name of the screen
                      it opened and means nothing now. */}
                  <Text style={styles.seasonBannerLink}>
                    {he.communityStatsSeasonFreshCta}
                  </Text>
                </View>
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
                {/* NO tooltip here any more.
                    It said the organisation rate, the streaks, the chemistry
                    and the club titles are measured over the club's whole life
                    and so appear only in the running season. Two of those are
                    no longer true — chemistry now renders in every scope, off
                    the season's own archived pairs — and a tooltip that has to
                    be re-read against the screen is worse than none. Removed
                    at the owner's request, 22.09. */}
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
          <Card style={styles.heroCard}>
          <Text style={styles.cardTitle}>{he.communityStatsSectionNumbers}</Text>
          <View style={styles.heroGrid}>
            <HeroTile icon={<MaterialCommunityIcons name="soccer" size={28} color={clubAccent.blue} />} tint={clubAccent.blue} value={derived.totalGoals} label={he.communityStatsGoals} />
            <HeroTile icon={<MaterialCommunityIcons name="shoe-cleat" size={28} color={clubAccent.purple} />} tint={clubAccent.purple} value={derived.totalAssists} label={he.communityStatsAssists} />
            <HeroTile icon={<MaterialCommunityIcons name="soccer-field" size={28} color={clubAccent.green} />} tint={clubAccent.green} value={derived.totalRounds} label={he.communityStatsMiniGames} />
            <HeroTile icon={<MaterialCommunityIcons name="calendar-month" size={28} color={clubAccent.gold} />} tint={clubAccent.gold} value={eveningsInScope ?? 0} label={he.communityStatsEvenings} />
          </View>
          </Card>

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
                  tint: clubAccent.blue,
                },
                derived.topAssister && {
                  title: he.communityStatsTopAssister,
                  uid: derived.topAssister.uid,
                  value: derived.topAssister.assists,
                  unit: 'בישולים',
                  tint: clubAccent.blue,
                },
                derived.topWinner && {
                  title: he.communityStatsTopWinner,
                  uid: derived.topWinner.uid,
                  value: derived.topWinner.wins,
                  unit: 'נצחונות',
                  tint: clubAccent.blue,
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
                  // An own-goal crown is the one dubious title here — the
                  // only negative in the list, and the only red.
                  tint: clubAccent.red,
                },
              ].filter(Boolean) as {
                title: string;
                uid: string;
                value: number;
                unit: string;
                tint: string;
                suffix?: string;
              }[]
            ).map((r) => r)
              .reduce<React.ReactNode[]>((out, _r, _i, arr) => {
                // The first three become the headline cards, the rest stay
                // rows. The reference shows three; this club crowns up to
                // eight, and dropping five titles to match a screenshot would
                // delete five kings. The hierarchy that DOES exist is between
                // the three cards and the list under them — never inside the
                // three.
                if (out.length) return out;
                const top = arr.slice(0, 3);
                const rest = arr.slice(3);
                out.push(
                  <LeaderTrio
                    key="trio"
                    items={top.map((r) => ({
                      ...r,
                      user: resolved(r.uid),
                      icon: LEADER_ICON[r.title] ?? 'star',
                    }))}
                  />,
                );
                rest.forEach((r, i) =>
                  out.push(
                    <LeaderRow
                      key={r.title}
                      title={r.title}
                      user={resolved(r.uid)}
                      value={r.value}
                      unit={r.unit}
                      suffix={r.suffix}
                      tint={r.tint}
                      index={i}
                      last={i === rest.length - 1}
                    />,
                  ),
                );
                return out;
              }, [])}
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
              <SectionTitle icon="people" text={he.clubPairsTitle} />
              {lifetimeScope && (seasons?.count ?? 0) > 0 ? (
                <Text style={styles.chemistryNote}>{he.chemistryAllTimeNote}</Text>
              ) : null}
              <ChemistrySection
                groupId={groupId}
                pairs={chemistryPairs}
                // The chip above already names the window whenever the club
                // runs seasons — and for the two non-current scopes the line
                // would be wrong as well as redundant, since `since` is the
                // LIVE counters' start and those scopes are not live.
                seasonScoped={seasons?.enabled === true || (seasons?.count ?? 0) > 0}
              />
            </>
          )}

          {/* ── שיאי המועדון ── */}
          {/* After the pairs and before the club-wide facts, which is the
              reference's order: one person, then two, then everybody. */}
          <ClubRecords
            records={clubRecords}
            onHolderPress={(uid) =>
              (nav as { navigate: (s: string, p: unknown) => void }).navigate(
                'PlayerCard',
                { userId: uid, groupId },
              )
            }
            // The SAME route the history list and the next-game card already
            // use to open an evening — no new screen, no modal, no alternative
            // summary.
            onEveningPress={(gameId) =>
              (nav as { navigate: (s: string, p: unknown) => void }).navigate(
                'MatchDetails',
                { gameId },
              )
            }
          />

          {/* ── נתונים מעניינים ──
              Three measures, one row component, one card.

              Four measures, each telling a different story — no two of them
              complements of one another. "% שהסתיימו בגול" is gone precisely
              because it was the complement of the 0:0 rate and said the same
              thing twice; penalty conversion took the slot.

              The 0:0 and penalty rates divide by `countedRounds`, the sample
              their counters were actually measured over — NOT by the club's
              lifetime `totalRounds`. The assisted-goals rate has no such
              caveat: assists and goals are per-player rollups covering the
              whole history. */}
          <SectionTitle icon="sparkles" text={he.communityStatsSectionFun} />
          <Card style={styles.funCard}>
            {(() => {
              // Always four, in this order. A measure with no sample passes
              // `null` and renders its "not measured yet" state in place —
              // the section must not resize as coverage arrives.
              const sampled = derived.countedRounds > 0;
              const rows = [
                {
                  key: 'assisted',
                  icon: 'git-network' as const,
                  tint: clubAccent.blue,
                  pct:
                    derived.totalGoals > 0 && derived.totalAssists > 0
                      ? derived.assistedGoalsPct
                      : null,
                  text: he.funAssistedGoals,
                },
                {
                  key: 'scoreless',
                  icon: 'remove-circle' as const,
                  tint: clubAccent.green,
                  pct: sampled ? derived.scorelessPct : null,
                  text: he.funScoreless,
                },
                {
                  key: 'penRate',
                  icon: 'football' as const,
                  tint: clubAccent.purple,
                  pct: derived.penTakenTotal > 0 ? derived.penAccuracyPct : null,
                  text: he.funPenaltyRate,
                },
                {
                  key: 'shootout',
                  icon: 'disc' as const,
                  tint: clubAccent.red,
                  pct: sampled ? derived.shootoutPct : null,
                  text: he.funShootout,
                },
              ];
              return rows.map((r, i) => (
                <FunDonutRow
                  key={r.key}
                  icon={r.icon}
                  pct={r.pct}
                  tint={r.tint}
                  text={r.text}
                  last={i === rows.length - 1}
                />
              ));
            })()}
          </Card>
          {/* Exact, not a hedge: the club played N mini-games and the counters
              behind two of the rows above saw M of them. Before `countedRounds`
              this could not be detected at all — the old caveat only fired when
              BOTH counters were zero, so a club with partial history showed a
              wrong number silently. */}
          {derived.partialCoverage ? (
            <Text style={styles.scopeNote}>
              {he.funMeasuredOver(derived.countedRounds, derived.totalRounds)}
            </Text>
          ) : null}

          {/* ── איך המשחקונים הסתיימו ── */}
          {/* One ring in place of three separate donuts. Draw-rate, 0:0-rate
              and penalty-rate were three unrelated-looking percentages of the
              same denominator; as slices of one ring they add up on screen,
              which is the thing a reader wanted from them. */}
          <ResultsBreakdown
            // The MEASURED set, the same one the bars above divide by. See the
            // prop's own note for the production numbers that forced this.
            totalRounds={derived.countedRounds}
            tiedRounds={derived.tiedRounds}
            shootoutRounds={derived.shootoutRounds}
            scorelessRounds={derived.scorelessRounds}
            partial={derived.partialCoverage}
          />


          {/* "הישגי המועדון" moved to CommunityDetails, under the club's
              numbers — the owner asked for it on the club page, not buried at
              the bottom of the stats screen. */}

          <View style={{ height: spacing.xl }} />

          {/* טבלת הליגה המלאה — האזור האחרון במסך. היא ארוכה מכל השאר גם יחד,
              ולכן כל אזור שהיה מתחתיה היה נקבר. */}
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
    // A plain cell, not a Card: in the reference the four cells sit INSIDE one
    // white card, so a second elevation here would stack two shadows.
    <View style={styles.heroTile}>
      <View style={styles.heroIcon}>{icon}</View>
      <View style={styles.heroText}>
        {/* Numbers count up (0 → value) as the stats resolve. */}
        {typeof value === 'number' ? (
          <CountUp from={0} to={value} durationMs={1000} style={styles.heroValue} />
        ) : (
          <Text style={styles.heroValue}>{value}</Text>
        )}
        <Text style={styles.heroLabel} numberOfLines={1}>{label}</Text>
      </View>
    </View>
  );
}

/**
 * The club's three headline leaders, as three EQUAL cards.
 *
 * Deliberately not a podium, and this is a correction of an earlier design
 * rather than a style preference. These are three different CATEGORIES — top
 * scorer, top assister, top winner — not three placings in one contest. The
 * previous version gave the middle card more width, more height, a bigger
 * avatar, a bigger number and a stronger tint, which reads as gold / silver /
 * bronze and says something about the club that is simply untrue.
 *
 * So every card shares one style contract: same flex, same padding, same
 * avatar, same metric size, same border, same accent. No card is raised, and
 * no index is printed anywhere — a "1" beside the first card would re-create
 * the ranking the layout just stopped implying. They differ by their icon,
 * their title, their number and their player, and by nothing else.
 *
 * All three carry Teamder blue. A colour per category was decoration: it made
 * the area a rainbow and told the reader nothing, because the categories are
 * not positive-vs-negative, they are just different.
 */
/**
 * One glyph per title. This map, the title text, the number and the player are
 * the entire difference between the three cards — there is no colour, size or
 * position cue, by design.
 */
const LEADER_ICON: Record<string, React.ComponentProps<typeof Ionicons>['name']> = {
  [he.communityStatsTopScorer]: 'football',
  [he.communityStatsTopAssister]: 'git-network',
  [he.communityStatsTopWinner]: 'trophy',
  [he.communityStatsCleanSheetKing]: 'shield-checkmark',
  [he.communityStatsMostLoyal]: 'calendar',
  [he.communityStatsPenaltyKing]: 'disc',
  [he.communityStatsPenaltyKeeperKing]: 'hand-left',
  [he.communityStatsOwnGoalKing]: 'alert-circle',
};

/**
 * The three headline categories, by position in the leaders list.
 *
 * Colour identifies the CATEGORY and nothing else. The three cards are
 * identical in every dimension that could imply rank — size, height, padding,
 * avatar, metric, shadow — so a reader can tell them apart without being told
 * one of them won.
 */
const TRIO_ACCENT = [clubAccent.blue, clubAccent.purple, clubAccent.gold];

function LeaderTrio({
  items,
}: {
  items: {
    title: string;
    user: Resolved;
    value: number;
    unit: string;
    icon: React.ComponentProps<typeof Ionicons>['name'];
    suffix?: string;
  }[];
}) {
  if (!items.length) return null;
  return (
    <View style={styles.trio}>
      {items.map((r, i) => {
        const accent = TRIO_ACCENT[i] ?? clubAccent.blue;
        return (
          <View
            key={r.title}
            style={[styles.trioCard, { backgroundColor: clubCardTint(accent) }]}
          >
            {/* Rides the card's top edge, filled with the category colour. */}
            {/* The ring takes the CARD's tint, not the page ground. Ringing
                it in the page colour cut a hole in a tinted card and the badge
                read as pasted on rather than part of it. */}
            <View
              style={[
                styles.trioBadge,
                { backgroundColor: accent, borderColor: clubCardTint(accent) },
              ]}
            >
              <Ionicons name={r.icon} size={17} color="#FFFFFF" />
            </View>
            <Text style={styles.trioTitle} numberOfLines={2}>
              {r.title}
            </Text>
            <UserAvatar user={r.user} size={56} ring />
            <CountUp
              from={0}
              to={r.value}
              durationMs={1000}
              suffix={r.suffix}
              style={[styles.trioValue, { color: accent }]}
            />
            <Text style={styles.trioName} numberOfLines={1}>
              {fullName(r.user.name)}
            </Text>
          </View>
        );
      })}
    </View>
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

function FunDonutRow({
  pct,
  tint,
  text,
  icon,
  last,
}: {
  /**
   * `null` = no sample yet. Rendered as an explicit "not measured" state, not
   * as 0%: a bar sitting empty beside a bold zero claims the club has never
   * done the thing, when the truth is that nobody has counted.
   */
  pct: number | null;
  tint: string;
  text: string;
  /** The reference gives every row its own glyph; the bar alone is anonymous. */
  icon: React.ComponentProps<typeof Ionicons>['name'];
  last?: boolean;
}) {
  const measured = pct !== null;
  const clamped = measured ? Math.max(0, Math.min(100, pct)) : 0;
  return (
    // Icon leads on the right, the sentence and its bar fill the middle, and
    // the percentage closes the row on the left — the reference's shape. A
    // donut for a share of a whole is legible; four donuts stacked in a column
    // are four rings of different circumference saying nothing to each other,
    // which is why the reference puts them on a common baseline.
    <View style={[styles.funRow, !last && styles.funDivider]}>
      <View
        style={[
          styles.funIcon,
          { backgroundColor: measured ? tint + '1A' : clubSurface.divider },
        ]}
      >
        <Ionicons name={icon} size={18} color={measured ? tint : '#94A3B8'} />
      </View>
      <View style={styles.funBody}>
        <Text style={styles.funSentence} numberOfLines={2}>
          {text}
        </Text>
        {measured ? (
          <View style={styles.funTrack}>
            {/* Grows from the RIGHT — see `funTrack`. */}
            <View style={[styles.funFill, { width: `${clamped}%`, backgroundColor: tint }]} />
          </View>
        ) : (
          <>
            {/* An empty track, visibly inactive, and a sentence saying why —
                the row keeps its place so the section never jumps between two
                and four measures. */}
            <View style={styles.funTrack} />
            <Text style={styles.funPending}>{he.funNotMeasuredYet}</Text>
          </>
        )}
      </View>
      {measured ? (
        <Text style={[styles.funPct, { color: tint }]}>{`${clamped}%`}</Text>
      ) : (
        <Text style={[styles.funPct, styles.funPctPending]}>—</Text>
      )}
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
  // Local club ground — cool and a step below white, so the cards on it
  // have an edge. See `clubSurface`.
  root: { flex: 1, backgroundColor: clubSurface.ground },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.xl },
  loadingText: { ...typography.body, color: colors.textMuted },
  scroll: { padding: spacing.md, gap: spacing.sm },
  // The shell's hero is full-bleed; this scroll's content container is not.
  headerBleed: { marginHorizontal: -spacing.md, marginTop: -spacing.md },

  // Label first in source order → rightmost under forceRTL, chips running
  // leftwards from it.
  scopeBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: 14,
    paddingHorizontal: spacing.md,
    height: 46,
    ...clubShadow,
  },
  scopeCurrent: {
    flex: 1,
    fontSize: 15,
    fontWeight: '800',
    color: colors.text,
    textAlign: RTL_LABEL_ALIGN,
  },
  scopeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingTop: spacing.xs },
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
  // The four cells live inside one card, as in the reference.
  // A hairline edge on every card: white on the club ground needs one to read
  // as a layer rather than as a lighter patch of the same sheet.
  heroCard: { gap: spacing.md, ...clubShadow },
  heroGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  heroTile: {
    flexGrow: 1,
    flexBasis: '47%',
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.md,
    borderRadius: 14,
    backgroundColor: colors.surface,
    ...clubShadow,
  },
  // The reference uses a bare coloured glyph on the trailing edge — no tinted
  // plate behind it. The plate made four cells read as four buttons.
  heroIcon: { width: 30, alignItems: 'center', justifyContent: 'center' },
  heroText: { flex: 1, minWidth: 0 },
  heroValue: {
    fontSize: 27,
    lineHeight: 33,
    color: '#0F172A',
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
    textAlign: RTL_LABEL_ALIGN,
  },
  heroLabel: {
    fontSize: 13,
    color: '#64748B',
    fontWeight: '600',
    textAlign: RTL_LABEL_ALIGN,
    marginTop: 1,
  },
  // One row, three equal cards. `alignItems: 'stretch'` so they share a height
  // even when one title wraps to two lines and the others do not — an uneven
  // bottom edge is the last thing left that could read as a ranking.
  trio: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: spacing.sm,
    // Clearance for the badges riding the cards' top edges.
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  trioCard: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    gap: 6,
    // Room above for the badge that rides the top edge.
    paddingTop: spacing.lg + 8,
    paddingBottom: spacing.lg,
    paddingHorizontal: spacing.xs,
    borderRadius: 16,
    // No border: the reference's cards have a tint and a shadow, and a grey
    // outline over both is what made these read as table cells.
    ...clubShadow,
  },
  trioBadge: {
    position: 'absolute',
    top: -16,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
  },
  trioTitle: {
    fontSize: 12.5,
    lineHeight: 16,
    fontWeight: '700',
    color: '#64748B',
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  trioValue: {
    fontSize: 34,
    fontWeight: '900',
    letterSpacing: -0.8,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  trioName: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.text,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: colors.text,
    textAlign: RTL_LABEL_ALIGN,
  },

  // leaders — right-aligned list rows
  leadersCard: { padding: 0, overflow: 'hidden', ...clubShadow },
  // `row` (not row-reverse): under forceRTL the first child (avatar) sits on the
  // visual RIGHT, category/name flow to its left, value pinned far LEFT.
  // The five titles BELOW the podium are deliberately quieter than it: shorter
  // rows, a smaller number, a lighter name. They carry titles the podium has
  // no room for — they are not a second podium, and when they had the same
  // weight the area read as eight equal winners with three of them decorated.
  leaderRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm + 2, paddingHorizontal: spacing.md },
  leaderMid: { flex: 1, minWidth: 0, alignItems: 'flex-start' },
  leaderCat: { fontSize: 12, color: clubSurface.subtle, fontWeight: '700', textAlign: RTL_LABEL_ALIGN },
  leaderName: { fontSize: 15, color: colors.text, fontWeight: '800', textAlign: RTL_LABEL_ALIGN, marginTop: 1 },
  leaderVal: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  leaderValNum: { fontSize: 19, fontWeight: '900', fontVariant: ['tabular-nums'] },
  leaderValUnit: { fontSize: 12, color: clubSurface.subtle, fontWeight: '700' },

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
  funCard: { padding: 0, overflow: 'hidden', ...clubShadow },
  // `row` (not row-reverse): under forceRTL the first child (icon) sits on the
  // visual RIGHT, with the sentence flowing to its left (user request).
  funRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.lg - 2, paddingHorizontal: spacing.lg },
  funBody: { flex: 1, minWidth: 0, gap: 7 },
  // Fills from the RIGHT. 0% is the right edge and the bar grows leftwards,
  // which is the direction a Hebrew reader reads a quantity in. A plain `row`
  // does this under forceRTL; `row-reverse` was an earlier misreading of the
  // reference and shipped a bar that grew the wrong way.
  funTrack: {
    height: 12,
    borderRadius: 6,
    backgroundColor: clubSurface.divider,
    overflow: 'hidden',
    flexDirection: 'row',
  },
  funFill: { height: '100%', borderRadius: 6 },
  funPending: {
    fontSize: 12,
    color: '#94A3B8',
    textAlign: RTL_LABEL_ALIGN,
    writingDirection: 'rtl',
  },
  funPctPending: { color: '#94A3B8' },
  funPct: {
    fontSize: 21,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
    minWidth: 46,
    textAlign: 'left',
  },
  funDivider: { borderBottomWidth: 1, borderBottomColor: clubSurface.divider },
  funIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  funSentence: { fontSize: 14.5, flex: 1, color: clubSurface.subtle, textAlign: RTL_LABEL_ALIGN, lineHeight: 20 },
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
