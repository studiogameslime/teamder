import { readSeasonArchiveData } from './seasonArchiveData';
// seasonSummaryService — one player's season, fetched.
//
// A season IS the club's live stat rows: closing one archives them into
// `seasonSummary/{groupId}__{seasonId}` and zeroes the originals. So there are
// exactly two sources, and which one to read depends only on whether the
// season asked for is the one currently running:
//
//   running → communityPlayerStats + communityPairStats, as they stand
//   closed  → the frozen archive, which carries both in full
//
// Either way the shape handed to `buildPersonalSeason` is identical, so the
// screen never learns which it got.

import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { USE_MOCK_DATA, getFirebase } from '@/firebase/config';
import { seasonChoices, type SeasonChoice } from '@/utils/seasonChoices';
import { logError } from '@/services/errorLog';
import { groupService } from '@/services/groupService';
import {
  buildPersonalSeason,
  type PersonalSeason,
  type SeasonPairRow,
  type SeasonPlayerRow,
} from '@/utils/seasonPersonal';
import type { GroupSeasons, SeasonTitleKey, UserId } from '@/types';
import { computeSeasonAwards, SEASON_TITLE_KEYS } from '@/utils/seasonAwards';
import { buildSeasonClubNumbers, distinctSeasonWinners, seasonChemistryPairs, type SeasonClubNumbers } from '@/utils/seasonClubSummary';
import type { EveningRecord } from '@/utils/eveningRecords';
import type { PairTotals } from '@/utils/clubChemistry';
import { readSeasonCoverage } from '@/utils/seasonCoverage';

/** A title this player holds in the season being shown. */
export interface SeasonTitleWon {
  key: SeasonTitleKey;
  /** The number it was won on: 31 goals, 8.37 average, 5 penalties saved.
   *  (Not "62% saved" — the penalty titles became counts on 20.09.2026.) */
  value: number;
  valueUnit?: 'percent';
  /** Other holders — ties are shared, never broken. */
  sharedWith: number;
  /** See SeasonTitleAwarded.coverage. Optional for the same reason. */
  coverage?: { rated: number; of: number };
}

/** A title the season awarded, with the names of everyone holding it. */
export interface SeasonTitleAwarded {
  key: SeasonTitleKey;
  names: string[];
  /** Distinct identities, including both members of every winning duo. */
  winners?: { id: string; name: string; coverage?: { rated: number; of: number } }[];
  value: number;
  valueUnit?: 'percent';
  /** Whether the reader is one of the holders — the row is highlighted. */
  mine: boolean;
  /**
   * How much of the season a RATING was really built from. Present only on
   * titles whose value is an average, and only when the archive recorded it.
   *
   * ⚠️ OPTIONAL. Every season closed before 20.09.2026 has awards with no such
   * field and must keep rendering exactly as it does now. Absent means "no
   * claim either way", never "zero of zero".
   */
  coverage?: { rated: number; of: number };
}

/** Ceiling on the season picker. A club playing weekly for twenty years on
 *  three-month seasons has eighty. */

/** One season the club has, for the picker. Defined with the derivation in
 *  utils/seasonChoices and re-exported here so existing importers are
 *  unaffected — one shape, one place it is computed. */
export type { SeasonChoice };

export interface SeasonSummaryModel {
  groupId: string;
  groupName: string;
  seasonNo: number;
  seasonId: string;
  startsAt: number;
  /** Null while the season is still running. */
  endsAt: number | null;
  closed: boolean;
  /**
   * Set ONLY for a season that is running and measured in evenings.
   *
   * The hero line otherwise prints a date range, which for a rounds season is
   * an answer to a question nobody asked — the club is counting מחזורים, not
   * months, and the card on the club screen says so. Reported as "העונה
   * מוגדרת במחזורים ולא לפי תאריך".
   *
   * A CLOSED season deliberately has none: its dates are real and finished,
   * while `cadence` and `playedRounds` live on the live club document and
   * describe whatever season is running NOW — reading them for a sealed one
   * would print this season's progress over last season's heading.
   */
  roundsCadence?: { played: number; target: number };

