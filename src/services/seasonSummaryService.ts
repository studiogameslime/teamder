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
import { logError } from '@/services/errorLog';
import { userService } from '@/services/userService';
import {
  buildPersonalSeason,
  type PersonalSeason,
  type SeasonPairRow,
  type SeasonPlayerRow,
} from '@/utils/seasonPersonal';
import type { GroupSeasons, SeasonTitleKey, UserId } from '@/types';
import { SEASON_TITLE_KEYS } from '@/utils/seasonAwards';

/** A title this player holds in the season being shown. */
export interface SeasonTitleWon {
  key: SeasonTitleKey;
  /** The number it was won on: 31 goals, 8.37 average, 62% saved. */
  value: number;
  /** Other holders — ties are shared, never broken. */
  sharedWith: number;
}

/** A title the season awarded, with the names of everyone holding it. */
export interface SeasonTitleAwarded {
  key: SeasonTitleKey;
  names: string[];
  value: number;
  /** Whether the reader is one of the holders — the row is highlighted. */
  mine: boolean;
}

/** One season the club has, for the picker. */
export interface SeasonChoice {
  no: number;
  id: string;
  /** False for the one still running. */
  closed: boolean;
}

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
   * MINI-GAMES the club played this season — the context every rank sits in.
   *
   * Not the same counter as a rounds-cadence target, which counts sealed
   * EVENINGS. The archive happens to carry both; this reads the one the live
   * season can also answer, so the number means one thing on both paths.
   */
  completedRounds: number;
  me: PersonalSeason;
  /** Display names for the handful of people the summary actually names. */
  names: Record<string, string>;
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
    const a = awards[key] as { winners?: unknown; value?: unknown } | null | undefined;
    if (!a || !Array.isArray(a.winners)) continue;
    const holders = a.winners.filter((w): w is string => typeof w === 'string');
    const mine = holders.some((w) => w === me || w.split('__').includes(me));
    if (!mine) continue;
    out.push({ key, value: num(a.value), sharedWith: Math.max(0, holders.length - 1) });
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
    const a = awards[key] as { winners?: unknown; value?: unknown } | null | undefined;
    if (!a || !Array.isArray(a.winners) || a.winners.length === 0) continue;
    const holders = a.winners.filter((w): w is string => typeof w === 'string');
    out.push({
      key,
      names: holders.map((w) =>
        w
          .split('__')
          .map((uid) => str(players[uid]?.displayName) || '—')
          .join(' + '),
      ),
      value: num(a.value),
      mine: holders.some((w) => w === me || w.split('__').includes(me)),
    });
  }
  return out;
}

/** Every uid the finished summary actually names — nothing more is fetched. */
function namedUids(me: PersonalSeason): string[] {
  const out = new Set<string>();
  for (const peer of [
    me.partner,
    me.nemesis,
    me.victim,
    me.tormentor,
    me.assistedMost,
    me.assistedBy,
  ]) {
    if (peer) out.add(peer.userId);
  }
  return [...out];
}

/**
 * Names for the peers.
 *
 * A CLOSED season answers from its own archive, which froze the names at
 * closing time precisely so a summary still reads after somebody deletes their
 * account. Only a running season has to go to /users.
 */
async function resolveNames(
  uids: string[],
  frozen: Map<string, string>,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const missing: string[] = [];
  for (const uid of uids) {
    const f = frozen.get(uid);
    if (f) out[uid] = f;
    else missing.push(uid);
  }
  await Promise.all(
    missing.map(async (uid) => {
      try {
        const u = await userService.getUserById(uid);
        if (u?.name) out[uid] = u.name;
      } catch {
        // A name we cannot resolve renders as a dash; it must not take the
        // whole summary down with it.
      }
    }),
  );
  return out;
}


/** The club's seasons, newest first. `count` have closed; `currentNo` runs. */
function seasonChoices(seasons: GroupSeasons): SeasonChoice[] {
  const out: SeasonChoice[] = [
    { no: seasons.currentNo, id: seasons.currentId, closed: false },
  ];
  for (let no = seasons.count; no >= 1; no -= 1) {
    // A club that enabled, disabled and re-enabled keeps numbering, so the
    // current season's number can be higher than count + 1. Skip anything that
    // would duplicate the running one.
    if (no === seasons.currentNo) continue;
    out.push({ no, id: `s${no}`, closed: true });
  }
  return out;
}

export interface LoadSeasonArgs {
  groupId: string;
  userId: UserId;
  /** Omit for the season currently running. */
  seasonId?: string;
}

