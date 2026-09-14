// Run:  cd functions && npx tsc -p tsconfig.json
//       firebase emulators:start --only firestore --project seasons-rollover
//       node --test seasonRollover.emulator.test.mjs
//
// closeSeason against a real Firestore, because the things most likely to go
// wrong are not logic — they are ORDER and REDELIVERY, and neither shows up in
// a unit test with a mocked database.
//
// Four properties, in the order they matter:
//
//   1. The archive is a faithful copy of the live table taken BEFORE the wipe.
//   2. The wipe zeroes the competition and nothing else. bestEvening,
//      lastEveningScore and the king benchmark all sit on the very documents
//      being reset, and losing them is silent: the round summary would
//      re-announce old numbers as new personal records, and the first top
//      scorer of the new season would be a perfect 10 by construction.
//   3. A second run does NOT re-archive. This is the redelivery case — Cloud
//      Functions are at-least-once — and without the create() latch the second
//      pass would seal the zeroes its own first pass just wrote, over the real
//      season, with nothing left to recover from.
//   4. chemistrySince is re-stamped, because it is only ever moved forward
//      when absent or earlier; leaving it would date the new season's pair
//      window from the old one.
//
// Runs against the emulator with the Admin SDK talking to it, so this is the
// real client library and the real batching, not a stub.

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import admin from 'firebase-admin';

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';

const GID = 'club1';
const SEASON = 's1';

let db;
let closeSeason;

before(async () => {
  admin.initializeApp({ projectId: 'seasons-rollover' });
  db = admin.firestore();
  ({ closeSeason } = await import('./lib/seasonRollover.js'));
});

after(async () => {
  await admin.app().delete();
});

async function wipe() {
  for (const c of ['communityPlayerStats', 'communityStats',
                   'communityPairStats', 'seasonSummary', 'users']) {
    const snap = await db.collection(c).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  }
}

/** Two players and a pair, with personal state deliberately mixed in. */
async function seed() {
  await wipe();
  // The name is NOT on the stat row — it is resolved from /users. A dry run
  // against the real club found 29 of 29 rows blank when the rollover read it
  // off the stat document, so the fixture models where it actually lives.
  await db.collection('users').doc('u1').set({ name: 'מתן' });
  await db.collection('users').doc('u2').set({ name: 'דני' });
  await db.collection('communityPlayerStats').doc(`${GID}__u1`).set({
    groupId: GID, userId: 'u1',
    goals: 31, assists: 12, rounds: 40, wins: 22, losses: 14, ties: 4,
    games: 16, cleanSheets: 18, csRounds: 34, asRounds: 40, ownGoals: 1,
    penTaken: 6, penScored: 5, penMissed: 1, penFaced: 0, penSaved: 0,
    penConceded: 0,
    // Personal — must survive.
    bestEvening: { goals: 5, assists: 3, involvement: 8, cleanSheets: 2, wins: 4 },
    lastEveningScore: 8.4,
  });
  await db.collection('communityPlayerStats').doc(`${GID}__u2`).set({
    groupId: GID, userId: 'u2',
    goals: 9, assists: 22, rounds: 38, wins: 15, losses: 19, ties: 4,
    games: 15, cleanSheets: 11, csRounds: 30, asRounds: 38, ownGoals: 0,
    penTaken: 0, penScored: 0, penMissed: 0, penFaced: 9, penSaved: 6,
    penConceded: 3,
    bestEvening: { goals: 2, assists: 4, involvement: 6, cleanSheets: 1, wins: 3 },
    lastEveningScore: 7.9,
  });
  await db.collection('communityStats').doc(GID).set({
    groupId: GID,
    rounds: 78, goals: 40, guestGoals: 5, ownGoals: 1,
    tiedRounds: 8, shootoutRounds: 3, scorelessRounds: 2,
    // Cross-season — must survive.
    kingGoalsSum: 84, kingGoalsCount: 16,
    kingAssistsSum: 40, kingAssistsCount: 16,
    chemistrySince: 1_700_000_000_000,
  });
  await db.collection('communityPairStats').doc(`${GID}__u1__u2`).set({
    groupId: GID, a: 'u1', b: 'u2', assists: 7, sameTeam: 20,
    winsTogether: 12, lossesTogether: 8, cleanSheetsTogether: 5,
    against: 18, winsA: 10, winsB: 8, assistsAToB: 3, assistsBToA: 4,
  });
  // A guest pair. The chemistry engine writes these on purpose, and a guest id
  // is minted fresh every game — so they accumulate forever and must not be
  // copied into the one document a season is archived into.
  await db.collection('communityPairStats').doc(`${GID}__guest:abc__u1`).set({
    groupId: GID, a: 'guest:abc', b: 'u1', assists: 3, sameTeam: 4,
    winsTogether: 2, lossesTogether: 2, cleanSheetsTogether: 1,
    against: 2, winsA: 1, winsB: 1, assistsAToB: 1, assistsBToA: 2,
  });
}

