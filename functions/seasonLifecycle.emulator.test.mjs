// Compiled callable handlers, real Admin SDK, isolated local database only.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import admin from 'firebase-admin';
import fs from 'node:fs';
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = 'demo-season-lifecycle-fixes';
process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: process.env.GCLOUD_PROJECT });
let api, db;
const gid = 'lifecycle-club';
const call = (name, data = {}) => api[name].run({ auth: { uid: 'admin' }, data: { groupId: gid, ...data } });
const group = () => db.collection('groups').doc(gid);
const player = () => db.collection('communityPlayerStats').doc(`${gid}__admin`);
before(async () => { api = await import('./lib/index.js'); db = admin.firestore(); });
after(async () => { await Promise.all(admin.apps.map(a => a.delete())); });
beforeEach(async () => {
  for (const c of ['groups', 'games', 'clubRecords', 'communityPlayerStats', 'communityStats', 'communityPairStats', 'seasonCards', 'seasonSummary', 'notifications']) {
    const snap = await db.collection(c).get();
    for (const d of snap.docs) await d.ref.delete();
  }
  await group().set({ name: 'Local QA', adminIds: ['admin'], playerIds: ['admin'] });
  await db.collection('users').doc('admin').set({ name: 'QA' });
});
async function seedLive(count = 0) {
  await group().set({ seasons: { enabled: true, currentId: `s${count + 1}`, currentNo: count + 1,
    count, playedRounds: 3, roundsAtStart: 0, startedAt: 100, cadence: { type: 'rounds', targetRounds: 10 } } }, { merge: true });
  await player().set({ groupId: gid, userId: 'admin', games: 3, rounds: 6, goals: 5, bestEvening: 9 });
  await db.collection('communityStats').doc(gid).set({ goals: 5, rounds: 6 });
  await db.collection('clubRecords').doc(gid).set({ eveningsSealed: 3 });
}
test('first activation archives complete history rather than the late sealed counter', async () => {
  for (let i = 0; i < 205; i++) await db.collection('games').doc(`old${i}`).set({ groupId: gid, status: 'finished', startsAt: i + 1 });
  await db.collection('clubRecords').doc(gid).set({ eveningsSealed: 3 });
  await call('enableClubSeasons', { cadenceType: 'rounds', targetRounds: 24, historyChoice: 'sealNow' });
  assert.equal((await db.collection('seasonSummary').doc(`${gid}__s1`).get()).get('completedRounds'), 205);
  assert.equal((await group().get()).get('seasons.currentId'), 's2');
  assert.equal((await group().get()).get('seasons.operation'), undefined);
});
test('disable, play while off, reactivate: lifetime retains both periods and the new season is empty', async () => {
  await seedLive();
  await call('disableClubSeasons');
  const sea = (await group().get()).get('seasons');
  assert.equal(sea.enabled, false); assert.equal(sea.count, 1);
  assert.equal((await player().get()).get('goals'), 0);
  await player().update({ goals: 2, games: 1, rounds: 2 });
  await db.collection('communityStats').doc(gid).update({ goals: 2, rounds: 2 });
  await db.collection('games').doc('off-game').set({ groupId: gid, status: 'finished', startsAt: Date.now() - 1, seasonId: `off_1_${sea.disabledAt}` });
  await call('enableClubSeasons', { cadenceType: 'rounds', targetRounds: 2 });
  assert.equal((await player().get()).get('goals'), 0);
  assert.equal((await player().get()).get('bestEvening'), 9);
  const root = await db.collection('seasonSummary').doc(`${gid}__off_1_${sea.disabledAt}`).get();
  assert.equal(root.get('players').admin.goals, 2);
  assert.equal(root.get('completedRounds'), 1);
  assert.equal(root.get('nonSeason'), true);
  assert.equal((await group().get()).get('seasons.playedRounds'), 0);
  assert.equal((await group().get()).get('seasons.cadence.targetRounds'), 2);
  const cards = await db.collection('seasonCards').where('groupId', '==', gid).get();
  assert.equal(cards.docs.reduce((n, d) => n + d.get('totals.goals'), 0), 7);
});
test('a one-round discarded season cannot leak its old game into the next season with the same number', async () => {
  await seedLive(); await call('disableClubSeasons');
  await call('enableClubSeasons', { cadenceType: 'rounds', targetRounds: 10 });
  await group().update({ 'seasons.playedRounds': 1 });
  await player().update({ goals: 1, games: 1, rounds: 1 });
  await db.collection('communityStats').doc(gid).update({ goals: 1, rounds: 1 });
  await db.collection('games').doc('short').set({ groupId: gid, seasonId: 's2', status: 'finished', startsAt: Date.now() });
  await call('disableClubSeasons');
  await call('enableClubSeasons', { cadenceType: 'rounds', targetRounds: 10 });
  assert.equal((await group().get()).get('seasons.currentId'), 's2');
  assert.notEqual((await db.collection('games').doc('short').get()).get('seasonId'), 's2');
  assert.equal((await player().get()).get('goals'), 0);
});
test('activation refuses a live evening and leaves no operation window behind', async () => {
  await db.collection('games').doc('active').set({ groupId: gid, status: 'active', startsAt: Date.now() });
  await assert.rejects(() => call('enableClubSeasons', { cadenceType: 'rounds', targetRounds: 10 }), /openGame/);
  assert.equal((await group().get()).get('seasons.operation'), undefined);
  assert.equal((await group().get()).get('seasons.pendingClose'), undefined);
});
test('simultaneous manual closes produce one archive and advance exactly once', async () => {
  await seedLive();
  const results = await Promise.allSettled([call('endSeasonNow'), call('endSeasonNow')]);
  assert.equal(results.filter(x => x.status === 'fulfilled').length, 1);
  assert.equal((await group().get()).get('seasons.count'), 1);
  assert.equal((await group().get()).get('seasons.currentNo'), 2);
  assert.equal((await player().get()).get('goals'), 0);
});
test('invalid target and changed cadence preserve the live season and release the operation lock', async () => {
  await seedLive();
  await assert.rejects(() => call('updateSeasonTarget', { cadenceType: 'rounds', targetRounds: 1 }));
  await assert.rejects(() => call('updateSeasonTarget', { cadenceType: 'date', months: 6 }), /cannot change/);
  assert.equal((await player().get()).get('goals'), 5);
  assert.equal((await group().get()).get('seasons.pendingClose'), undefined);
});