  /**
   * EVENINGS (מחזורים) the club played this season — the context every rank
   * sits in, and the same number the club card, the history screen and the
   * poster all print for it.
   *
   * It used to be `totals.rounds`, the mini-game count, on the reasoning that
   * the live season could answer that one too. Both halves were wrong. The
   * archive carries a `completedRounds` of its own — the figure the club
   * watched all season and approved the close on — and it was never read by
   * anything, so the same sealed season read 22 on the history screen and 37
   * here. And a club on the plain timer records no mini-games at all, so the
   * line under its standing card said "0 משחקים שוחקו" for a season it had
   * played every week of. A running season answers from `seasons.playedRounds`,
   * the same mirror the card's progress comes from.
   */
  completedRounds: number;
  awardNotes?: Record<string, string>;
  me: PersonalSeason;
  club?: { numbers: SeasonClubNumbers; pairs: Record<string, PairTotals>; pairsComplete?: boolean; mostGoalsEvening?: EveningRecord | null; leaders: SeasonTitleAwarded[] };
  /** Display names for the handful of people the summary actually names. */
  names: Record<string, string>;
  /**
   * The face that goes with each of those names, where we have one.
   *
   * Kept beside `names` rather than folded into it because the share card
   * reads that map as plain strings. A RUNNING season already fetches the
   * whole user document to get the name and was throwing everything else
   * away, so all six peer rows drew the deterministic fallback disc while the
   * same six people show their own picture on every other screen in the app.
   *
   * A CLOSED season answers from its frozen roster, which stores a name and
   * nothing else — those rows keep the fallback, and that is the price of a
   * summary that still reads after somebody deletes their account.
   */
  peerAvatars: Record<string, { avatarId?: string; photoUrl?: string }>;
  /**
   * Titles this player took in this season, decided when it closed.
   *
   * Empty while a season is still running — the titles do not exist until the
   * numbers stop moving, and showing a provisional leader as a title holder
   * would be a promise the season has not made yet.
   */
  myTitles: SeasonTitleWon[];
  /**
   * Every title the season awarded, and who took it.
   *
   * The push sends every player who played to this screen, so it is where the
   * club actually gathers the day a season ends — and until now nine champions
   * were crowned in private, each told only about their own. Empty while a
   * season is still running.
   */
  seasonTitles: SeasonTitleAwarded[];
  /**
   * Every season this club has had, newest first.
   *
   * Derivable without a query: `count` seasons have closed, so they are s1..sN,
   * and `currentNo` is the one running. Seasons are wholly separate — each
   * closed one is its own frozen document and nothing is ever summed across
   * them — so the screen needs a way to move between them or the separation is
   * real but invisible.
   */
  available: SeasonChoice[];
}

const num = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : 0;
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Rows off `communityPlayerStats`, or off an archive's `players` map. */
function playerRow(x: Record<string, unknown>, uid: string): SeasonPlayerRow {
  return {
    userId: uid,
    displayName: str(x.displayName) || undefined,
    goals: num(x.goals),
    assists: num(x.assists),
    rounds: num(x.rounds),
    wins: num(x.wins),
    losses: num(x.losses),
    ties: num(x.ties),
    games: num(x.games),
    cleanSheets: num(x.cleanSheets),
    ownGoals: num(x.ownGoals),
    penTaken: num(x.penTaken),
    penScored: num(x.penScored),
    penSaved: num(x.penSaved),
    penFaced: num(x.penFaced),
    // Absent means the counter predates coverage tracking — fall back to
    // rounds rather than to zero, which would read as "never measured".
    csRounds: typeof x.csRounds === 'number' ? x.csRounds : undefined,
    asRounds: typeof x.asRounds === 'number' ? x.asRounds : undefined,
  };
}