const args = (over = {}) => ({
  db, groupId: GID, groupName: 'חמישי כדורגל', seasonId: SEASON, seasonNo: 1,
  startsAt: 1_780_000_000_000, completedRounds: 16,
  now: 1_790_000_000_000, ...over,
});

describe('the archive is taken before the wipe', () => {
  before(seed);

  test('it copies the live table faithfully', async () => {
    const res = await closeSeason(args());
    assert.equal(res.archived, true);
    assert.equal(res.players, 2);

    const s = (await db.collection('seasonSummary').doc(`${GID}__${SEASON}`).get()).data();
    assert.equal(s.players.u1.goals, 31);
    assert.equal(s.players.u1.cleanSheets, 18);
    assert.equal(s.players.u1.csRounds, 34);
    assert.equal(s.players.u2.assists, 22);
    assert.equal(s.players.u2.penSaved, 6);
    assert.equal(s.totals.goals, 40);
    assert.equal(s.totals.rounds, 78);
    // The pair is archived in full, not as one number: the deadly-duo title
    // needs `sameTeam`, and the personal season summary is built almost
    // entirely out of these counters. A season that kept only `assists` took
    // its own story with it.
    assert.deepEqual(s.pairs.u1__u2, {
      a: 'u1', b: 'u2', assists: 7, sameTeam: 20,
      winsTogether: 12, lossesTogether: 8, cleanSheetsTogether: 5,
      against: 18, winsA: 10, winsB: 8, assistsAToB: 3, assistsBToA: 4,
    });
    assert.equal(s.completedRounds, 16);
  });

  test('guest pairs are kept OUT of the archive', async () => {
    // One document per season, and a club accumulates a new guest pair for
    // every stranger who ever turned out. Past 1MB the season could not be
    // written at all and the club could never close another one.
    const s = (await db.collection('seasonSummary').doc(`${GID}__${SEASON}`).get()).data();
    const keys = Object.keys(s.pairs);
    assert.deepEqual(keys, ['u1__u2']);
    assert.ok(!keys.some((k) => k.includes('guest:')));
    // And the live document is untouched — the archive filters, it does not
    // delete anybody's data.
    const live = await db.collection('communityPairStats').doc(`${GID}__guest:abc__u1`).get();
    assert.equal(live.exists, true);
  });

  test('the titles are decided and sealed with the numbers', async () => {
    // The end-season dialog promises the admin that titles are awarded. Until
    // this landed, nothing computed them.
    const s = (await db.collection('seasonSummary').doc(`${GID}__${SEASON}`).get()).data();
    assert.ok(s.awards, 'the archive carries awards');
    // u1: 31 goals to u2's 9. Both cleared the half-season gate (16 rounds → 8).
    assert.deepEqual(s.awards.topScorer.winners, ['u1']);
    assert.equal(s.awards.topScorer.value, 31);
    // u2: 22 assists to u1's 4.
    assert.deepEqual(s.awards.topAssister.winners, ['u2']);
    // The duo is scored on the pair's assists and needs BOTH halves eligible.
    assert.deepEqual(s.awards.deadlyDuo.winners, ['u1__u2']);
    // Every one of the nine keys is present, decided or explicitly null — a
    // missing key and "not awarded" are different facts.
    for (const k of [
      'topScorer', 'topAssister', 'mvp', 'topWinner', 'mostLoyal',
      'cleanSheetKing', 'penaltyKing', 'penaltyKeeper', 'deadlyDuo',
    ]) {
      assert.ok(k in s.awards, `${k} is present`);
    }
  });

  test('every decided title lands on its winner\'s profile', async () => {
    const t = await db.collection('users').doc('u1').collection('seasonTitles').get();
    const keys = t.docs.map((d) => d.data().titleKey).sort();
    assert.ok(keys.includes('topScorer'), 'u1 holds the scoring title');
    const scorer = t.docs.find((d) => d.data().titleKey === 'topScorer').data();
    assert.equal(scorer.value, 31);
    assert.equal(scorer.seasonNo, 1);
    // The club name is FROZEN, not looked up: the title has to still read
    // after the club is renamed or the player leaves it.
    assert.equal(scorer.groupName, 'חמישי כדורגל');
    assert.equal(scorer.id ?? undefined, undefined);
  });

  test('the duo title lands on BOTH players, not on a joined non-person', async () => {
    for (const uid of ['u1', 'u2']) {
      const t = await db.collection('users').doc(uid).collection('seasonTitles').get();
      assert.ok(
        t.docs.some((d) => d.data().titleKey === 'deadlyDuo'),
        `${uid} holds the duo title`,
      );
    }
    const ghost = await db.collection('users').doc('u1__u2').collection('seasonTitles').get();
    assert.equal(ghost.size, 0, 'no titles on a player that does not exist');
  });

  test('a title nobody can win is null, not a silly winner', async () => {
    const s = (await db.collection('seasonSummary').doc(`${GID}__${SEASON}`).get()).data();
    // Neither player has an evening-score mean (the accumulator is new), so
    // the MVP is not awarded rather than handed to whoever sorts first.
    assert.equal(s.awards.mvp, null);
  });

  test('names are frozen FROM /users, so a deleted account still reads', async () => {
    const s = (await db.collection('seasonSummary').doc(`${GID}__${SEASON}`).get()).data();
    assert.equal(s.players.u1.displayName, 'מתן');
    assert.equal(s.players.u2.displayName, 'דני');
  });

  test('assists and clean sheets are stored explicitly', async () => {
    // Neither has a club counter — the screen sums them from member rows. Once
    // the rows are zeroed they would be underivable.
    const s = (await db.collection('seasonSummary').doc(`${GID}__${SEASON}`).get()).data();
    assert.equal(s.totals.assists, 34);
    assert.equal(s.totals.cleanSheets, 29);
  });
});

