import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import admin from 'firebase-admin';
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8186';
process.env.GCLOUD_PROJECT = 'demo-filler-review';
process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: process.env.GCLOUD_PROJECT });
let api, db;
before(async () => { api = await import('./lib/index.js'); db = admin.firestore(); });
after(async () => { await Promise.all(admin.apps.map(a => a.delete())); });
const call = (name, uid, data) => api[name].run({ auth: { uid, token: { firebase: { sign_in_provider: 'password' } } }, data });
async function fixture(id, roster = []) {
  const ref = db.doc('games/' + id);
  await db.doc('groups/' + id).set({ adminIds: ['clubAdmin'], playerIds: ['clubAdmin'] });
  await ref.set({ groupId: id, createdBy: 'creator', title: 'מחזור בדיקה', status: 'open',
    startsAt: Date.now() + 3600000, acceptsFillers: true, players: roster, maxPlayers: 1, pending: [], waitlist: [] });
  return ref;
}
test('creator verifies only own notices for this round; stale, unnotified and other club data stay hidden', async () => {
  const ref = await fixture('notices', ['registered']);
  for (const uid of ['registered', 'outside', 'unnotified', 'rejected']) {
    await ref.collection('fillerInterests').doc(uid).set({ status: uid === 'rejected' ? 'rejected' : 'pending' });
    await db.collection('notifications').add({ recipientId: uid === 'unnotified' ? 'another' : 'creator',
      type: 'fillerInterestReceived', payload: { gameId: ref.id, candidateUid: uid } });
  }
  const read = uid => call('getMyRoundFillerNotices', uid, { gameId: ref.id });
  await call('submitFillerInterest', 'addressed', { gameId: ref.id, source: 'round' });
  assert.equal((await ref.collection('fillerInterests').doc('addressed').get()).get('reviewRecipientId'), 'creator');
  assert.deepEqual(await read('creator'), { ids: ['addressed', 'outside'] });
  await assert.rejects(read('another'), e => e.code === 'permission-denied');
  await ref.update({ status: 'locked' });
  assert.deepEqual(await read('creator'), { ids: [] });
});
test('registration on another path retires approval without a second registration or notice', async () => {
  const ref = await fixture('registered', ['player']);
  const interest = ref.collection('fillerInterests').doc('player');
  await interest.set({ status: 'pending' });
  const result = await call('approveFiller', 'clubAdmin', { gameId: ref.id, candidateUid: 'player' });
  assert.equal(result.alreadyHandled, true);
  assert.deepEqual((await ref.get()).get('players'), ['player']);
  assert.equal((await interest.get()).get('status'), 'superseded');
  assert.equal((await db.collection('notifications').where('recipientId', '==', 'player').get()).size, 0);
});
test('two decisions cannot overwrite each other; a full round lands on the waitlist', async () => {
  const ref = await fixture('full', ['full']);
  const interest = ref.collection('fillerInterests').doc('guest');
  const params = { gameId: ref.id, candidateUid: 'guest' };
  await call('submitFillerInterest', 'guest', { gameId: ref.id, source: 'round' });
  assert.equal((await interest.get()).get('source'), 'round');
  const results = await Promise.allSettled(['creator', 'clubAdmin'].map(uid => call('approveFiller', uid, params)));
  assert.equal(results.filter(r => r.status === 'fulfilled' && r.value.bucket === 'waitlist').length, 1);
  assert.equal(results.filter(r => r.status === 'rejected' && r.reason.code === 'failed-precondition').length, 1);
  assert.deepEqual((await ref.get()).get('waitlist'), ['guest']);
  await assert.rejects(call('declineFiller', 'creator', params), e => e.code === 'failed-precondition');
  assert.equal((await interest.get()).get('status'), 'approved');
  await assert.rejects(call('approveFiller', 'creator', { gameId: ref.id, candidateUid: 'never-applied' }), e => e.code === 'failed-precondition');
});
test('a delayed roster event retires old interest, but never an application resubmitted after leaving', async () => {
  const { retireJoinedFillerRequests } = await import('./lib/fillerRosterReview.js');
  const ref = await fixture('replay');
  const interest = ref.collection('fillerInterests').doc('outside');
  const submit = () => call('submitFillerInterest', 'outside', { gameId: ref.id, source: 'notification' });
  await submit();
  const before = (await ref.get()).data();
  const entered = await ref.update({ waitlist: ['outside'] }), after = (await ref.get()).data();
  const replay = () => retireJoinedFillerRequests(db, ref, before, after, entered.writeTime);
  await replay();
  assert.equal((await interest.get()).get('status'), 'superseded');
  await ref.update({ waitlist: [] });
  await submit();
  await replay();
  assert.equal((await interest.get()).get('status'), 'pending');
  assert.equal((await interest.get()).get('source'), 'notification');
});