function pairRow(x: Record<string, unknown>): SeasonPairRow | null {
  const a = str(x.a);
  const b = str(x.b);
  if (!a || !b) return null;
  return {
    a,
    b,
    sameTeam: num(x.sameTeam),
    against: num(x.against),
    winsTogether: num(x.winsTogether),
    lossesTogether: num(x.lossesTogether),
    cleanSheetsTogether: num(x.cleanSheetsTogether),
    winsA: num(x.winsA),
    winsB: num(x.winsB),
    assistsAToB: num(x.assistsAToB),
    assistsBToA: num(x.assistsBToA),
  };
}

/**
 * Which of the sealed titles are mine.
 *
 * A tie is shared by everyone on the top number, so a title can have several
 * holders; `sharedWith` counts the others. The duo title is held under a
 * joined `a__b` key, so membership is tested against its parts.
 */
function titlesFor(
  awards: Record<string, unknown> | undefined,
  me: string,
): SeasonTitleWon[] {
  if (!awards) return [];
  const out: SeasonTitleWon[] = [];
  for (const key of SEASON_TITLE_KEYS) {
    const a = awards[key] as { winners?: unknown; value?: unknown; valueUnit?: unknown } | null | undefined;
    if (!a || !Array.isArray(a.winners)) continue;
    const holders = a.winners.filter((w): w is string => typeof w === 'string' && !!w);
    if (!holders.length) continue;
    const mine = holders.some((w) => w === me || w.split('__').includes(me));
    if (!mine) continue;
    out.push({
      key,
      value: num(a.value),
      ...(a.valueUnit === 'percent' ? { valueUnit: 'percent' as const } : {}),
      sharedWith: Math.max(0, holders.length - 1),
      ...(readSeasonCoverage(a, me) ? { coverage: readSeasonCoverage(a, me) } : {}),
    });
  }
  return out;
}

/**
 * Every decided title, resolved to names off the archive's own frozen roster.
 *
 * The duo title is held under a joined key; both halves are looked up. A
 * winner with no row renders as a dash rather than an empty string, so a
 * missing name reads as deliberate.
 */
function allTitlesOf(
  awards: Record<string, unknown> | undefined,
  players: Record<string, Record<string, unknown>>,
  me: string,
): SeasonTitleAwarded[] {
  if (!awards) return [];
  const out: SeasonTitleAwarded[] = [];
  for (const key of SEASON_TITLE_KEYS) {
    const a = awards[key] as { winners?: unknown; value?: unknown; valueUnit?: unknown } | null | undefined;
    if (!a || !Array.isArray(a.winners) || a.winners.length === 0) continue;
    const holders = a.winners.filter((w): w is string => typeof w === 'string' && !!w);
    if (!holders.length) continue;
    out.push({
      key,
      names: holders.map((w) =>
        w
          .split('__')
          .map((uid) => str(players[uid]?.displayName) || '—')
          .join(' + '),
      ),
      winners: distinctSeasonWinners(holders).map(id => ({ id, name: str(players[id]?.displayName) || '—', ...(key === 'mvp' && readSeasonCoverage(a, id) ? { coverage: readSeasonCoverage(a, id) } : {}) })),
      value: num(a.value),
      ...(a.valueUnit === 'percent' ? { valueUnit: 'percent' as const } : {}),
      mine: holders.some((w) => w === me || w.split('__').includes(me)),
      ...(readSeasonCoverage(a) ? { coverage: readSeasonCoverage(a) } : {}),
    });
  }
  return out;
}

/** What a peer row needs to render: a name and, when there is one, a face. */
interface PeerIdentity {
  names: Record<string, string>;
  avatars: Record<string, { avatarId?: string; photoUrl?: string }>;
}

