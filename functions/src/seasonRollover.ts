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
import { computeSeasonAwards } from './seasonAwards';

/** A per-game identity with no account. See the archive note below. */
const isReal = (id: string): boolean => !!id && !id.startsWith('guest:');

/**
 * Ceiling on archived pairs, so one document cannot grow past Firestore's 1MB
 * limit and make the club permanently unable to close a season.
 *
 * Pairs grow as n(n-1)/2 over REAL members: 60 players is 1,770 entries at
 * roughly 140 bytes each, about 250KB. 4,000 is a 90-player club and still
 * inside half the limit — far beyond any real club, and a hard stop rather
 * than a silent failure if one ever gets there.
 */
const MAX_ARCHIVED_PAIRS = 4000;

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
  /** Set when an admin ended it early rather than it running its course. */
  endedEarly?: boolean;
  closedBy?: string;
  closedByName?: string;
  originalTarget?: { type: string; endsAt?: number; targetRounds?: number };
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

  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

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
        const n = (d.data() as { name?: string; displayName?: string } | undefined);
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
    const row: Record<string, number | string | boolean> = {};
    for (const f of PLAYER_SEASON_FIELDS) row[f] = num(x[f]);
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
    (a, p) => a + num(p.assists), 0);
  totals.cleanSheets = Object.values(players).reduce(
    (a, p) => a + num(p.cleanSheets), 0);

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
    if (Object.keys(pairs).length >= MAX_ARCHIVED_PAIRS) {
      droppedOverflowPairs += 1;
      continue;
    }
    // Sorted key, and the archived a/b sorted WITH it — the direction of
    // `winsA` and `assistsAToB` is meaningless unless the reader knows which
    // player is which, and the live document's own a/b need not be sorted.
    const [lo, hi] = [a, b].sort();
    const flip = lo !== a;
    pairs[`${lo}__${hi}`] = {
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

  if (droppedGuestPairs > 0 || droppedOverflowPairs > 0) {
    // Never silent. A dropped pair is a fact about the archive, and the
    // overflow case in particular should never happen for a real club.
    console.log(
      `[season] archive pairs: kept ${Object.keys(pairs).length}, ` +
        `dropped ${droppedGuestPairs} guest, ${droppedOverflowPairs} over cap`,
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
    score: p.assists,
    together: p.sameTeam,
  }));
  const awards = computeSeasonAwards(
    awardLines,
    awardPairs,
    args.completedRounds,
  );
  /** Set when we are resuming a close that died before it finished. */
  let resumedAwards: typeof awards | null = null;

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
      completedRounds: args.completedRounds,
      ...(args.endedEarly ? { endedEarly: true } : {}),
      ...(args.closedBy ? { closedBy: args.closedBy } : {}),
      ...(args.closedByName ? { closedByName: args.closedByName } : {}),
      ...(args.originalTarget ? { originalTarget: args.originalTarget } : {}),
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

  // ── 2. Only now, zero ───────────────────────────────────────────────────
  // Absolute writes, so a retry converges instead of drifting. Chunked well
  // under the 500-operation ceiling.
  const zeroPlayer: Record<string, number> = {};
  for (const f of PLAYER_SEASON_FIELDS) zeroPlayer[f] = 0;

  let batch = db.batch();
  let ops = 0;
  const flush = async () => {
    if (ops === 0) return;
    await batch.commit();
    batch = db.batch();
    ops = 0;
  };

  for (const d of psSnap.docs) {
    batch.set(d.ref, { ...zeroPlayer, updatedAt: now }, { merge: true });
    if (++ops >= 400) await flush();
  }
  for (const d of pairSnap.docs) {
    batch.set(
      d.ref,
      {
        assists: 0,
        sameTeam: 0,
        winsTogether: 0,
        lossesTogether: 0,
        cleanSheetsTogether: 0,
        against: 0,
        winsA: 0,
        winsB: 0,
        assistsAToB: 0,
        assistsBToA: 0,
        updatedAt: now,
      },
      { merge: true },
    );
    if (++ops >= 400) await flush();
  }
  await flush();

  const zeroClub: Record<string, number> = {};
  for (const f of CLUB_SEASON_FIELDS) zeroClub[f] = 0;
  await db.collection('communityStats').doc(groupId).set(
    {
      ...zeroClub,
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
};