test('an interrupted close keeps the frozen archive, rejects other actions, and resumes the same action', async () => {
  await seedLive();
  const original = db.runTransaction;
  let calls = 0;
  db.runTransaction = function (...args) {
    if (++calls === 3) return Promise.reject(new Error('injected interruption after archive'));
    return original.apply(this, args);
  };
  try { await assert.rejects(() => call('endSeasonNow'), /injected interruption/); }
  finally { db.runTransaction = original; }
  assert.equal((await group().get()).get('seasons.operation.failed'), true);
  assert.equal((await player().get()).get('goals'), 5);
  const archive = await db.collection('seasonSummary').doc(`${gid}__s1`).get();
  assert.equal(archive.get('players').admin.goals, 5);
  await assert.rejects(() => call('updateSeasonTarget', { cadenceType: 'rounds', targetRounds: 24 }), /season-operation:busy/);
  await call('endSeasonNow');
  assert.equal((await player().get()).get('goals'), 0);
  assert.equal((await group().get()).get('seasons.count'), 1);
  assert.equal((await group().get()).get('seasons.operation'), undefined);
  assert.equal((await group().get()).get('seasons.pendingClose'), undefined);
  assert.equal((await db.collection('seasonSummary').doc(`${gid}__s1`).get()).get('players').admin.goals, 5);
});


test('notification creation returning an error retains the durable retry flag after lifecycle advance', async () => {
  await seedLive();
  const original = db.collection;
  db.collection = function (path) {
    const collection = original.call(this, path);
    if (path === 'notifications') {
      const doc = collection.doc.bind(collection);
      collection.doc = (...args) => {
        const ref = doc(...args);
        ref.create = async () => { throw new Error('injected notification delivery failure'); };
        return ref;
      };
    }
    return collection;
  };
  try { await call('endSeasonNow'); }
  finally { db.collection = original; }
  assert.equal((await group().get()).get('seasons.count'), 1);
  assert.equal((await db.collection('seasonSummary').doc(`${gid}__s1`).get()).get('notificationPending'), true);
});


test('operator reopening cannot mix unarchived off-period statistics into the last season', async () => {
  await seedLive(); await call('disableClubSeasons');
  await player().update({ games: 1, rounds: 1, goals: 2 });
  const source = fs.readFileSync(new URL('./src/index.ts', import.meta.url), 'utf8');
  const operator = source.match(/const OPERATOR_UID = '([^']+)'/)[1];
  await group().update({ adminIds: ['admin', operator] });
  await assert.rejects(() => api.reopenLastSeason.run({ auth: { uid: operator }, data: { groupId: gid } }), /historyAdvanced/);
  assert.equal((await player().get()).get('goals'), 2);
  assert.equal((await db.collection('seasonSummary').doc(`${gid}__s1`).get()).exists, true);
  assert.equal((await group().get()).get('seasons.operation'), undefined);
});