/**
 * Names and faces for the peers.
 *
 * A CLOSED season answers from its own archive, which froze the names at
 * closing time precisely so a summary still reads after somebody deletes their
 * account. Only a running season has to go to /users — and since that read is
 * being made anyway, it hands back the avatar as well. Keeping only `u.name`
 * off a whole user document was what left every row on a live season showing
 * the generic disc.
 */
async function resolvePeers(
  uids: string[],
  frozen: Map<string, string>,
): Promise<PeerIdentity> {
  const names: Record<string, string> = {};
  const avatars: Record<string, { avatarId?: string; photoUrl?: string }> = {};
  const missing: string[] = [];
  for (const uid of uids) {
    const f = frozen.get(uid);
    if (f) names[uid] = f;
    else missing.push(uid);
  }
  // Same public identity batch as the statistics screen; no private player reads.
  const users = await groupService.hydrateUsers(missing).catch(() => []);
  for (const u of users) {
    if (u.name) names[u.id] = u.name;
    if (u.avatarId || u.photoUrl) avatars[u.id] = {
      ...(u.avatarId ? { avatarId: u.avatarId } : {}),
      ...(u.photoUrl ? { photoUrl: u.photoUrl } : {}),
    };
  }
  return { names, avatars };
}


/** The club's seasons, newest first. `count` have closed; `currentNo` runs. */

export interface LoadSeasonArgs {
  groupId: string;
  userId: UserId;
  /** Omit for the season currently running. */
  seasonId?: string;
}

/**
 * Build the model from a sealed archive alone.
 *
 * Everything comes out of the document: the club's frozen name, the final
 * table, the pair counters and the decided titles. Nothing is re-read and
 * nothing is recomputed, which is what makes it work for someone who can no
 * longer read the club at all.
 */
function fromArchive(
  d: Record<string, unknown>,
  ctx: {
    groupId: string;
    userId: UserId;
    seasonId: string;
    seasons?: GroupSeasons;
  },
): SeasonSummaryModel {
  const playersMap = (d.players ?? {}) as Record<string, Record<string, unknown>>;
  const pairsMap = (d.pairs ?? {}) as Record<string, Record<string, unknown>>;
  const players = Object.entries(playersMap).map(([uid, x]) => playerRow(x, uid));
  const pairs: SeasonPairRow[] = [];
  for (const x of Object.values(pairsMap)) {
    // A season closed before the archive carried full pair counters stores a
    // bare number here. It cannot answer the people questions, and a bare
    // number is not a row — skip rather than invent zeroes.
    if (typeof x !== 'object' || x === null) continue;
    const row = pairRow(x);
    if (row) pairs.push(row);
  }
  const me = buildPersonalSeason({ me: ctx.userId, players, pairs });
  const frozen = new Map<string, string>();
  for (const [uid, x] of Object.entries(playersMap)) {
    const n = str(x.displayName);
    if (n) frozen.set(uid, n);
  }
  return {
    groupId: ctx.groupId,
    groupName: str(d.groupName),
    seasonId: str(d.seasonId) || ctx.seasonId,
    seasonNo: num(d.no),
    startsAt: num(d.startsAt),
    endsAt: num(d.endsAt) || null,
    closed: true,
    // The archive's own count of the season's evenings. It has been written
    // since the archive existed and read by nothing until now.
    completedRounds: num(d.completedRounds),
    me,
    club: {
      numbers: buildSeasonClubNumbers((d.totals ?? {}) as Record<string, unknown>, Object.values(playersMap), num(d.completedRounds)),
      pairs: seasonChemistryPairs(pairs),
      pairsComplete: Object.values(pairsMap).every(p => typeof p === 'object' && p !== null && !!pairRow(p)),
      leaders: [],
    },
    awardNotes: d.awardNotes as Record<string, string> | undefined,
    myTitles: titlesFor(d.awards as Record<string, unknown> | undefined, ctx.userId),
    seasonTitles: allTitlesOf(
      d.awards as Record<string, unknown> | undefined,
      playersMap,
      ctx.userId,
    ),
    // Names are already frozen in the archive; no /users read, which a player
    // outside the club may not be able to make anyway.
    // Only real names go in. An empty string is not nullish, so `names[uid] ??
    // '—'` at the render site accepted it and drew a blank where a name should
    // be; leaving the key out lets the dash do its job.
    names: Object.fromEntries(frozen),
    // The frozen roster keeps a name and nothing else, so these rows show the
    // deterministic disc. Going to /users for six faces would undo the one
    // property that makes this path work — it makes no club read at all, which
    // is why a player who has left can still open the season they played.
    peerAvatars: {},
    available: ctx.seasons
      ? seasonChoices(ctx.seasons)
      : [{ no: num(d.no), id: str(d.seasonId) || ctx.seasonId, closed: true }],
  };
}

