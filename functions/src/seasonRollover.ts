// Closing a season: archive, then zero. Never delete, never on a clock.
//
// This is the only destructive path in the app that runs unattended, so the
// shape matters more than the code:
//
//   1. Build the archive in memory from the live documents.
//   2. `create()` it. If it already exists the create fails with
//      ALREADY_EXISTS and we stop — that single call is the whole
//      idempotency story, and it is the same trick the round-commit latch
//      uses. A redelivered event cannot archive a second time, and cannot
//      archive the zeroes it wrote on the first pass.
//   3. ONLY once the archive has landed, zero the live rows.
//
// Ordering is not a preference. If step 3 ran first, or if the archive were
// built by re-reading after a partial wipe, a retry would seal a season of
// zeros over the real one and there would be nothing left to recover from.
//
// The zeroing names its fields. A blanket overwrite of these documents would
// also destroy `bestEvening` (a PERSONAL high-water mark that happens to live
// on a club document), `lastEveningScore`, and `kingGoalsSum`/`kingGoalsCount`
// — the running benchmark the evening score is measured against. Resetting
// that last one would make the first top scorer of the new season a perfect
// 10 by construction and inflate everyone's score by about a quarter of the
// scale, silently.

import * as admin from 'firebase-admin';
import { countSeasonParticipants } from './seasonParticipants';
import { computeSeasonAwards } from './seasonAwards';

/** A per-game identity with no account. See the archive note below. */
const isReal = (id: string): boolean => !!id && !id.startsWith('guest:');

// ─── The arithmetic, pulled out where a test can reach it ──────────────────
//
// Everything below is pure, and every one of it used to be an inline loop
// inside a function that only runs against a live Firestore. A close is
// irreversible — the archive is written with create(), the rows are wound back
// by subtraction — and the hourly sweep performs one unattended; between them
// they had no functional test at all, only a list of field names. These are
// the number choices those two paths make, extracted verbatim so they can be
// pinned in tests/logic/seasonCloseNumbers.test.ts without an emulator.

const rowNum = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : 0;

/**
 * What a row holds after its season has been taken out of it.
 *
 * SUBTRACT what was archived; do not write zeroes. The rows are read at the
 * top of the close and wiped at the end of it, so a mini-game committed in
 * between is not in the archive — an absolute zero would erase it from the
 * live table too and it would then exist nowhere, with nothing to detect it.
 * Subtracting leaves exactly that evening behind as the next season's opening
 * balance, which is where it belongs.
 *
 * `archived` of null means "this row belongs to no season": a pair past the
 * archive cap, which is zeroed rather than carried into the next season.
 *
 * Clamped at zero, so a row that somehow holds less than the archive took from
 * it lands on zero rather than on a negative goal tally.
 */
export function windBackRow(
  current: Record<string, unknown> | undefined,
  archived: Record<string, unknown> | null | undefined,
  fields: readonly string[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of fields) {
    out[f] = archived
      ? Math.max(0, rowNum(current?.[f]) - rowNum(archived[f]))
      : 0;
  }
  return out;
}

/**
 * What a row holds once an undone season is given back to it.
 *
 * ADD, for the same reason the wind-back subtracts: an evening played between
 * the close and the undo keeps its own contribution instead of being
 * overwritten by a snapshot of the past. Which is why both halves are behind a
 * per-row stamp — addition is not idempotent either.
 */
export function restoreRow(
  current: Record<string, unknown> | undefined,
  archived: Record<string, unknown> | undefined,
  fields: readonly string[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of fields) out[f] = rowNum(current?.[f]) + rowNum(archived?.[f]);
  return out;
}

/**
 * The archive's key for a pair, and whether the live document's a/b are the
 * wrong way round for it.
 *
 * The directional counters — `winsA`, `assistsAToB` — are meaningless unless
 * the reader knows which player is which, and the live document's own a/b need
 * not be sorted. One key, derived one way, used by the wipe and by the restore
 * alike: if these two ever disagreed, a reopen would restore chemistry onto a
 * pair that never played.
 */
export function seasonPairKey(
  a: string,
  b: string,
): { key: string; lo: string; hi: string; flip: boolean } {
  const [lo, hi] = [a, b].sort();
  return { key: `${lo}__${hi}`, lo, hi, flip: lo !== a };
}

/**
 * The number the TITLES are decided against.
 *
 * The most evenings any ONE player attended — deliberately not the season's
 * length. Per-player `games` has been counted since 22.06 and the season's
 * length comes from a counter born on 25.08, so comparing a numerator from one
 * era against a denominator from the other is not a comparison at all: on the
 * club the gate was calibrated against it admitted 25 of 29 players to a gate
 * meant to admit 13, including seven who turned up twice.
 *
 * A season with no players at all falls back to whatever the caller knew.
 */
export function awardsDenominatorOf(
  attendances: readonly number[],
  fallback: number,
): number {
  if (attendances.length === 0) return Math.max(0, rowNum(fallback));
  return Math.max(0, ...attendances.map((g) => rowNum(g)));
}

/**
 * The "N מחזורים" the hall of fame prints for a sealed season.
 *
 * The season's LENGTH, which is not the awards denominator: the card carries
 * both and they differ by three on the one real club. A resume reads it back
 * off the archive the first pass already wrote — the protected record — rather
 * than re-deriving it from rows that pass may have half-wiped.
 */
export function sealedCardEvenings(
  fromArchive: unknown,
  completedRounds: unknown,
  awardsDenominator: number,
): number {
  if (typeof fromArchive === 'number') return fromArchive;
  if (typeof completedRounds === 'number' && completedRounds > 0) {
    return completedRounds;
  }
  return awardsDenominator;
}

