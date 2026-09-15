import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import admin from 'firebase-admin';
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
const GID = 'pairqa', SEASON = 's1';
let db, closeSeason;
before(async () => {
  admin.initializeApp({ projectId: 'seasons-pairqa' });
  db = admin.firestore();
  ({ closeSeason } = await import('./lib/seasonRollover.js'));
});
after(async () => { await admin.app().delete(); });

async function seed() {
  for (const c of ['communityPlayerStats','communityStats','communityPairStats','seasonSummary','seasonCards','users']) {
    const s = await db.collection(c).get();
    await Promise.all(s.docs.map(d => d.ref.delete()));
  }
  await db.collection('users').doc('u1').set({ name: 'מתן' });
  await db.collection('users').doc('u2').set({ name: 'דני' });
  await db.collection('communityPlayerStats').doc(`${GID}__u1`).set({ groupId: GID, userId:'u1', goals:31, rounds:40, games:16 });
  await db.collection('communityPlayerStats').doc(`${GID}__u2`).set({ groupId: GID, userId:'u2', goals:9, rounds:38, games:15 });
  await db.collection('communityStats').doc(GID).set({ groupId: GID, rounds:78, goals:40 });
  await db.collection('communityPairStats').doc(`${GID}__u1__u2`).set({
    groupId: GID, a:'u1', b:'u2', assists:7, sameTeam:20, winsTogether:12,
    lossesTogether:8, cleanSheetsTogether:5, against:18, winsA:10, winsB:8,
    assistsAToB:3, assistsBToA:4,
  });
}
const args = (over={}) => ({ db, groupId: GID, groupName:'x', seasonId: SEASON, seasonNo:1,
  startsAt: 1_780_000_000_000, completedRounds:16, now: 1_790_000_000_000, ...over });

describe('a close that died after the wipe and is retried', () => {
  before(async () => {
    await seed();
    await closeSeason(args());
    // The new season starts: u1 and u2 play one evening beside each other.
    await db.collection('communityPlayerStats').doc(`${GID}__u1`).set(
      { goals: admin.firestore.FieldValue.increment(2) }, { merge: true });
    await db.collection('communityPairStats').doc(`${GID}__u1__u2`).set(
      { sameTeam: admin.firestore.FieldValue.increment(3),
        winsTogether: admin.firestore.FieldValue.increment(2) }, { merge: true });
    // Rewind to "the archive landed, nothing recorded that the wipe finished".
    await db.collection('seasonSummary').doc(`${GID}__${SEASON}`).update({
      zeroedAt: admin.firestore.FieldValue.delete() });
    await closeSeason(args());   // the retry
  });
  test('the player row keeps the evening (stamped)', async () => {
    const p = (await db.collection('communityPlayerStats').doc(`${GID}__u1`).get()).data();
    assert.equal(p.goals, 2);
  });
  test('and so does the pair row', async () => {
    const p = (await db.collection('communityPairStats').doc(`${GID}__u1__u2`).get()).data();
    assert.equal(p.sameTeam, 3);
    assert.equal(p.winsTogether, 2);
  });
});