export const seasonSummaryService = {
  /**
   * Build the model, or null when the club does not run seasons (or the
   * requested season was never archived).
   */
  async load({
    groupId,
    userId,
    seasonId,
  }: LoadSeasonArgs): Promise<SeasonSummaryModel | null | 'error'> {
    if (!groupId || !userId) return null;
    if (USE_MOCK_DATA) return mockSeasonSummary(groupId, userId, seasonId);
    try {
      const { db } = getFirebase();
      // A missing archive is denied by the real rules. A known current season
      // must go straight to live counters. Club access is optional here so a
      // former member can still read their frozen archive independently.
      let groupSnap: Awaited<ReturnType<typeof getDoc>> | undefined;
      if (seasonId) {
        try { groupSnap = await getDoc(doc(db, 'groups', groupId)); } catch { /* archive access is independent */ }
        const known = (groupSnap?.data() as { seasons?: GroupSeasons } | undefined)?.seasons;
        if (!(known?.enabled && known.currentId === seasonId)) {
        const archived = await getDoc(
          doc(db, 'seasonSummary', `${groupId}__${seasonId}`),
        );
        if (archived.exists() && !archived.data()?.publicationPending) {
          return fromArchive(await readSeasonArchiveData(db, archived.data() as Record<string, unknown>), {
            groupId,
            userId,
            seasonId,
            // Only a member can be offered the picker; for anyone else this
            // one season is the whole of what they may read.
            seasons: known,
          });
        }
        }
      }

      groupSnap ??= await getDoc(doc(db, 'groups', groupId));
      if (!groupSnap.exists()) return null;
      const g = groupSnap.data() as { name?: string; seasons?: GroupSeasons };
      const seasons = g.seasons;
      // Reaching here means no specific season was asked for, so the answer is
      // the RUNNING one — and a club with seasons switched off has none. A
      // closed season is served above, from its own archive, whether or not the
      // feature is still on.
      if (!seasons?.enabled || (seasonId && seasonId !== seasons.currentId)) return null;
      const groupName = str(g.name);

      // Reaching here means the running season: a specific one was either
      // served from its archive above or does not exist. The branch that used
      // to re-read the archive here was unreachable from the moment the
      // archive-first path landed, and a second implementation of "read a
      // sealed season" is exactly how the two drift.

      const [statRows, pairRows, clubRows] = await Promise.all([
        getDocs(query(collection(db, 'communityPlayerStats'), where('groupId', '==', groupId))),
        getDocs(query(collection(db, 'communityPairStats'), where('groupId', '==', groupId))),
        getDocs(query(collection(db, 'communityStats'), where('groupId', '==', groupId))),
      ]);
      const rawPlayers: Record<string, Record<string, unknown>> = {};
      const players: SeasonPlayerRow[] = [];
      statRows.forEach((d) => {
        const x = d.data() as Record<string, unknown>;
        const uid = str(x.userId);
        if (uid) { players.push(playerRow(x, uid)); rawPlayers[uid] = x; }
      });
      const pairs: SeasonPairRow[] = [];
      pairRows.forEach((d) => {
        const row = pairRow(d.data() as Record<string, unknown>);
        if (row) pairs.push(row);
      });
      const me = buildPersonalSeason({ me: userId, players, pairs });
      const peers = await resolvePeers(Object.keys(rawPlayers), new Map());
      for (const [id, name] of Object.entries(peers.names)) rawPlayers[id].displayName = name;
      const awards = computeSeasonAwards(Object.entries(rawPlayers).map(([uid, x]) => ({
        ...playerRow(x, uid), uid, games: num(x.games), rounds: num(x.rounds), goals: num(x.goals),
        assists: num(x.assists), wins: num(x.wins), cleanSheets: num(x.cleanSheets),
        penTaken: num(x.penTaken), penScored: num(x.penScored), penFaced: num(x.penFaced), penSaved: num(x.penSaved),
        ratedRounds: num(x.eveningScoreCount),
        mvpAvg: num(x.eveningScoreCount) > 0 ? num(x.eveningScoreSum) / num(x.eveningScoreCount) : 0,
      })), pairs.map(p => ({ a: p.a, b: p.b, score: num(p.assistsAToB) + num(p.assistsBToA), together: num(p.sameTeam) })), num(seasons.playedRounds));
      return {
        groupId,
        groupName,
        seasonId: seasons.currentId,
        seasonNo: num(seasons.currentNo),
        startsAt: num(seasons.startedAt),
        endsAt: null,
        closed: false,
        // The season's EVENINGS, off the mirror the seal increments — the very
        // number `roundsCadence` below shows as progress, so the hero line and
        // the line under the standing card can never say two different things
        // about the same season. This used to be a separate read of
        // `communityStats.rounds`, which is season-scoped but counts mini-games,
        // and is 0 for every club that plays on the plain timer. That read is
        // gone with it.
        completedRounds: num(seasons.playedRounds),
        // Exactly the derivation SeasonsCard uses, so the two surfaces cannot
        // drift into showing different progress for the same season.
        ...(seasons.cadence?.type === 'rounds' &&
        typeof seasons.cadence.targetRounds === 'number'
          ? {
              roundsCadence: {
                played: num(seasons.playedRounds),
                target: seasons.cadence.targetRounds,
              },
            }
          : {}),
        me,
        club: {
          numbers: buildSeasonClubNumbers(clubRows.docs[0]?.data() ?? {}, Object.values(rawPlayers), num(seasons.playedRounds)),
          pairs: seasonChemistryPairs(pairs),
          leaders: allTitlesOf({ ...awards, mvp: null }, rawPlayers, userId),
        },
        // A running season has no titles yet, by design.
        myTitles: [],
        seasonTitles: [],
        names: { ...Object.fromEntries(Object.entries(rawPlayers).filter(([, p]) => str(p.displayName)).map(([id, p]) => [id, str(p.displayName)])), ...peers.names },
        peerAvatars: peers.avatars,
        available: seasonChoices(seasons),
      };
    } catch (err) {
      logError('seasonSummaryLoad', err, { groupId, userId, seasonId: seasonId ?? '' });
      // NOT null. Null means "this club does not run seasons", and saying that
      // to somebody who just tapped a push about a season they played — because
      // their connection dropped for a second — is the worse of the two wrongs.
      return 'error';
    }
  },
};