/**
 * Ceiling on archived pairs, so one document cannot grow past Firestore's 1MB
 * limit and make the club permanently unable to close a season.
 *
 * The earlier figure of 4,000 was arithmetic done too fast. An entry is a
 * 45-character key plus two uids plus ten numbers, and Firestore charges for
 * every field name: call it 250-300 bytes, so 4,000 is about 1.1MB on its own
 * — over the limit before the players map is added. 1,200 is roughly 350KB and
 * leaves room for everything else.
 *
 * It is not a tight bound in practice, because only pairs that actually played
 * this season are archived at all: a 50-player club has 1,225 possible pairs
 * and nothing like that many turn out together in one season.
 */
const MAX_ARCHIVED_PAIRS = 1200;

/** Club-scoped counters a season owns. Everything not named here survives. */
const PLAYER_SEASON_FIELDS = [
  'goals',
  'assists',
  'rounds',
  'wins',
  'losses',
  'ties',
  'games',
  'cleanSheets',
  'ownGoals',
  'penTaken',
  'penScored',
  'penMissed',
  'penFaced',
  'penSaved',
  'penConceded',
  // Coverage denominators reset with their numerators, or the new season's
  // rates would divide this season's handful of clean sheets by a career.
  'csRounds',
  'asRounds',
  // The season's evening-score mean, as sum and count. The MVP title is the
  // highest AVERAGE this season, so both halves must reset together: keeping
  // the sum across a rollover would carry last season's evenings into this
  // season's average, and keeping only one of the two produces a mean that is
  // not a mean at all.
  'eveningScoreSum',
  'eveningScoreCount',
] as const;

/**
 * The pair counters a season owns.
 *
 * Named in one place because the close and the reopen have to agree exactly:
 * anything the wipe clears and the restore misses is chemistry destroyed with
 * no way back, since the archive is deleted at the end of the reopen.
 */
const PAIR_SEASON_FIELDS = [
  'assists',
  'sameTeam',
  'winsTogether',
  'lossesTogether',
  'cleanSheetsTogether',
  'against',
  'winsA',
  'winsB',
  'assistsAToB',
  'assistsBToA',
] as const;

/** The same, for the club total document. */
const CLUB_SEASON_FIELDS = [
  'rounds',
  'goals',
  'guestGoals',
  'ownGoals',
  'tiedRounds',
  'shootoutRounds',
  'scorelessRounds',
] as const;

/** One pair's frozen season counters. Mirrors `communityPairStats`, with a/b
 *  normalised to sorted order so the directional fields can be read. */
export interface SeasonPairArchive {
  a: string;
  b: string;
  sameTeam: number;
  against: number;
  winsTogether: number;
  lossesTogether: number;
  cleanSheetsTogether: number;
  winsA: number;
  winsB: number;
  assistsAToB: number;
  assistsBToA: number;
  assists: number;
}

export interface RolloverArgs {
  db: admin.firestore.Firestore;
  groupId: string;
  seasonId: string;
  seasonNo: number;
  startsAt: number;
  completedRounds: number;
  /** Frozen onto each winner's title, so it still reads after a rename. */
  groupName?: string;
  /** Where this season started counting evenings. Sealed so a season that is
   *  reopened can be given back its own offset rather than a guess. */
  roundsAtStart?: number;
  /** Set when an admin ended it early rather than it running its course. */
  endedEarly?: boolean;
  closedBy?: string;
  closedByName?: string;
  originalTarget?: { type: string; endsAt?: number; targetRounds?: number };
  /**
   * Every time an admin moved this season's finish line.
   *
   * The club block's copy is reset to `[]` the moment the next season opens,
   * so a close that does not seal it destroys the only record that the line
   * ever moved. The one club that has run seasons went 22 → 2 → 24 and just
   * the last of those three survives anywhere — which is exactly the history
   * somebody would want when asking why a season ended when it did.
   */
  targetHistory?: unknown[];
  /** Season 1 of a club that predates a metric — see the spec. */
  partialData?: boolean;
  now: number;
}

export interface RolloverResult {
  /** False when the archive already existed: a redelivery, already done. */
  archived: boolean;
  players: number;
  pairs: number;
}

/**
 * Close one season.
 *
 * The caller is responsible for having checked that the club is quiet —
 * no open game, nothing unsealed. This function does not re-check, because
 * the decision belongs with the trigger that knows why it is running.
 */
