// Local integration: actual scheduled handler, real Firestore transactions and
// actual finish handler. Eventarc delivery is simulated explicitly; no client
// screen, syncClubSeason, production credentials, FCM or Cloud Tasks are used.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = 'demo-teamder-season-automatic';
process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: process.env.GCLOUD_PROJECT });
const functionsRoot = process.env.SEASON_TEST_FUNCTIONS_ROOT || new URL('.', import.meta.url).pathname.replace(/^\/(.:\/)/, '$1');
const path = require('node:path');
const handlers = require(path.join(functionsRoot, 'lib/index')), admin = require('firebase-admin'), db = admin.firestore();
const { SeasonManager } = require(path.join(functionsRoot, 'lib/seasonManager'));
assert.equal(db.projectId, 'demo-teamder-season-automatic');
const DAY = 86400000, ids = ['AutoSeasonPlayer000000000000001', 'AutoSeasonPlayer000000000000002'];
let sequence = 0;
const call = (name, data) => handlers[name].run({ auth: { uid: ids[0] }, data });
const deliver = (before, after) => handlers.onGameRosterChanged.run({ params: { gameId: after.id }, data: { before, after } });
const sweep = () => handlers.cronEvery60Min.run({ jobName: 'isolated-test', scheduleTime: new Date().toISOString() });
after(async () => { await Promise.all(admin.apps.map(a => a.delete())); });

async function fixture() {
  const id = `auto-${process.pid}-${++sequence}`, ref = db.doc(`groups/${id}`);
  for (const uid of ids) await db.doc(`users/${uid}`).set({ name: 'שחקן בדיקה מקומי', stats: {} });
  await ref.set({ name: 'מועדון מבודד', adminIds: [ids[0]], playerIds: ids, isPersonal: false });
  await call('enableClubSeasons', { groupId: id, policyVersion: 2, historyChoice: 'fresh', cadenceType: 'rounds', targetRounds: 5 });
  return { id, ref };
}
async function evening(f, fail = false) {
  const game = db.doc(`games/${f.id}-round-${++sequence}`), now = Date.now();
  await game.set({ groupId: f.id, createdBy: ids[0], adminIds: [ids[0]], title: 'מחזור מקומי', status: 'open', startsAt: now,
    players: ids, pending: [], waitlist: [], visibility: 'private', liveMatch: { assignments: {}, benchOrder: [], phase: 'idle', scoreA: 0, scoreB: 0 } });
  await call('startSeasonEvening', { gameId: game.id });
  await call('commitRoundStats', { gameId: game.id, roundId: 1, sideA: [ids[0]], sideB: [ids[1]], winnerSide: 'A',
    goals: [{ scorerId: ids[0], team: 'A', minute: 1 }], penalties: [] });
  const before = await game.get(); await game.update({ status: 'finished', endedBy: 'admin', endedAt: now });
  const originalBatch = db.batch;
  if (fail) db.batch = function () {
    const batch = originalBatch.call(this), create = batch.create.bind(batch); let summary = false;
    batch.create = (ref, ...args) => { if (ref.path === `roundSummaries/${game.id}`) summary = true; return create(ref, ...args); };
    const commit = batch.commit.bind(batch);
    batch.commit = (...args) => summary ? Promise.reject(new Error('injected summary write failure')) : commit(...args);
    return batch;
  };
  try {
    if (fail) await assert.rejects(deliver(before, await game.get()), /injected summary write failure/);
    else await deliver(before, await game.get());
  } finally { db.batch = originalBatch; }
  return game;
}