/**
 * A believable season so the card can be worked on without a live club.
 *
 * TWO of them, and deliberately different: seasons are wholly separate records
 * and the picker has to be seen replacing every number on the screen. A mock
 * that answered the same thing for both would make a broken switch look fine.
 */
function mockSeasonSummary(
  groupId: string,
  userId: UserId,
  seasonId?: string,
): SeasonSummaryModel {
  const past = seasonId === 's1';
  const players: SeasonPlayerRow[] = past
    ? [
        // PARTIAL coverage on the reader's own row, deliberately: clean sheets
        // and assists both started being recorded after this club did, which
        // is the shape of every real veteran and the one that makes
        // cleanSheets/rounds disagree with the percentage beside it. Without
        // it the coverage note under the grid is unreachable in mock.
        { userId, games: 9, goals: 6, assists: 9, rounds: 22, wins: 9, losses: 11, ties: 2, cleanSheets: 4, csRounds: 17, asRounds: 19, ownGoals: 0, penTaken: 1, penScored: 0 },
        { userId: 'u_dani', games: 8, goals: 8, assists: 2, rounds: 24, wins: 13, losses: 9, ties: 2, cleanSheets: 6, csRounds: 24 },
        { userId: 'u_roi', games: 6, goals: 2, assists: 9, rounds: 20, wins: 11, losses: 7, ties: 2, cleanSheets: 5, csRounds: 20 },
        { userId: 'u_omer', games: 4, goals: 4, assists: 1, rounds: 12, wins: 5, losses: 6, ties: 1, cleanSheets: 2, csRounds: 12 },
      ]
    : [
        { userId, games: 12, goals: 14, assists: 9, rounds: 41, wins: 24, losses: 13, ties: 4, cleanSheets: 11, csRounds: 41, ownGoals: 1, penTaken: 4, penScored: 3 },
        { userId: 'u_dani', games: 13, goals: 19, assists: 4, rounds: 44, wins: 26, losses: 14, ties: 4, cleanSheets: 9, csRounds: 44 },
        { userId: 'u_roi', games: 11, goals: 6, assists: 12, rounds: 38, wins: 18, losses: 16, ties: 4, cleanSheets: 12, csRounds: 38 },
        { userId: 'u_omer', games: 9, goals: 11, assists: 7, rounds: 30, wins: 15, losses: 12, ties: 3, cleanSheets: 7, csRounds: 30 },
      ];
  const pairs: SeasonPairRow[] = past
    ? [
        { a: userId, b: 'u_dani', sameTeam: 15, against: 7, winsTogether: 9, lossesTogether: 4, cleanSheetsTogether: 3, winsA: 2, winsB: 5, assistsAToB: 2, assistsBToA: 1 },
        { a: userId, b: 'u_roi', sameTeam: 4, against: 16, winsTogether: 2, lossesTogether: 2, cleanSheetsTogether: 1, winsA: 6, winsB: 9, assistsAToB: 1, assistsBToA: 3 },
        { a: userId, b: 'u_omer', sameTeam: 6, against: 5, winsTogether: 3, lossesTogether: 2, cleanSheetsTogether: 1, winsA: 3, winsB: 2, assistsAToB: 0, assistsBToA: 1 },
      ]
    : [
        { a: userId, b: 'u_roi', sameTeam: 23, against: 18, winsTogether: 15, lossesTogether: 6, cleanSheetsTogether: 8, winsA: 11, winsB: 6, assistsAToB: 4, assistsBToA: 6 },
        { a: userId, b: 'u_dani', sameTeam: 9, against: 32, winsTogether: 5, lossesTogether: 3, cleanSheetsTogether: 2, winsA: 13, winsB: 18, assistsAToB: 1, assistsBToA: 2 },
        { a: userId, b: 'u_omer', sameTeam: 14, against: 15, winsTogether: 9, lossesTogether: 4, cleanSheetsTogether: 5, winsA: 10, winsB: 4, assistsAToB: 5, assistsBToA: 1 },
      ];
  const me = buildPersonalSeason({ me: userId, players, pairs });
  return {
    groupId,
    // The MOCK club's name, not a real one.
    //
    // This said 'שכחת שושי' — a real club, and the owner's own test club. Every
    // screenshot of this screen therefore showed a real club's name over
    // invented numbers, and the reasonable reading of that is "you reset my
    // season". Nothing had been touched; the name alone was enough to look
    // like it had. Mock data must never borrow a real name.
    groupName: 'חמישי כדורגל',
    seasonId: past ? 's1' : 's2',
    seasonNo: past ? 1 : 2,
    startsAt: Date.now() - 1000 * 60 * 60 * 24 * (past ? 420 : 150),
    endsAt: past ? Date.now() - 1000 * 60 * 60 * 24 * 160 : null,
    closed: past,
    // EVENINGS, and they have to sit above the biggest `games` in the rows
    // above (9 and 13) — a season the club played fewer nights of than one of
    // its members attended is not a season anyone can have.
    completedRounds: past ? 11 : 15,
    me,
    club: {
      numbers: buildSeasonClubNumbers({ rounds: past ? 32 : 58, goals: past ? 24 : 50, ownGoals: past ? 0 : 1 }, players.map(p => ({ ...p })), past ? 11 : 15),
      pairs: seasonChemistryPairs(pairs),
      mostGoalsEvening: { key: 'goals', value: past ? 7 : 11, gameId: 'mock-season-evening', at: Date.now() - 86400000 * (past ? 200 : 20), holders: ['mock-season-evening'] },
      leaders: past ? [] : [
        { key: 'topScorer', names: ['דני'], winners: [{id: 'u_dani', name: 'דני'}], value: 19, mine: false },
        { key: 'topAssister', names: ['רועי'], winners: [{id: 'u_roi', name: 'רועי'}], value: 12, mine: false },
        { key: 'topWinner', names: ['דני'], winners: [{id: 'u_dani', name: 'דני'}], value: 59.09, valueUnit: 'percent', mine: false },
        { key: 'mostLoyal', names: ['דני'], winners: [{id: 'u_dani', name: 'דני'}], value: 13, mine: false },
        { key: 'cleanSheetKing', names: ['רועי'], winners: [{id: 'u_roi', name: 'רועי'}], value: 12, mine: false },
      ],
    },
    myTitles: past
      ? [
          { key: 'topAssister', value: 9, sharedWith: 1 },
          // The number a title was won on must be the number the rest of the
          // card shows. A mock that contradicts itself teaches the next person
          // to read past exactly the contradiction it exists to catch.
          { key: 'mostLoyal', value: 9, sharedWith: 0 },
          { key: 'deadlyDuo', value: 4, sharedWith: 0 },
        ]
      : [],
    seasonTitles: past
      ? [
          { key: 'topScorer', names: ['דני'], winners: [{id: 'u_dani', name: 'דני'}], value: 8, mine: false },
          { key: 'topAssister', names: ['רועי', 'אני'], winners: [{id: 'u_roi', name: 'רועי'}, {id: userId, name: 'אני'}], value: 9, mine: true },
          { key: 'mostLoyal', names: ['אני'], winners: [{id: userId, name: 'אני'}], value: 9, mine: true },
          { key: 'topWinner', names: ['דני'], winners: [{id: 'u_dani', name: 'דני'}], value: 13, mine: false },
          { key: 'cleanSheetKing', names: ['דני'], winners: [{id: 'u_dani', name: 'דני'}], value: 6, mine: false },
          { key: 'deadlyDuo', names: ['אני + רועי'], winners: [{id: userId, name: 'אני'}, {id: 'u_roi', name: 'רועי'}], value: 4, mine: true },
        ]
      : [],
    names: { [userId]: 'אני', u_dani: 'דני', u_roi: 'רועי', u_omer: 'עומר' },
    // A face on every peer row, because the fallback disc is what the bug
    // looked like — a mock that hands back no avatar cannot tell the two
    // apart. Empty for the closed season, which is what the frozen archive
    // really answers.
    peerAvatars: past
      ? {}
      : { u_dani: { avatarId: 'a03' }, u_roi: { avatarId: 'a09' }, u_omer: { avatarId: 'a11' } },
    available: [
      { no: 2, id: 's2', closed: false },
      { no: 1, id: 's1', closed: true },
    ],
  };
}