export async function closeSeason(args: RolloverArgs): Promise<RolloverResult> {
  const { db, groupId, seasonId, now } = args;

  const [psSnap, csSnap, pairSnap] = await Promise.all([
    db.collection('communityPlayerStats').where('groupId', '==', groupId).get(),
    db.collection('communityStats').doc(groupId).get(),
    db.collection('communityPairStats').where('groupId', '==', groupId).get(),
  ]);

  const num = (v: unknown) =>
    typeof v === 'number' && Number.isFinite(v) ? v : 0;

  const uids: string[] = [];
  for (const d of psSnap.docs) {
    const uid = (d.data() as { userId?: string }).userId;
    if (typeof uid === 'string' && uid) uids.push(uid);
  }

  // Names are FETCHED here, not read off the stat row.
  //
  // `communityPlayerStats` carries no name — the table resolves one per row
  // from /users at render time. Freezing `x.displayName` therefore froze an
  // empty string for every player, which a dry run against the real club
  // caught: 29 of 29 rows blank. That would have defeated the whole point of
  // freezing, which is that a sealed table still reads after somebody deletes
  // their account (the deletion anonymises /users to "משתמש שהוסר", and a
  // missing document renders as a dash).
  //
  // One read per player, once per season. getAll batches them.
  const nameByUid = new Map<string, string>();
  if (uids.length) {
    const refs = uids.map((u) => db.collection('users').doc(u));
    for (let i = 0; i < refs.length; i += 300) {
      const docs = await db.getAll(...refs.slice(i, i + 300));
      for (const d of docs) {
        const n = d.data() as
          { name?: string; displayName?: string } | undefined;
        const name = n?.name ?? n?.displayName;
        if (typeof name === 'string' && name) nameByUid.set(d.id, name);
      }
    }
  }

  const players: Record<string, Record<string, number | string | boolean>> = {};
  for (const d of psSnap.docs) {
    const x = d.data() as Record<string, unknown>;
    const uid = typeof x.userId === 'string' ? x.userId : '';
    if (!uid) continue;
    // A row with nothing in it is not a participant.
    //
    // Nothing deletes a communityPlayerStats row when somebody leaves a club,
    // so after one close every ex-member is sitting there wound back to zeros
    // — and archiving them made each one a key in EVERY future season. That
    // inflated the archive, miscounted the card, and (because the read rule
    // admits anyone in the map) let a long-departed member open seasons they
    // were never part of.
    //
    // `games` as well as `rounds`: somebody who turned up and never got on the
    // pitch still played no mini-games, and was still there.
    if (num(x.rounds) === 0 && num(x.games) === 0) continue;
    const row: Record<string, number | string | boolean> = {};
    for (const f of PLAYER_SEASON_FIELDS) {
      // ABSENT is not zero for the two coverage denominators.
      //
      // They say how many rounds a metric could be measured over, and they
      // arrived later than the metrics they divide. Writing 0 for a season
      // that predates them tells the reader "measured across zero rounds",
      // which is indistinguishable from a real zero and defeats the fallback
      // the reader has for exactly this case — the same mistake that made the
      // club's clean-sheet percentage read ten points low for every veteran.
      if ((f === 'csRounds' || f === 'asRounds') && typeof x[f] !== 'number') {
        continue;
      }
      row[f] = num(x[f]);
    }
    row.displayName = nameByUid.get(uid) ?? '';
    players[uid] = row;
  }

  const cs = (csSnap.exists ? csSnap.data() : {}) as Record<string, unknown>;
  const totals: Record<string, number> = {};
  for (const f of CLUB_SEASON_FIELDS) totals[f] = num(cs[f]);
  // Neither of these has a club counter; the screen sums them from the member
  // rows. Store them explicitly or they become underivable once the rows are
  // zeroed.
  totals.assists = Object.values(players).reduce(
    (a, p) => a + num(p.assists),
    0,
  );
  totals.cleanSheets = Object.values(players).reduce(
    (a, p) => a + num(p.cleanSheets),
    0,
  );

  // The pair counters are archived IN FULL, not as one number.
  //
  // This used to store `assists` alone. That was not enough for anything that
  // reads the archive afterwards: the deadly-duo title needs how many rounds
  // the two actually played side by side, and the personal season summary is
  // built almost entirely out of these counters — who I played beside most,
  // who I faced most, who I beat most. Zeroed live rows cannot answer any of
  // that, so a season that closed would have taken its own story with it.
  //
  // Size: pairs grow as n(n-1)/2. A 30-player club is 435 entries and roughly
  // 60KB; sixty players is 1,770 and about 240KB, still well inside the 1MB
  // document limit. Written once per season.
  const pairs: Record<string, SeasonPairArchive> = {};
  let droppedGuestPairs = 0;
  let droppedEmptyPairs = 0;
  let droppedOverflowPairs = 0;
  for (const d of pairSnap.docs) {
    const x = d.data() as Record<string, unknown>;
    const a = typeof x.a === 'string' ? x.a : '';
    const b = typeof x.b === 'string' ? x.b : '';
    if (!a || !b) continue;
    // Guests do not go into the archive, and this is the difference between a
    // season that can close and one that eventually cannot.
    //
    // The chemistry engine counts guests on purpose — they were on the pitch
    // and the pass was real — but a guest id is minted fresh for every game, so
    // `communityPairStats` accumulates a permanent new pair for every stranger
    // who ever turned out. Copying all of them into ONE document means the
    // archive grows without bound, and the first season that pushes it past
    // Firestore's 1MB limit cannot be written at all: the club could never
    // close another season, ever.
    //
    // Nothing downstream wants them either. The personal summary filters
    // guests out by hand, and the duo title needs both halves past the
    // eligibility gate, which a player with no account can never be.
    if (!isReal(a) || !isReal(b)) {
      droppedGuestPairs += 1;
      continue;
    }
    // A pair that did nothing this season is not part of this season.
    //
    // Nothing deletes a pair document — the close winds it back to zero — so
    // after one season every pair the club has EVER fielded is sitting there
    // at zero, and archiving them all made the document grow with the club's
    // whole history instead of with the season. Same shape as the empty player
    // rows above.
    const playedTogether =
      num(x.sameTeam) + num(x.against) + num(x.assists) +
      num(x.assistsAToB) + num(x.assistsBToA);
    if (playedTogether === 0) {
      droppedEmptyPairs += 1;
      continue;
    }
    if (Object.keys(pairs).length >= MAX_ARCHIVED_PAIRS) {
      droppedOverflowPairs += 1;
      continue;
    }
    // Sorted key, and the archived a/b sorted WITH it — the direction of
    // `winsA` and `assistsAToB` is meaningless unless the reader knows which
    // player is which, and the live document's own a/b need not be sorted.
    const { key: pairId, lo, hi, flip } = seasonPairKey(a, b);
    pairs[pairId] = {
      a: lo,
      b: hi,
      sameTeam: num(x.sameTeam),
      against: num(x.against),
      winsTogether: num(x.winsTogether),
      lossesTogether: num(x.lossesTogether),
      cleanSheetsTogether: num(x.cleanSheetsTogether),
      winsA: num(flip ? x.winsB : x.winsA),
      winsB: num(flip ? x.winsA : x.winsB),
      assistsAToB: num(flip ? x.assistsBToA : x.assistsAToB),
      assistsBToA: num(flip ? x.assistsAToB : x.assistsBToA),
      // The legacy, undirected metric. Kept because it counts a WIDER window
      // than the fields above (see the note on rollUpClubPairs) and the club
      // chemistry card still quotes it.
      assists: num(x.assists),
    };
  }

  if (droppedGuestPairs > 0 || droppedEmptyPairs > 0 || droppedOverflowPairs > 0) {
    // Never silent. A dropped pair is a fact about the archive, and the
    // overflow case in particular should never happen for a real club.
    console.log(
      `[season] archive pairs: kept ${Object.keys(pairs).length}, ` +
        `dropped ${droppedGuestPairs} guest, ${droppedEmptyPairs} empty, ` +
        `${droppedOverflowPairs} over cap`,
      groupId,
      seasonId,
    );
  }

  // ── The titles ──────────────────────────────────────────────────────────
  //
  // Decided HERE, from the numbers as they stand, and sealed into the archive
  // with them. The end-season dialog has been telling admins that titles are
  // awarded; until now nothing computed them, and the promise was empty.
  //
  // `completedRounds` is the season's finished-round count and it is the
  // denominator of both gates (turn up for half the season; take enough
  // penalties for a rate to mean anything). It comes from the sealed-evening
  // counter rather than a query, because deleting a game decrements nothing.
  const awardLines = Object.entries(players).map(([uid, row]) => ({
    uid,
    // Evenings attended, which is what the eligibility gate and the loyalty
    // title are measured in — the season's own length is a count of evenings.
    games: num(row.games),
    rounds: num(row.rounds),
    goals: num(row.goals),
    assists: num(row.assists),
    wins: num(row.wins),
    cleanSheets: num(row.cleanSheets),
    // The season's mean evening score. Absent until the accumulator that feeds
    // it has been live for a season, and 0 keeps that player out of the MVP
    // running rather than handing them the title on an empty number.
    mvpAvg:
      num(row.eveningScoreCount) > 0
        ? num(row.eveningScoreSum) / num(row.eveningScoreCount)
        : 0,
    penTaken: num(row.penTaken),
    penScored: num(row.penScored),
    penFaced: num(row.penFaced),
    penSaved: num(row.penSaved),
  }));
  const awardPairs = Object.values(pairs).map((p) => ({
    a: p.a,
    b: p.b,
    // DIRECTIONAL assists, both ways, not the legacy `assists` counter.
    //
    // Two reasons. The legacy field covers a wider window than the directional
    // ones (see the note on the archive above), so it is not a season number at
    // all. And the club's chemistry card already crowns a "הצמד הקטלני"
    // computed exactly this way — two surfaces wearing the same Hebrew name
    // must not name two different pairs.
    score: p.assistsAToB + p.assistsBToA,
    together: p.sameTeam,
  }));
  // The season's length, derived from the SAME counter the gate compares
  // against — and this is not a nicety, it is the difference between the gate
  // working and not.
  //
  // `args.completedRounds` comes from `clubRecords.eveningsSealed`, which has
  // only been written since 25.08. Per-player `games` has been counted since
  // 22.06. So the numerator carries two extra months the denominator does not,
  // and the two are not comparable at all. Measured on the real club the gate
  // was calibrated against: 13 evenings played, eveningsSealed 3, threshold 2,
  // and 25 of 29 players clear a gate meant to admit 13 — including seven who
  // turned up twice. Exactly the failure the units fix already corrected once,
  // reintroduced through the other side of the division.
  //
  // The most evenings any one player attended is in the same unit and the same
  // era as every number it will be compared with. On that same club it gives
  // 12 → threshold 6 → 13 eligible, which is the calibration the design
  // documents. It can only under-count when nobody attended every evening,
  // and under-counting a gate makes it stricter, not looser.
  const seasonEvenings = awardsDenominatorOf(
    awardLines.map((l) => l.games),
    args.completedRounds,
  );
  const awards = computeSeasonAwards(awardLines, awardPairs, seasonEvenings);
  /** Set when we are resuming a close that died before it finished. */
  let resumedAwards: typeof awards | null = null;
  let resumedPlayers: typeof players | null = null;
  let resumedTotals: Record<string, number> | null = null;
  let resumedEvenings: unknown = null;

  // ── 1. Archive, exactly once ────────────────────────────────────────────
  const summaryRef = db
    .collection('seasonSummary')
    .doc(`${groupId}__${seasonId}`);
  try {
    await summaryRef.create({
      groupId,
      // Frozen, like the player names. A closed season has to be readable by
      // someone who has since LEFT the club — they played in it — and they
      // cannot read /groups to find out what it was called.
      groupName: args.groupName ?? '',
      seasonId,
      no: args.seasonNo,
      startsAt: args.startsAt,
      endsAt: now,
      closedAt: now,
      // How long the season WAS — the figure the club watched all season and
      // approved the close on.
      //
      // This used to store `seasonEvenings`, which is the awards DENOMINATOR:
      // the most evenings any one player attended. That is the right number to
      // judge a title against (see the long note above) and the wrong one to
      // publish as the season's length — yet the history screen prints it as
      // "N מחזורים", and the reopen restores the season from it. A club shown
      // "22 מתוך 22" all season found 19 in its archive, and an admin who
      // pressed undo watched 23 evenings come back as 1.
      //
      // The denominator is kept beside it, so the hall of fame can still say
      // what a title was decided on without the two being the same field.
      // Falls back to the denominator only when the caller knew nothing.
      completedRounds:
        typeof args.completedRounds === 'number' && args.completedRounds > 0
          ? args.completedRounds
          : seasonEvenings,
      awardsDenominator: seasonEvenings,
      roundsAtStartOfSeason: args.roundsAtStart ?? 0,
      ...(args.endedEarly ? { endedEarly: true } : {}),
      ...(args.closedBy ? { closedBy: args.closedBy } : {}),
      ...(args.closedByName ? { closedByName: args.closedByName } : {}),
      ...(args.originalTarget ? { originalTarget: args.originalTarget } : {}),
      // Omitted when empty so an untouched season carries no field at all,
      // which is how a reader tells "never moved" from "moved and lost".
      ...(Array.isArray(args.targetHistory) && args.targetHistory.length > 0
        ? { targetHistory: args.targetHistory }
        : {}),
      ...(args.partialData ? { partialData: true } : {}),
      totals,
      players,
      pairs,
      awards,
    });
  } catch (err) {
    const code = (err as { code?: number | string }).code;
    if (code !== 6 && code !== 'already-exists') throw err;

    // The archive already exists. That means one of two very different things,
    // and treating them the same was a permanent data bug.
    //
    // If the first pass FINISHED, the live rows now belong to the season that
    // opened after this one and must not be touched — returning here is the
    // whole idempotency story, and it is why the archive can never be sealed
    // over a table of zeroes.
    //
    // But if the first pass DIED between the archive landing and the zeroing,
    // the old behaviour left the club permanently half-closed: the season was
    // sealed, the titles were never written, the table was never reset, and
    // every retry took this same early exit. The next season then inherited
    // the last one's totals, for good.
    //
    // `zeroedAt` is the marker that tells them apart. It is stamped only after
    // the wipe, so its absence means "resume", and everything after this point
    // is an absolute write that converges on a retry.
    const existing = await summaryRef.get();
    if (existing.get('zeroedAt')) {
      console.log('[season] already closed — skip', groupId, seasonId);
      return { archived: false, players: 0, pairs: 0 };
    }
    console.warn(
      '[season] archive exists but the wipe never finished — resuming',
      groupId,
      seasonId,
    );
    // Decided titles come from the ARCHIVE on this path, never recomputed: the
    // live rows may be half-zeroed by the pass that died, and a title decided
    // from those would be a different title from the one already sealed.
    resumedAwards = (existing.get('awards') ?? null) as typeof awards | null;
    // The ROWS come from the archive too, for the same reason the titles do.
    //
    // Without this the resume path had nothing safe to build the card from, so
    // it skipped the card entirely — and if the pass that died never got as
    // far as writing one, the season stayed sealed in the archive and absent
    // from the hall of fame for ever. The archive is protected by create() and
    // holds the frozen names and totals, so a card built from it is the same
    // card the first pass would have written.
    resumedPlayers = (existing.get('players') ?? null) as typeof players | null;
    resumedTotals = (existing.get('totals') ?? null) as Record<
      string,
      number
    > | null;
    resumedEvenings = existing.get('completedRounds');
  }

  // ── 1a. A compact card for the list ─────────────────────────────────────
  //
  // The archive is the record and it is BIG: every player's row, every pair's
  // ten counters, for every season. The hall of fame shows a date, three
  // numbers and nine names — and was pulling the whole thing, for every season
  // the club has ever played, to print them. A five-season, sixty-player club
  // is well over a megabyte down a phone connection to render one screen.
  //
  // So the close also writes what that screen actually needs, with the winners
  // already resolved to the names frozen in the archive. Same source, same
  // moment, no second version of the truth: the card is derived from the
  // archive it is written beside, and reopenSeason deletes both.
  //
  // On the RESUME path it is skipped entirely. `players`, `totals` and `awards`
  // above were built from live rows that the pass which died may have already
  // half-wiped, so rewriting the card from them would replace a correct sealed
  // record with a wrong one — the archive is protected by create(), the card
  // was not.
  const cardWinners: Array<{ key: string; names: string[]; value: number }> =
    [];
  for (const [key, award] of Object.entries(resumedAwards ?? awards)) {
    if (!award || !award.winners.length) continue;
    cardWinners.push({
      key,
      names: award.winners.map((w) =>
        w
          .split('__')
          .map(
            (uid) =>
              String((resumedPlayers ?? players)[uid]?.displayName ?? '') ||
              '—',
          )
          .join(' + '),
      ),
      value: award.value,
    });
  }
  // Written on BOTH paths now.
  //
  // It used to be skipped whenever the close was resuming, because the live
  // rows it was built from may have been half-wiped by the pass that died. But
  // if that pass never reached the card, skipping meant the season stayed in
  // the archive and out of the hall of fame permanently — sealed and invisible.
  // The resume now builds it from the ARCHIVE instead, which is the protected
  // record, so the card it writes is the card the first pass would have
  // written. `merge: true` makes re-writing an existing one a no-op in effect.
  {
    const cardPlayers = resumedPlayers ?? players;
    const cardTotals = resumedTotals ?? totals;
    // The same figure the archive stores, for the same reason: the card is
    // what the hall of fame prints as "N מחזורים", and that has to be the
    // season's length rather than its best single attendance record. On a
    // resume it comes from the archive the first pass already wrote.
    const cardEvenings = sealedCardEvenings(
      resumedEvenings,
      args.completedRounds,
      seasonEvenings,
    );
    await db
      .collection('seasonCards')
      .doc(`${groupId}__${seasonId}`)
      .set(
        {
          groupId,
          seasonId,
          no: args.seasonNo,
          startsAt: args.startsAt,
          endsAt: now,
          completedRounds: cardEvenings,
          totals: {
            rounds: cardTotals.rounds ?? 0,
            goals: cardTotals.goals ?? 0,
            assists: cardTotals.assists ?? 0,
          },
          // Only people who actually played — counted on EVENINGS attended,
          // with mini-games as a fallback.
          //
          // This used to count `rounds > 0` alone, which is mini-games. A club
          // that runs the plain live screen never records a single one: that
          // screen is a clock, and mini-games only exist in advanced mode. So
          // every season such a club ever closed reported "0 שחקנים" in its
          // hall of fame, no matter how many people turned up all year.
          // Caught on the QA club, whose evenings were timer-only.
          //
          // `games` is the right signal for "took part", and it is the one the
          // evening-played rules now make reliable: it only counts an evening
          // that actually happened. `rounds` stays in the test as a safety net
          // for a row credited a mini-game without an evening.
          players: countSeasonParticipants(cardPlayers),
          // The number the TITLES were decided against.
          //
          // It is not `completedRounds`, and it is not meant to be: the gate
          // is measured in per-player `games`, which is a different counter
          // over a different era from the season's length (see the long note
          // above `seasonEvenings`). It was written to the archive for exactly
          // this reason — "so the hall of fame can still say what a title was
          // decided on" — and then never put on the card, which is the only
          // document the hall of fame reads. So the medal graded מלך ההתמדה's
          // 19 against a season of 22 and drew gold for perfect attendance,
          // making platinum structurally unreachable.
          awardsDenominator: seasonEvenings,
          ...(args.endedEarly ? { endedEarly: true } : {}),
          ...(args.partialData ? { partialData: true } : {}),
          winners: cardWinners,
        },
        { merge: true },
      );
  }

  // ── 1b. The titles onto their winners' profiles ─────────────────────────
  //
  // Written only AFTER the archive has landed, and outside its create() latch
  // on purpose: the archive is the record, and a title is a copy of it placed
  // where a player will actually look. If this half fails the season is still
  // correctly sealed and the titles are still readable from the archive.
  //
  // Each title doc is keyed by club+season+title so a redelivery overwrites
  // rather than duplicates, and it FREEZES the club's name: the title belongs
  // to the player for good, including after they leave the club or the club is
  // renamed, and a live lookup would then render it as a dash.
  const groupName = args.groupName ?? '';
  let titleBatch = db.batch();
  let titleOps = 0;
  const flushTitles = async () => {
    if (titleOps === 0) return;
    await titleBatch.commit();
    titleBatch = db.batch();
    titleOps = 0;
  };
  for (const [titleKey, award] of Object.entries(resumedAwards ?? awards)) {
    if (!award) continue; // "not awarded" is a result, not a gap.
    for (const winner of award.winners) {
      // The duo title is held by a PAIR, under a joined key. It belongs on
      // both profiles, not on a player who does not exist.
      for (const uid of winner.split('__')) {
        if (!uid || uid.startsWith('guest:')) continue;
        titleBatch.set(
          db
            .collection('users')
            .doc(uid)
            .collection('seasonTitles')
            .doc(`${groupId}__${seasonId}__${titleKey}`),
          {
            groupId,
            groupName,
            seasonId,
            seasonNo: args.seasonNo,
            titleKey,
            value: award.value,
            at: now,
          },
          { merge: true },
        );
        if (++titleOps >= 400) await flushTitles();
      }
    }
  }
  await flushTitles();

  // ── 2. Only now, wind the rows back ─────────────────────────────────────
  //
  // SUBTRACT what was archived; do not write zeroes.
  //
  // The rows were read at the top of this function and the wipe happens here.
  // A mini-game committed in between — `clubIsQuiet` makes it unlikely, not
  // impossible — is not in the archive, and an absolute zero would erase it
  // from the live table too. It would exist nowhere, with nothing to detect it.
  // Subtracting leaves exactly that evening behind as the new season's opening
  // balance, which is where it belongs.
  //
  // Subtraction is not idempotent, so each row carries a stamp naming the
  // season it was wound back for, and the whole thing runs in a transaction
  // per row: a retry — including the resume path above — sees the stamp and
  // skips. Once per player per season, so the cost is a few dozen transactions
  // a year for a club.
  for (const d of psSnap.docs) {
    const archivedRow = players[(d.data() as { userId?: string }).userId ?? ''];
    if (!archivedRow) continue;
    await db.runTransaction(async (tx) => {
      const fresh = await tx.get(d.ref);
      if (!fresh.exists) return;
      const data = fresh.data() as Record<string, unknown>;
      if (data.seasonWoundBack === seasonId) return; // already done
      const patch: Record<string, unknown> = {
        seasonWoundBack: seasonId,
        // Cleared so a LATER reopen can stamp its own restore.
        //
        // The pair wipe and the club wipe below have always done this; the
        // player rows — the one class that holds goals, assists, rounds, wins
        // and the evening-score mean — did not, and that asymmetry was silent
        // and permanent. Close s1, reopen it, play on, close it again, then
        // reopen once more: reopenSeason's per-row guard sees the stamp its
        // OWN first restore left behind and returns for every player, so club
        // totals and pair chemistry come back while every player's season
        // stays at zero. The archive is deleted on the way out, so the two can
        // never be reconciled again.
        seasonReopened: admin.firestore.FieldValue.delete(),
        updatedAt: now,
      };
      Object.assign(patch, windBackRow(data, archivedRow, PLAYER_SEASON_FIELDS));
      tx.set(d.ref, patch, { merge: true });
    });
  }

  let batch = db.batch();
  let ops = 0;
  let deletedGuestPairs = 0;
  const flush = async () => {
    if (ops === 0) return;
    await batch.commit();
    batch = db.batch();
    ops = 0;
  };
  // Pair rows are wound back the same way the player rows are, and for the same
  // reason: an evening committed between the read and the wipe would otherwise
  // be erased from both the archive and the live table.
  //
  // A pair with no archived row — one past the cap — is set to zero rather than
  // skipped: it belongs to no season, and leaving it standing would carry it
  // into the next one. A GUEST pair is deleted outright; see below.
  for (const d of pairSnap.docs) {
    const x = d.data() as Record<string, unknown>;
    // A guest pair is DELETED, not wound back.
    //
    // A guest id is minted fresh for every game, so this collection gains a
    // permanent new document for every stranger who ever turns out, and until
    // now nothing had ever removed one. Measured on the seven-player club that
    // has actually run a season: 314 pair documents, 293 of them guest pairs —
    // 93% of what every close reads, and the archive keeps none of them
    // (`isReal` drops them above, and the log for that real close reads "kept
    // 0, dropped 293 guest, 21 empty"). At roughly 45 pair documents per player
    // a sixty-player club is about 2,700 reads per close, in the sweep that
    // runs LAST inside cronEvery60Min's shared 540-second budget.
    //
    // Nothing is lost that the wind-back was not already destroying: the branch
    // this replaces wrote a zero into every counter of exactly these documents.
    // Deleting is the same erasure, and it is the only version of it that does
    // not leave the row behind to be read again by every close after this one.
    //
    // Before the stamp check on purpose, so a resumed close still clears them.
    if (!isReal(String(x.a ?? '')) || !isReal(String(x.b ?? ''))) {
      batch.delete(d.ref);
      deletedGuestPairs += 1;
      if (++ops >= 400) await flush();
      continue;
    }
    // Already wound back for this season — skip.
    //
    // The player rows carry this stamp and the pair rows did not, so the two
    // halves of one operation behaved differently on a resume: the player kept
    // the two goals he scored between the crash and the retry, and the pair
    // lost that whole evening's chemistry, because subtracting the archived
    // row a second time clamps at zero. The stamp is read off the snapshot
    // taken at the top of this function, which on a retry already reflects the
    // first pass — no transaction needed, since the quiet check and the
    // create() latch serialise the close.
    if (x.seasonWoundBack === seasonId) continue;
    const { key } = seasonPairKey(String(x.a ?? ''), String(x.b ?? ''));
    // A pair with no archived row — one past the cap — is zeroed rather than
    // subtracted: it belongs to no season, and leaving it standing would carry
    // it into the next one.
    const archivedPair = (pairs[key] ?? null) as unknown as
      Record<string, number> | null;
    batch.set(
      d.ref,
      {
        ...windBackRow(x, archivedPair, PAIR_SEASON_FIELDS),
        seasonWoundBack: seasonId,
        // Cleared so a later reopen can stamp its own restore.
        seasonReopened: admin.firestore.FieldValue.delete(),
        updatedAt: now,
      },
      { merge: true },
    );
    if (++ops >= 400) await flush();
  }
  await flush();
  if (deletedGuestPairs > 0) {
    // Never silent, same rule as the archive's own drop log: this is the one
    // place in the app that removes a document rather than winding it back.
    console.log(
      `[season] pair wipe: ${deletedGuestPairs} guest pair doc(s) deleted`,
      groupId,
      seasonId,
    );
  }

  const zeroClub: Record<string, number> = {};
  for (const f of CLUB_SEASON_FIELDS) zeroClub[f] = 0;
  await db
    .collection('communityStats')
    .doc(groupId)
    .set(
      {
        ...zeroClub,
        // Cleared so a later reopen can stamp its own restore.
        seasonReopened: admin.firestore.FieldValue.delete(),
        // Re-stamped, or the new season's chemistry card would date itself from
        // the old one. It is only advanced when absent or earlier, so leaving it
        // alone would quietly keep the stale window.
        chemistrySince: now,
        updatedAt: now,
      },
      { merge: true },
    );

  // Only now. Everything above is repeatable; this says it does not need to be.
  await summaryRef.set({ zeroedAt: Date.now() }, { merge: true });

  return {
    archived: true,
    players: psSnap.size,
    pairs: pairSnap.size,
  };
}