test('hourly cron recovers expired failed finishes and opens the next season with no client visit', async () => {
  const f = await fixture(), failed = [await evening(f, true), await evening(f, true)];
  for (let i = 0; i < 5; i++) await evening(f);
  let sea = (await f.ref.get()).get('seasons');
  assert.equal(sea.playedRounds, 5); assert.equal(sea.pendingClose.closeAt - sea.pendingClose.dueAt, DAY);
  assert.equal(sea.closureStatus.unsealed, 2);
  const stages = await Promise.all(failed.map(g => g.collection('finishCredited').doc('once').get()));
  const player = db.doc(`communityPlayerStats/${f.id}__${ids[0]}`), original = (await player.get()).data();
  assert.equal(original.games, 7); assert.equal(original.eveningScoreCount, 7);
  await f.ref.update({ 'seasons.pendingClose.dueAt': Date.now() - DAY - 1000, 'seasons.pendingClose.closeAt': Date.now() - 1000 });
  const before = await Promise.all(failed.map(g => g.get()));
  await sweep(); // This is the only operation which requests the missing work.
  sea = (await f.ref.get()).get('seasons'); assert.equal(sea.currentId, 's1'); assert.equal(sea.closureStatus.unsealed, 2);
  for (let i = 0; i < failed.length; i++) {
    const after = await failed[i].get(); assert.equal(after.get('seasonFinishRecovery.attempts'), 1);
    await deliver(before[i], after); // Simulated infrastructure event delivery.
    await deliver(before[i], after); // Duplicate delivery is harmless.
  }
  await sweep();
  sea = (await f.ref.get()).get('seasons');
  assert.equal(sea.currentId, 's2'); assert.equal(sea.playedRounds, 0);
  assert.equal(sea.closureStatus, undefined); assert.equal(sea.pendingClose, undefined);
  const archived = (await db.doc(`seasonSummary/${f.id}__s1`).get()).data();
  assert.equal(archived.completedRounds, 7); assert.equal(archived.players[ids[0]].games, original.games);
  assert.equal(archived.players[ids[0]].goals, original.goals);
  assert.equal(archived.players[ids[0]].eveningScoreCount, original.eveningScoreCount);
  assert.equal(archived.publicationPending, false); assert.equal(archived.notificationPending, false);
  assert.equal((await player.get()).get('games'), 0);
  for (let i = 0; i < failed.length; i++) {
    assert.deepEqual((await failed[i].collection('finishCredited').doc('once').get()).data(), stages[i].data());
    assert.equal((await db.doc(`roundSummaries/${failed[i].id}`).get()).exists, true);
  }
  await sweep(); assert.equal((await f.ref.get()).get('seasons.currentId'), 's2');
});

test('persistent failure is throttled, diagnosed and reported; retries continue without closing on missing data', async () => {
  const f = await fixture(), game = await evening(f, true);
  const reports = [], now = Date.now(); let clock = now;
  const manager = () => new SeasonManager({ db, now: () => clock, announce: async () => {}, report: async e => reports.push(e) });
  await Promise.all([manager().refresh(f.id, true), manager().refresh(f.id, true)]);
  assert.equal((await game.get()).get('seasonFinishRecovery.attempts'), 1);
  await manager().refresh(f.id, true); assert.equal((await game.get()).get('seasonFinishRecovery.attempts'), 1);
  clock += 31 * 60000; await manager().refresh(f.id, true);
  assert.equal((await game.get()).get('seasonFinishRecovery.attempts'), 2);
  clock += 31 * 60000; await manager().refresh(f.id, true);
  assert.equal((await game.get()).get('seasonFinishRecovery.attempts'), 2);
  assert.equal(reports.at(-1).operation, 'seasonFinishRecovery');
  assert.deepEqual(reports.at(-1).context.gameIds, [game.id]);
  clock += 31 * 60000; await manager().refresh(f.id, true);
  assert.equal((await game.get()).get('seasonFinishRecovery.attempts'), 3);
  const sea = (await f.ref.get()).get('seasons');
  assert.equal(sea.closureStatus.unsealed, 1); assert.equal(sea.closureStatus.rounds[0].id, game.id);
  assert.equal(sea.playedRounds, 0); assert.equal(sea.currentId, 's1');
});

test('the scheduled handler alone closes a clean date season after the correction window', async () => {
  const f = await fixture();
  for (let i = 0; i < 5; i++) await evening(f);
  await f.ref.update({ 'seasons.cadence': { type: 'date', months: 1, startsOn: '2026-09-01', endsOn: '2026-09-30' },
    'seasons.pendingClose': { seasonId: 's1', reason: 'date', dueAt: Date.now() - DAY - 1, closeAt: Date.now() - 1 } });
  await sweep();
  const sea = (await f.ref.get()).get('seasons');
  assert.equal(sea.currentId, 's2'); assert.equal(sea.playedRounds, 0); assert.equal(sea.pendingClose, undefined);
  assert.equal((await db.doc(`seasonSummary/${f.id}__s1`).get()).get('completedRounds'), 5);
});

test('recovery never guesses a verdict or touches active, cancelled or archived rounds', async () => {
  const f = await fixture(), docs = [];
  for (const [key, values] of Object.entries({
    active: { seasonId: 's1', status: 'active' },
    undecided: { seasonId: 's1', status: 'finished', endedBy: 'auto' },
    cancelled: { seasonId: 's1', status: 'cancelled', endedBy: 'admin' },
    archived: { seasonId: 's0', status: 'finished', endedBy: 'admin' },
  })) { const ref = db.doc(`games/${f.id}-${key}`); await ref.set({ groupId: f.id, startsAt: Date.now() - DAY, players: ids, ...values }); docs.push(await ref.get()); }
  const manager = new SeasonManager({ db, announce: async () => {}, report: async e => { throw e.err; } });
  await manager.refresh(f.id, true);
  for (const before of docs) assert.deepEqual((await before.ref.get()).data(), before.data());
  const status = (await f.ref.get()).get('seasons.closureStatus');
  assert.equal(status.unverified, 1); assert.equal(status.unsealed, 0);
});