/** The club's season block, or undefined when we may not read the club. */
async function readSeasons(
  db: ReturnType<typeof getFirebase>['db'],
  groupId: string,
): Promise<GroupSeasons | undefined> {
  try {
    const snap = await getDoc(doc(db, 'groups', groupId));
    const g = snap.exists() ? (snap.data() as { seasons?: GroupSeasons }) : undefined;
    return g?.seasons;
  } catch {
    // A player who left the club cannot read it. That is not an error here —
    // it only means they get this one season rather than a picker.
    return undefined;
  }
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
  const totals = (d.totals ?? {}) as Record<string, unknown>;
  return {
    groupId: ctx.groupId,
    groupName: str(d.groupName),
    seasonId: str(d.seasonId) || ctx.seasonId,
    seasonNo: num(d.no),
    startsAt: num(d.startsAt),
    endsAt: num(d.endsAt) || null,
    closed: true,
    completedRounds: num(totals.rounds),
    me,
    myTitles: titlesFor(d.awards as Record<string, unknown> | undefined, ctx.userId),
    seasonTitles: allTitlesOf(
      d.awards as Record<string, unknown> | undefined,
      playersMap,
      ctx.userId,
    ),
    // Names are already frozen in the archive; no /users read, which a player
    // outside the club may not be able to make anyway.
    names: Object.fromEntries(
      namedUids(me).map((uid) => [uid, frozen.get(uid) ?? '']),
    ),
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
  }: LoadSeasonArgs): Promise<SeasonSummaryModel | null> {
    if (!groupId || !userId) return null;
    if (USE_MOCK_DATA) return mockSeasonSummary(groupId, userId, seasonId);
    try {
      const { db } = getFirebase();
      // The ARCHIVE is tried first when a specific season was asked for.
      //
      // A player who has since left the club can still be pushed the summary
      // of a season they played, and they cannot read /groups any more. Going
      // to the club document first would deny them their own season — so a
      // closed season is served from its own sealed record, which carries the
      // club's name and everything else it needs.
      if (seasonId) {
        const archived = await getDoc(
          doc(db, 'seasonSummary', `${groupId}__${seasonId}`),
        );
        if (archived.exists()) {
          return fromArchive(archived.data() as Record<string, unknown>, {
            groupId,
            userId,
            seasonId,
            // Only a member can be offered the picker; for anyone else this
            // one season is the whole of what they may read.
            seasons: await readSeasons(db, groupId),
          });
        }
      }

      const groupSnap = await getDoc(doc(db, 'groups', groupId));
      if (!groupSnap.exists()) return null;
      const g = groupSnap.data() as { name?: string; seasons?: GroupSeasons };
      const seasons = g.seasons;
      // Reaching here means no specific season was asked for, so the answer is
      // the RUNNING one — and a club with seasons switched off has none. A
      // closed season is served above, from its own archive, whether or not the
      // feature is still on.
      if (!seasons?.enabled) return null;
      const groupName = str(g.name);

      const wantClosed = !!seasonId && seasonId !== seasons.currentId;
      if (wantClosed) {
        const snap = await getDoc(
          doc(db, 'seasonSummary', `${groupId}__${seasonId}`),
        );
        if (!snap.exists()) return null;
        const d = snap.data() as Record<string, unknown>;
        const playersMap = (d.players ?? {}) as Record<string, Record<string, unknown>>;
        const pairsMap = (d.pairs ?? {}) as Record<string, Record<string, unknown>>;
        const players = Object.entries(playersMap).map(([uid, x]) => playerRow(x, uid));
        const pairs: SeasonPairRow[] = [];
        for (const x of Object.values(pairsMap)) {
          // A season closed before the archive carried full pair counters
          // stores a bare number here. It cannot answer the people questions,
          // and a bare number is not a row — skip rather than invent zeroes.
          if (typeof x !== 'object' || x === null) continue;
          const row = pairRow(x);
          if (row) pairs.push(row);
        }
        const me = buildPersonalSeason({ me: userId, players, pairs });
        const frozen = new Map<string, string>();
        for (const [uid, x] of Object.entries(playersMap)) {
          const n = str(x.displayName);
          if (n) frozen.set(uid, n);
        }
        return {
          groupId,
          groupName,
          seasonId: str(d.seasonId) || seasonId!,
          seasonNo: num(d.no),
          startsAt: num(d.startsAt),
          endsAt: num(d.endsAt) || null,
          closed: true,
          // totals.rounds, not the top-level completedRounds: that one counts
          // sealed evenings and would silently change units when a season
          // closed.
          completedRounds: num(
            (d.totals as Record<string, unknown> | undefined)?.rounds,
          ),
          me,
          myTitles: titlesFor(d.awards as Record<string, unknown> | undefined, userId),
          seasonTitles: allTitlesOf(
            d.awards as Record<string, unknown> | undefined,
            playersMap,
            userId,
          ),
          names: await resolveNames(namedUids(me), frozen),
          available: seasonChoices(seasons),
        };
      }

      const [statRows, pairRows] = await Promise.all([
        getDocs(query(collection(db, 'communityPlayerStats'), where('groupId', '==', groupId))),
        getDocs(query(collection(db, 'communityPairStats'), where('groupId', '==', groupId))),
      ]);
      const players: SeasonPlayerRow[] = [];
      statRows.forEach((d) => {
        const x = d.data() as Record<string, unknown>;
        const uid = str(x.userId);
        if (uid) players.push(playerRow(x, uid));
      });
      const pairs: SeasonPairRow[] = [];
      pairRows.forEach((d) => {
        const row = pairRow(d.data() as Record<string, unknown>);
        if (row) pairs.push(row);
      });
      const me = buildPersonalSeason({ me: userId, players, pairs });
      // The club's finished rounds this season. `communityStats.rounds` is
      // zeroed by the same rollover, so it is already season-scoped.
      const clubSnap = await getDoc(doc(db, 'communityStats', groupId));
      return {
        groupId,
        groupName,
        seasonId: seasons.currentId,
        seasonNo: num(seasons.currentNo),
        startsAt: num(seasons.startedAt),
        endsAt: null,
        closed: false,
        completedRounds: num(clubSnap.data()?.rounds),
        me,
        // A running season has no titles yet, by design.
        myTitles: [],
        seasonTitles: [],
        names: await resolveNames(namedUids(me), new Map()),
        available: seasonChoices(seasons),
      };
    } catch (err) {
      logError('seasonSummaryLoad', err, { groupId, userId, seasonId: seasonId ?? '' });
      return null;
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
        { userId, goals: 6, assists: 3, rounds: 22, wins: 9, losses: 11, ties: 2, cleanSheets: 4, csRounds: 22, ownGoals: 0, penTaken: 1, penScored: 0 },
        { userId: 'u_dani', goals: 8, assists: 2, rounds: 24, wins: 13, losses: 9, ties: 2, cleanSheets: 6, csRounds: 24 },
        { userId: 'u_roi', goals: 2, assists: 9, rounds: 20, wins: 11, losses: 7, ties: 2, cleanSheets: 5, csRounds: 20 },
        { userId: 'u_omer', goals: 4, assists: 1, rounds: 12, wins: 5, losses: 6, ties: 1, cleanSheets: 2, csRounds: 12 },
      ]
    : [
        { userId, goals: 14, assists: 9, rounds: 41, wins: 24, losses: 13, ties: 4, cleanSheets: 11, csRounds: 41, ownGoals: 1, penTaken: 4, penScored: 3 },
        { userId: 'u_dani', goals: 19, assists: 4, rounds: 44, wins: 26, losses: 14, ties: 4, cleanSheets: 9, csRounds: 44 },
        { userId: 'u_roi', goals: 6, assists: 12, rounds: 38, wins: 18, losses: 16, ties: 4, cleanSheets: 12, csRounds: 38 },
        { userId: 'u_omer', goals: 11, assists: 7, rounds: 30, wins: 15, losses: 12, ties: 3, cleanSheets: 7, csRounds: 30 },
      ];
  const pairs: SeasonPairRow[] = past
    ? [
        { a: userId, b: 'u_dani', sameTeam: 15, against: 7, winsTogether: 7, lossesTogether: 6, cleanSheetsTogether: 3, winsA: 2, winsB: 5, assistsAToB: 2, assistsBToA: 1 },
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
    groupName: 'שכחת שושי',
    seasonId: past ? 's1' : 's2',
    seasonNo: past ? 1 : 2,
    startsAt: Date.now() - 1000 * 60 * 60 * 24 * (past ? 420 : 150),
    endsAt: past ? Date.now() - 1000 * 60 * 60 * 24 * 160 : null,
    closed: past,
    completedRounds: past ? 26 : 48,
    me,
    myTitles: past
      ? [
          { key: 'topAssister', value: 3, sharedWith: 1 },
          { key: 'mostLoyal', value: 22, sharedWith: 0 },
        ]
      : [],
    seasonTitles: past
      ? [
          { key: 'topScorer', names: ['דני'], value: 8, mine: false },
          { key: 'topAssister', names: ['רועי', 'אני'], value: 3, mine: true },
          { key: 'mostLoyal', names: ['אני'], value: 22, mine: true },
          { key: 'cleanSheetKing', names: ['עומר'], value: 6, mine: false },
          { key: 'deadlyDuo', names: ['דני + רועי'], value: 5, mine: false },
        ]
      : [],
    names: { u_dani: 'דני', u_roi: 'רועי', u_omer: 'עומר' },
    available: [
      { no: 2, id: 's2', closed: false },
      { no: 1, id: 's1', closed: true },
    ],
  };
}