/** Exported for the test that pins the reset list against silent growth. */
export const __seasonFields = {
  player: PLAYER_SEASON_FIELDS,
  club: CLUB_SEASON_FIELDS,
  // Pinned for the same reason as the other two, and with more at stake: a
  // counter missing from this list is cleared by the close and never restored
  // by the reopen, and the archive that held it is deleted at the end of the
  // reopen. There is no way back from a gap here.
  pair: PAIR_SEASON_FIELDS,
};

/**
 * Undo a season that was closed by mistake.
 *
 * The one thing the close deliberately has no path back from, which is exactly
 * why it needs one: past the seven-day PITR window a wrong close is permanent,
 * and an admin who ends a season a week early has no way to say so.
 *
 * It is the wind-back in reverse, and it is only safe because of how the close
 * was built:
 *
 *   • The archive holds every number as it stood, so the live rows are restored
 *     by ADDING back exactly what was subtracted — a round played since the
 *     close keeps its own contribution instead of being overwritten.
 *   • Each row's `seasonWoundBack` stamp is cleared in the same transaction, so
 *     the row is once again eligible to be wound back when the season is
 *     properly closed later.
 *   • The titles are keyed by club+season+title, so they are deleted exactly.
 *   • The archive is removed LAST. While it exists the operation is repeatable
 *     from the top; once it is gone there is nothing left to repeat.
 *
 * The caller is responsible for restoring the club's `seasons` block — this
 * function owns the numbers, not the lifecycle.
 */