describe('the wipe is exactly the competition', () => {
  test('the counters a season owns are zero', async () => {
    const p = (await db.collection('communityPlayerStats').doc(`${GID}__u1`).get()).data();
    for (const f of ['goals', 'assists', 'rounds', 'wins', 'losses', 'ties',
                     'games', 'cleanSheets', 'csRounds', 'asRounds', 'ownGoals',
                     'penTaken', 'penScored', 'penMissed', 'penFaced',
                     'penSaved', 'penConceded']) {
      assert.equal(p[f], 0, `${f} should be zero`);
    }
  });

  test('the personal high-water mark survives', async () => {
    const p = (await db.collection('communityPlayerStats').doc(`${GID}__u1`).get()).data();
    assert.deepEqual(p.bestEvening,
      { goals: 5, assists: 3, involvement: 8, cleanSheets: 2, wins: 4 });
    assert.equal(p.lastEveningScore, 8.4);
  });

  test('identity survives', async () => {
    const p = (await db.collection('communityPlayerStats').doc(`${GID}__u2`).get()).data();
    assert.equal(p.userId, 'u2');
    assert.equal(p.groupId, GID);
  });

  test('the archive survives the account being deleted afterwards', async () => {
    await db.collection('users').doc('u1').delete();
    const s = (await db.collection('seasonSummary').doc(`${GID}__${SEASON}`).get()).data();
    assert.equal(s.players.u1.displayName, 'מתן');
  });

  test('the evening-score benchmark survives', async () => {
    // Zeroing this makes the new season's first top scorer a 10 out of 10 by
    // construction and lifts everyone by about a quarter of the 6-10 scale.
    const c = (await db.collection('communityStats').doc(GID).get()).data();
    assert.equal(c.kingGoalsSum, 84);
    assert.equal(c.kingGoalsCount, 16);
    assert.equal(c.kingAssistsSum, 40);
    assert.equal(c.kingAssistsCount, 16);
  });

  test('the club counters are zero', async () => {
    const c = (await db.collection('communityStats').doc(GID).get()).data();
    for (const f of ['rounds', 'goals', 'guestGoals', 'ownGoals',
                     'tiedRounds', 'shootoutRounds', 'scorelessRounds']) {
      assert.equal(c[f], 0, `${f} should be zero`);
    }
  });

  test('chemistrySince is re-stamped, not left behind', async () => {
    const c = (await db.collection('communityStats').doc(GID).get()).data();
    assert.equal(c.chemistrySince, 1_790_000_000_000);
  });

  test('pairs are zeroed', async () => {
    const p = (await db.collection('communityPairStats').doc(`${GID}__u1__u2`).get()).data();
    assert.equal(p.assists, 0);
    assert.equal(p.sameTeam, 0);
    assert.equal(p.winsTogether, 0);
    // Identity survives here too.
    assert.equal(p.a, 'u1');
    assert.equal(p.b, 'u2');
  });
});

describe('a close that died halfway is resumed, not abandoned', () => {
  // The archive landing and the table resetting are two writes. If the process
  // died between them the old code took the ALREADY_EXISTS branch on every
  // retry: sealed season, no titles, table never reset, and the next season
  // inheriting the last one's totals for good.
  before(async () => {
    await seed();
    await closeSeason(args());
    // Rewind to the half-done state: the archive exists, the wipe did not
    // happen, and nothing recorded that it did.
    await db.collection('seasonSummary').doc(`${GID}__${SEASON}`).update({
      zeroedAt: admin.firestore.FieldValue.delete(),
    });
    await db.collection('communityPlayerStats').doc(`${GID}__u1`).set(
      { goals: 31, rounds: 34, games: 12 }, { merge: true });
    await db.collection('users').doc('u1').collection('seasonTitles')
      .doc(`${GID}__${SEASON}__topScorer`).delete();
  });

  test('the retry finishes the job', async () => {
    const res = await closeSeason(args());
    assert.equal(res.archived, true, 'it resumed rather than skipping');
    const p = (await db.collection('communityPlayerStats').doc(`${GID}__u1`).get()).data();
    assert.equal(p.goals, 0, 'the table is reset');
  });

  test('and the titles it never wrote are written', async () => {
    const t = await db.collection('users').doc('u1').collection('seasonTitles')
      .doc(`${GID}__${SEASON}__topScorer`).get();
    assert.equal(t.exists, true);
    // From the ARCHIVE, not recomputed: the live rows were half-wiped, and a
    // title decided from those would differ from the one already sealed.
    assert.equal(t.data().value, 31);
  });

  test('and the archive itself was never rewritten', async () => {
    const s = (await db.collection('seasonSummary').doc(`${GID}__${SEASON}`).get()).data();
    assert.equal(s.players.u1.goals, 31);
    assert.ok(s.zeroedAt, 'and is now marked finished');
  });
});

describe('a redelivered event cannot seal the zeroes', () => {
  test('the second run refuses to archive', async () => {
    // The table is zero now. Without the create() latch this pass would
    // overwrite the real season with a season of nothing.
    const res = await closeSeason(args());
    assert.equal(res.archived, false);
  });

  test('and the archive still holds the real numbers', async () => {
    const s = (await db.collection('seasonSummary').doc(`${GID}__${SEASON}`).get()).data();
    assert.equal(s.players.u1.goals, 31);
    assert.equal(s.totals.goals, 40);
  });
});

describe('the next season is a clean slate', () => {
  before(async () => {
    await seed();
    await closeSeason(args());
    // Play one round of the new season.
    await db.collection('communityPlayerStats').doc(`${GID}__u1`).set(
      { goals: 2, rounds: 3, csRounds: 3 }, { merge: true });
  });

  test('season 2 counts from zero, not from season 1', async () => {
    const p = (await db.collection('communityPlayerStats').doc(`${GID}__u1`).get()).data();
    assert.equal(p.goals, 2);
    assert.equal(p.rounds, 3);
  });

  test('and closing season 2 archives only season 2', async () => {
    const res = await closeSeason(args({ seasonId: 's2', seasonNo: 2 }));
    assert.equal(res.archived, true);
    const s = (await db.collection('seasonSummary').doc(`${GID}__s2`).get()).data();
    assert.equal(s.players.u1.goals, 2);
    assert.equal(s.players.u1.rounds, 3);
    // Season 1 untouched.
    const s1 = (await db.collection('seasonSummary').doc(`${GID}__s1`).get()).data();
    assert.equal(s1.players.u1.goals, 31);
  });
});