export async function reopenSeason(args: {
  db: admin.firestore.Firestore;
  groupId: string;
  seasonId: string;
}): Promise<{ reopened: boolean; players: number; titles: number }> {
  const { db, groupId, seasonId } = args;
  const summaryRef = db
    .collection('seasonSummary')
    .doc(`${groupId}__${seasonId}`);
  const snap = await summaryRef.get();
  if (!snap.exists) return { reopened: false, players: 0, titles: 0 };

  const data = snap.data() as Record<string, unknown>;
  const players = (data.players ?? {}) as Record<
    string,
    Record<string, unknown>
  >;
  const totals = (data.totals ?? {}) as Record<string, unknown>;
  const awards = (data.awards ?? {}) as Record<
    string,
    { winners?: unknown } | null
  >;
  // 1. Give every player their season back.
  let restored = 0;
  for (const [uid, row] of Object.entries(players)) {
    const ref = db.collection('communityPlayerStats').doc(`${groupId}__${uid}`);
    await db.runTransaction(async (tx) => {
      const fresh = await tx.get(ref);
      const cur = (fresh.exists ? fresh.data() : {}) as Record<string, unknown>;
      // The restore is an ADDITION, and the only thing that makes the whole
      // operation non-repeatable — the archive delete — happens at the very
      // end. So a crash anywhere before it, followed by a retry, would give
      // the club a second copy of the whole season. Same latch the pair rows
      // carry; cleared by the next close.
      if (cur.seasonReopened === seasonId) return;
      const patch: Record<string, unknown> = {
        groupId,
        userId: uid,
        seasonReopened: seasonId,
        seasonWoundBack: admin.firestore.FieldValue.delete(),
        updatedAt: Date.now(),
      };
      Object.assign(patch, restoreRow(cur, row, PLAYER_SEASON_FIELDS));
      tx.set(ref, patch, { merge: true });
    });
    restored += 1;
  }

  // 1b. And every pair its chemistry.
  //
  // The close zeroes communityPairStats — who played beside whom, who beat
  // whom, who set up whom — and reopening restored the player rows and the club
  // totals and left those at zero. A club that undid a mistaken close lost its
  // entire chemistry history, permanently, with no archive to recover from
  // because the archive is deleted at the end of this very function.
  //
  // Same shape as the player rows: ADD back what was sealed, in a transaction,
  // behind a stamp so a retry cannot double it.
  const archivedPairs = (data.pairs ?? {}) as Record<
    string,
    Record<string, unknown>
  >;
  for (const [key, row] of Object.entries(archivedPairs)) {
    if (typeof row !== 'object' || row === null) continue;
    const a = typeof row.a === 'string' ? row.a : '';
    const b = typeof row.b === 'string' ? row.b : '';
    if (!a || !b) continue;
    const ref = db.collection('communityPairStats').doc(`${groupId}__${key}`);
    await db.runTransaction(async (tx) => {
      const fresh = await tx.get(ref);
      const cur = (fresh.exists ? fresh.data() : {}) as Record<string, unknown>;
      if (cur.seasonReopened === seasonId) return;
      tx.set(
        ref,
        {
          groupId,
          a,
          b,
          seasonReopened: seasonId,
          // Cleared, or the next close would think this pair had already been
          // wound back and skip it.
          seasonWoundBack: admin.firestore.FieldValue.delete(),
          updatedAt: Date.now(),
          ...restoreRow(cur, row, PAIR_SEASON_FIELDS),
        },
        { merge: true },
      );
    });
  }

  // Every OTHER pair the close stamped still carries it.
  //
  // The wipe stamps `seasonWoundBack` on every pair row it touches — including
  // the ones it zeroes rather than subtracts, which is every guest pair and
  // every pair the archive dropped for being empty. The restore above only
  // reaches pairs that are IN the archive, so the rest keep a stamp naming a
  // season that is running again.
  //
  // The next close of that same season then reads its own stamp on those rows
  // and skips the wind-back entirely, while still archiving them — so the
  // chemistry is sealed into the archive AND left standing live, and the
  // following season opens holding the previous one's pairings.
  //
  // Measured on the one club that has ever run seasons: all 314 pair rows
  // carried `seasonWoundBack: 's2'` while s2 was the running season. 293 of
  // them are guest pairs, which are never archived, so this is not an edge
  // case — after any reopen it is most of the collection.
  let stale = 0;
  const stamped = await db
    .collection('communityPairStats')
    .where('groupId', '==', groupId)
    .where('seasonWoundBack', '==', seasonId)
    .get();
  let clearBatch = db.batch();
  let clearOps = 0;
  for (const d of stamped.docs) {
    clearBatch.set(
      d.ref,
      { seasonWoundBack: admin.firestore.FieldValue.delete() },
      { merge: true },
    );
    stale += 1;
    if (++clearOps >= 400) {
      await clearBatch.commit();
      clearBatch = db.batch();
      clearOps = 0;
    }
  }
  if (clearOps > 0) await clearBatch.commit();
  if (stale > 0) {
    console.log('[season] reopen cleared stale pair stamps', groupId, seasonId, stale);
  }

  // 2. And the club its totals — behind the same latch, since this also adds.
  const clubRef = db.collection('communityStats').doc(groupId);
  await db.runTransaction(async (tx) => {
    const fresh = await tx.get(clubRef);
    const cur = (fresh.exists ? fresh.data() : {}) as Record<string, unknown>;
    if (cur.seasonReopened === seasonId) return;
    tx.set(
      clubRef,
      {
        seasonReopened: seasonId,
        updatedAt: Date.now(),
        ...restoreRow(cur, totals, CLUB_SEASON_FIELDS),
      },
      { merge: true },
    );
  });

  // 3. Take the titles back off the winners' profiles. A title for a season
  //    that no longer exists is worse than no title.
  let titles = 0;
  let batch = db.batch();
  let ops = 0;
  for (const [titleKey, award] of Object.entries(awards)) {
    if (!award || !Array.isArray(award.winners)) continue;
    for (const winner of award.winners) {
      if (typeof winner !== 'string') continue;
      for (const uid of winner.split('__')) {
        if (!uid || !isReal(uid)) continue;
        batch.delete(
          db
            .collection('users')
            .doc(uid)
            .collection('seasonTitles')
            .doc(`${groupId}__${seasonId}__${titleKey}`),
        );
        titles += 1;
        if (++ops >= 400) {
          await batch.commit();
          batch = db.batch();
          ops = 0;
        }
      }
    }
  }
  if (ops > 0) await batch.commit();

  // 4. The list card goes with its archive — one without the other is a
  //    season that shows in the hall of fame and cannot be opened.
  await db.collection('seasonCards').doc(`${groupId}__${seasonId}`).delete();

  // 5. Last, because while it exists this is repeatable.
  await summaryRef.delete();
  return { reopened: true, players: restored, titles };
}
