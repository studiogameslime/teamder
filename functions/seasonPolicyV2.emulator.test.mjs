import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import admin from 'firebase-admin';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const fs = require('node:fs'), ts = require('../node_modules/typescript');
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
const projectId = 'demo-teamder-seasons-v2';
const app = admin.initializeApp({ projectId }, 'season-policy-v2');
const db = app.firestore();
const { SeasonManager } = require('./lib/seasonManager');
const DAY = 86400000;
let clock = Date.parse('2026-10-19T10:00:00Z'), sequence = 0;
const manager = (database = db) => new SeasonManager({ db: database, now: () => clock,
  announce: async a => { await db.doc(`seasonSummary/${a.groupId}__${a.seasonId}`).update({ notificationPending: false }); },
  report: async a => { throw a.err; } });
const uid = 'synthetic-player';
beforeEach(() => { clock = Date.parse('2026-10-19T10:00:00Z'); });
function verificationHandler() {
  const source = fs.readFileSync(new URL('./src/index.ts', import.meta.url), 'utf8');
  const parsed = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, true);
  const statement = parsed.statements.find(n => ts.isVariableStatement(n) && n.declarationList.declarations.some(d => d.name.getText(parsed) === 'setEveningPlayed'));
  assert.ok(statement);
  const code = ts.transpileModule(statement.getText(parsed), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const deps = { exports: {}, db, console, Date: class extends Date { static now() { return clock; } },
    ENFORCE_APP_CHECK: false, onCall: (_, handler) => handler,
    HttpsError: require('firebase-functions/v2/https').HttpsError, seasonManager: () => manager(),
    ...require('./lib/seasonLock'), ...require('./lib/liveSeasonStamp'), ...require('./lib/eveningPlayed') };
  return new Function(...Object.keys(deps), code + '\nreturn exports.setEveningPlayed;')(...Object.values(deps));
}
async function fixture(seasons = {}) {
  const id = `v2-${process.pid}-${++sequence}`, ref = db.doc(`groups/${id}`);
  await ref.set({ name: 'בדיקת עונות מבודדת', adminIds: [uid], playerIds: [uid], seasons });
  await db.doc(`users/${uid}`).set({ name: 'שחקן בדיקה מבודדת' });
  return { id, ref, player: db.doc(`communityPlayerStats/${id}__${uid}`),
    data: extra => ({ groupId: id, policyVersion: 2, ...extra }),
    archive: s => db.doc(`seasonSummary/${id}__${s}`),
    state: async () => (await ref.get()).get('seasons') };
}
async function seed(f, n = 5, stamp = 's1') {
  await f.player.set({ groupId: f.id, userId: uid, games: n, rounds: n * 2, goals: 10, assists: 3,
    wins: n, eveningScoreSum: n * 8, eveningScoreCount: n, bestEvening: 9 });
  await db.doc(`communityStats/${f.id}`).set({ groupId: f.id, goals: 10, rounds: n * 2 });
  await db.doc(`clubRecords/${f.id}`).set({ eveningsSealed: n });
  for (let i = 0; i < n; i++) await db.doc(`games/${f.id}-${i}`).set({ groupId: f.id, status: 'finished', startsAt: clock - (n - i) * DAY, ...(stamp ? { seasonId: stamp } : {}) });
}
async function live(over = {}) {
  const f = await fixture({ policyVersion: 2, revision: 0, enabled: true, count: 0, currentId: 's1', currentNo: 1,
    startedAt: clock - 30 * DAY, playedRounds: 5, roundsAtStart: 0, cadence: { type: 'rounds', targetRounds: 10 },
    nextCadence: { type: 'rounds', targetRounds: 10 }, ...over });
  await seed(f, over.playedRounds ?? 5); return f;
}

test('fresh activation preserves old totals in a noncompetitive period and opens empty', async () => {
  const f = await fixture(); await seed(f, 6, null);
  await manager().enable(f.data({ cadenceType: 'rounds', targetRounds: 12, historyChoice: 'fresh' }), uid);
  const s = await f.state(); assert.equal(s.playedRounds, 0); assert.equal(s.currentNo, 1);
  assert.equal((await f.player.get()).get('goals'), 0); assert.equal((await f.player.get()).get('bestEvening'), 9);
  assert.equal((await f.archive(`off_0_${clock}_0`).get()).get('totals.goals'), 10);
});
test('historical season is awarded and the next season opens at zero', async () => {
  const f = await fixture(); await seed(f, 6, null);
  await manager().enable(f.data({ cadenceType: 'rounds', targetRounds: 12, historyChoice: 'sealNow' }), uid);
  const s = await f.state(); assert.equal(s.currentNo, 2); assert.equal(s.count, 1); assert.equal(s.playedRounds, 0);
  assert.equal((await f.archive('s1').get()).get('completedRounds'), 6);
  assert.equal((await f.archive('s1').get()).get('publicationPending'), false);
  assert.equal((await db.doc(`users/${uid}/seasonTitles/${f.id}__s1__mvp`).get()).get('value'), 8);
});
test('carry activation anchors months to the first included round', async () => {
  const f = await fixture(); await seed(f, 6, null);
  await manager().enable(f.data({ cadenceType: 'date', months: 3, historyChoice: 'continue' }), uid);
  const s = await f.state(); assert.equal(s.playedRounds, 6); assert.equal(s.startedAt, clock - 6 * DAY);
  assert.equal(s.cadence.startsOn, '2026-10-13'); assert.equal(s.cadence.endsOn, '2027-01-12');
  assert.equal((await f.player.get()).get('goals'), 10);
});
for (const choice of ['fresh', 'sealNow', 'continue']) test(`reactivation offers the same ${choice} choice for off activity only`, async () => {
  const disabledAt = clock - 7 * DAY;
  const f = await fixture({ enabled: false, count: 2, currentNo: 3, currentId: 's3', disabledAt });
  await seed(f, 6, `off_2_${disabledAt}`);
  const preview = await manager().preview(f.id, uid); assert.equal(preview.played, 6);
  await manager().enable(f.data({ cadenceType: 'rounds', targetRounds: 12, historyChoice: choice }), uid);
  const s = await f.state(); assert.equal(s.currentNo, choice === 'sealNow' ? 4 : 3);
  assert.equal(s.playedRounds, choice === 'continue' ? 6 : 0);
});
for (const action of ['close', 'disable']) test(`a four-round ${action} returns every round and counter to the unassigned pool`, async () => {
  const f = await live({ playedRounds: 4 });
  await manager().requestClose(f.data(), uid, action);
  let s = await f.state(); assert.equal(s.count, 0); assert.equal(s.enabled, false);
  const stamp = (await db.doc(`games/${f.id}-0`).get()).get('seasonId'); assert.match(stamp, /^off_/);
  assert.equal((await f.player.get()).get('goals'), 10);
  assert.equal((await manager().preview(f.id, uid)).played, 4);
  assert.equal((await db.doc(`users/${uid}/seasonTitles/${f.id}__s1__mvp`).get()).exists, false);
  await manager().enable(f.data({ cadenceType: 'rounds', targetRounds: 12, historyChoice: 'continue' }), uid);
  s = await f.state(); assert.equal(s.currentNo, 1); assert.equal(s.playedRounds, 4);
  assert.equal((await f.player.get()).get('goals'), 10);
  assert.equal((await db.doc(`games/${f.id}-0`).get()).get('seasonId'), 's1');
});

for (const historyChoice of ['fresh', 'sealNow', 'continue']) test(`legacy mixed counters form one complete unassigned period for ${historyChoice}`, async () => {
  const f = await fixture({ enabled: false, count: 0, currentNo: 1, currentId: 's1', playedRounds: 3, disabledAt: clock - 2 * DAY });
  await seed(f, 6, null);
  await db.doc(`games/${f.id}-0`).update({ seasonId: 's1' });
  const preview = await manager().preview(f.id, uid); assert.equal(preview.played, 6);
  await manager().enable(f.data({ cadenceType: 'rounds', targetRounds: 12, historyChoice }), uid);
  const s = await f.state();
  assert.equal(s.currentNo, historyChoice === 'sealNow' ? 2 : 1);
  assert.equal(s.playedRounds, historyChoice === 'continue' ? 6 : 0);
  const roots = await db.collection('seasonSummary').where('groupId', '==', f.id).get();
  assert.equal((await f.player.get()).get('goals') + roots.docs.reduce((n, d) => n + (d.get('totals.goals') ?? 0), 0), 10);
});

test('a time target before five rounds remains open, then the fifth round starts a full day', async () => {
  const f = await live({ playedRounds: 4, cadence: { type: 'date', months: 1, startsOn: '2026-09-01', endsOn: '2026-09-30' } });
  await manager().refresh(f.id); assert.equal((await f.state()).pendingClose, undefined);
  await f.ref.update({ 'seasons.playedRounds': 5 }); await manager().refresh(f.id);
  assert.equal((await f.state()).pendingClose.closeAt, clock + DAY);
});
test('equal target starts a correction window; extension clears it; next defaults are independent', async () => {
  const f = await live();
  await manager().updateTarget(f.data({ cadenceType: 'rounds', targetRounds: 5 }), uid);
  assert.equal((await f.state()).pendingClose.closeAt, clock + DAY);
  await manager().updateTarget(f.data({ cadenceType: 'rounds', targetRounds: 12 }), uid);
  assert.equal((await f.state()).pendingClose, undefined); assert.equal((await f.state()).nextCadence.targetRounds, 10);
  await manager().updateTarget(f.data({ scope: 'next', cadenceType: 'date', months: 6 }), uid);
  assert.equal((await f.state()).cadence.type, 'rounds'); assert.equal((await f.state()).nextCadence.type, 'date');
});
test('switching target kind requires a future goal but is allowed after activity', async () => {
  const f = await live();
  await manager().updateTarget(f.data({ cadenceType: 'date', months: 6 }), uid);
  assert.equal((await f.state()).cadence.startsOn, '2026-09-19');
  await assert.rejects(manager().updateTarget(f.data({ cadenceType: 'rounds', targetRounds: 5 }), uid), /switchTargetReached/);
  await manager().updateTarget(f.data({ cadenceType: 'rounds', targetRounds: 6 }), uid);
});
test('unverified timerless evening pauses six remaining hours, and resolving it resumes those hours', async () => {
  const f = await live({ cadence: { type: 'rounds', targetRounds: 5 },
    pendingClose: { seasonId: 's1', dueAt: clock - 18 * 3600000, closeAt: clock + 6 * 3600000, reason: 'rounds' } });
  const game = db.doc(`games/${f.id}-unverified`);
  await game.set({ groupId: f.id, seasonId: 's1', status: 'finished', endedBy: 'auto', startsAt: clock - DAY });
  await manager().refresh(f.id); let p = (await f.state()).pendingClose;
  assert.equal(p.remainingMs, 6 * 3600000); assert.equal(p.awaitingVerification, 1);
  clock += 2 * DAY; await manager().refresh(f.id); assert.equal((await f.state()).pendingClose.remainingMs, p.remainingMs);
  await game.update({ playVerified: false }); await manager().refresh(f.id);
  p = (await f.state()).pendingClose; assert.equal(p.pausedAt, undefined); assert.equal(p.closeAt, clock + 6 * 3600000);
});
test('a manual close waits for an active round and closes immediately when it is over', async () => {
  const f = await live(), game = db.doc(`games/${f.id}-active`);
  await game.set({ groupId: f.id, seasonId: 's1', status: 'active', startsAt: clock - 10000 });
  await manager().requestClose(f.data(), uid, 'close'); assert.equal((await f.state()).currentId, 's1');
  assert.equal((await f.state()).manualClose.action, 'close');
  await game.update({ status: 'cancelled' }); await manager().refresh(f.id);
  const s = await f.state(); assert.equal(s.currentId, 's2'); assert.equal(s.pendingClose, undefined); assert.equal(s.manualClose, undefined);
});
test('expiry synchronises before starting the scheduled next round', async () => {
  const f = await live({ cadence: { type: 'rounds', targetRounds: 5 },
    pendingClose: { seasonId: 's1', reason: 'rounds', dueAt: clock - DAY - 10, closeAt: clock - 10 } });
  const game = db.doc(`games/${f.id}-next`);
  await game.set({ groupId: f.id, adminIds: [uid], status: 'open', startsAt: clock, liveMatch: { assignments: {}, scoreA: 2, scoreB: 1 } });
  await manager().startEvening(game.id, uid);
  assert.equal((await f.state()).currentId, 's2'); assert.equal((await game.get()).get('seasonId'), 's2');
  assert.equal((await game.get()).get('liveMatch.scoreA'), 2);
});
test('old clients and stale confirmations are rejected', async () => {
  const f = await live();
  await assert.rejects(manager().requestClose({ groupId: f.id }, uid, 'close'), /updateRequired/);
  await assert.rejects(manager().updateTarget(f.data({ expected: { currentId: 's0', revision: 0, playedRounds: 5, enabled: true }, cadenceType: 'rounds', targetRounds: 12 }), uid), /stale/);
});
test('two simultaneous closes cannot create two archives or reset twice', async () => {
  const f = await live();
  await Promise.allSettled([manager().requestClose(f.data(), uid, 'close'), manager().requestClose(f.data(), uid, 'close')]);
  const s = await f.state(); assert.equal(s.count, 1); assert.equal(s.currentNo, 2);
  assert.equal((await f.player.get()).get('goals'), 0); assert.equal((await f.archive('s1').get()).get('totals.goals'), 10);
});
test('a failed lifecycle write leaves awards hidden and resumes from the frozen archive', async () => {
  const f = await live(); let fail = true;
  const broken = new Proxy(db, { get(object, key) {
    if (key === 'runTransaction') return fn => object.runTransaction(tx => fn(new Proxy(tx, { get(t, method) {
      if (method === 'set') return (ref, value, options) => {
        if (fail && ref.path === f.ref.path && value.seasons?.currentId === 's2') { fail = false; throw Error('injected final lifecycle failure'); }
        return t.set(ref, value, options);
      };
      const v = Reflect.get(t, method, t); return typeof v === 'function' ? v.bind(t) : v;
    } })));
    const v = Reflect.get(object, key, object); return typeof v === 'function' ? v.bind(object) : v;
  } });
  await assert.rejects(manager(broken).requestClose(f.data(), uid, 'close'), /injected/);
  assert.equal((await f.state()).operation.failed, true);
  assert.equal((await f.archive('s1').get()).get('publicationPending'), true);
  assert.equal((await db.doc(`users/${uid}/seasonTitles/${f.id}__s1__mvp`).get()).exists, false);
  await manager().resume(f.id, uid);
  assert.equal((await f.state()).currentId, 's2'); assert.equal((await f.state()).operation, undefined);
  assert.equal((await f.archive('s1').get()).get('totals.goals'), 10); assert.equal((await f.player.get()).get('goals'), 0);
  assert.equal((await f.archive('s1').get()).get('publicationPending'), false);
});
test('an interrupted historical activation keeps its original period and can be resumed', async () => {
  const f = await fixture(); await seed(f, 6, null); let fail = true;
  const broken = new Proxy(db, { get(object, key) {
    if (key === 'collection') return name => {
      const collection = object.collection(name);
      if (name !== 'groups') return collection;
      return new Proxy(collection, { get(c, method) {
        if (method === 'doc') return id => {
          const ref = c.doc(id), realSet = ref.set.bind(ref);
          ref.set = (value, options) => {
            if (id === f.id && fail && value.seasons?.enabled === true) { fail = false; throw Error('injected activation failure'); }
            return realSet(value, options);
          }; return ref;
        };
        const v = Reflect.get(c, method, c); return typeof v === 'function' ? v.bind(c) : v;
      } });
    };
    const v = Reflect.get(object, key, object); return typeof v === 'function' ? v.bind(object) : v;
  } });
  await assert.rejects(manager(broken).enable(f.data({ cadenceType: 'rounds', targetRounds: 12, historyChoice: 'sealNow' }), uid), /injected/);
  assert.equal((await f.state()).operation.failed, true);
  await manager().resume(f.id, uid);
  assert.equal((await f.state()).count, 1); assert.equal((await f.archive('s1').get()).get('completedRounds'), 6);
  assert.equal((await f.archive('s1').get()).get('totals.goals'), 10); assert.equal((await f.player.get()).get('goals'), 0);
});
test('long-forgotten unverified rounds remain discoverable rather than silently blocking forever', async () => {
  const f = await live();
  await db.doc(`games/${f.id}-forgotten`).set({ groupId: f.id, status: 'finished', endedBy: 'auto', startsAt: clock - 180 * DAY, seasonId: 's1' });
  assert.equal((await manager().listUnverified(f.id, uid)).items.length, 1);
});
test('no player meeting half the full season produces an explicit reason and no MVP title', async () => {
  const f = await live({ playedRounds: 20 }); await f.player.update({ games: 8, eveningScoreCount: 8, eveningScoreSum: 80 });
  await manager().requestClose(f.data(), uid, 'close');
  const archive = await f.archive('s1').get(); assert.equal(archive.get('awards.mvp'), null);
  assert.match(archive.get('awardNotes.mvp'), /מחצית/);
});
test('organising players without entering live can be rejected as not played and the paused close resumes', async () => {
  clock = Date.now(); const f = await live(), g = db.doc(`games/${f.id}-organised`);
  await g.set({ groupId: f.id, players: [uid], status: 'open', startsAt: clock - 10000 });
  await manager().requestClose(f.data(), uid, 'close');
  assert.equal((await f.state()).pendingClose.awaitingVerification, 1);
  const decide = verificationHandler();
  await decide({ auth: { uid }, data: { gameId: g.id, played: false } });
  assert.equal((await g.get()).get('playVerified'), false); assert.equal((await g.get()).get('seasonId'), 's1');
  assert.equal((await f.state()).currentId, 's2');
  await assert.rejects(decide({ auth: { uid }, data: { gameId: g.id, played: true } }), /closedSeasonGame/);
});
test('confirming a timerless organised round waits for its statistics before closing', async () => {
  clock = Date.now(); const f = await live(), g = db.doc(`games/${f.id}-confirmed`);
  await g.set({ groupId: f.id, players: [uid], status: 'open', startsAt: clock - 10000 });
  await manager().requestClose(f.data(), uid, 'close');
  await verificationHandler()({ auth: { uid }, data: { gameId: g.id, played: true } });
  assert.equal((await g.get()).get('status'), 'finished'); assert.equal((await g.get()).get('seasonId'), 's1');
  assert.equal((await f.state()).currentId, 's1');
  await db.doc(`roundSummaries/${g.id}`).set({ groupId: f.id, gameId: g.id });
  await f.ref.update({ 'seasons.playedRounds': 6 }); await manager().refresh(f.id);
  assert.equal((await f.archive('s1').get()).get('completedRounds'), 6);
});
test('manual closure replaces a paused natural window instead of inheriting its remaining six hours', async () => {
  clock = Date.now();
  const f = await live({ cadence: { type: 'rounds', targetRounds: 5 }, pendingClose: {
    seasonId: 's1', reason: 'rounds', dueAt: clock - DAY, closeAt: clock + 6 * 3600000,
    pausedAt: clock - 1000, remainingMs: 6 * 3600000, awaitingVerification: 1 } });
  const g = db.doc(`games/${f.id}-pending`);
  await g.set({ groupId: f.id, seasonId: 's1', status: 'finished', endedBy: 'auto', startsAt: clock - DAY });
  await manager().requestClose(f.data(), uid, 'close');
  assert.equal((await f.state()).pendingClose.remainingMs, 0);
  await g.update({ playVerified: false }); await manager().refresh(f.id);
  assert.equal((await f.state()).currentId, 's2');
});

async function addOffRounds(f, n = 3, goals = 5) {
  const s = await f.state();
  await f.player.set({ games: admin.firestore.FieldValue.increment(n), rounds: admin.firestore.FieldValue.increment(n * 2),
    goals: admin.firestore.FieldValue.increment(goals), eveningScoreSum: admin.firestore.FieldValue.increment(n * 9),
    eveningScoreCount: admin.firestore.FieldValue.increment(n) }, { merge: true });
  await db.doc(`communityStats/${f.id}`).set({ groupId: f.id, goals: admin.firestore.FieldValue.increment(goals), rounds: admin.firestore.FieldValue.increment(n * 2) }, { merge: true });
  await db.doc(`clubRecords/${f.id}`).set({ eveningsSealed: admin.firestore.FieldValue.increment(n) }, { merge: true });
  for (let i = 0; i < n; i++) await db.doc(`games/${f.id}-off-${clock}-${i}`).set({ groupId: f.id, status: 'finished',
    startsAt: clock - (i + 1) * 60000, seasonId: `off_${s.count ?? 0}_${s.disabledAt ?? 0}` });
}
async function totalGoals(f) {
  const roots = await db.collection('seasonSummary').where('groupId', '==', f.id).get();
  return ((await f.player.get()).get('goals') ?? 0) + roots.docs.reduce((n, d) => n + (d.get(`players.${uid}.goals`) ?? 0), 0);
}
for (const historyChoice of ['fresh', 'sealNow', 'continue']) test(`cancelled and later off rounds are one pool under ${historyChoice}`, async () => {
  const f = await live({ playedRounds: 3 });
  await manager().requestClose(f.data(), uid, 'disable');
  clock += DAY; await addOffRounds(f, 3);
  assert.equal((await manager().preview(f.id, uid)).played, 6);
  await manager().enable(f.data({ cadenceType: 'rounds', targetRounds: 12, historyChoice }), uid);
  assert.equal(await totalGoals(f), 15);
  const s = await f.state(); assert.equal(s.count, historyChoice === 'sealNow' ? 1 : 0);
  assert.equal(s.playedRounds, historyChoice === 'continue' ? 6 : 0);
  if (historyChoice === 'sealNow') {
    const archive = await f.archive('s1').get();
    assert.equal(archive.get('completedRounds'), 6); assert.equal(archive.get('players.' + uid + '.eveningScoreCount'), 6);
    assert.equal(archive.get('awards.mvp.value'), 8.5);
  }
});

test('cancelling the same carried rounds twice never duplicates or consumes a season number', async () => {
  const f = await live({ playedRounds: 3 });
  for (let i = 0; i < 2; i++) {
    await manager().requestClose(f.data(), uid, 'close');
    assert.equal((await f.state()).enabled, false); assert.equal((await manager().preview(f.id, uid)).played, 3);
    await manager().enable(f.data({ cadenceType: 'rounds', targetRounds: 12, historyChoice: 'continue' }), uid);
    assert.equal((await f.state()).playedRounds, 3); assert.equal((await f.state()).count, 0);
  }
  assert.equal(await totalGoals(f), 10);
});

async function archivedPool() {
  const f = await fixture(); await seed(f, 6, null);
  await db.doc(`communityPairStats/${f.id}__a__b`).set({ groupId: f.id, a: 'a', b: 'b', assistsAToB: 2, assistsBToA: 1, sameTeam: 4 });
  await manager().enable(f.data({ cadenceType: 'rounds', targetRounds: 12, historyChoice: 'fresh' }), uid);
  const source = (await db.collection('seasonSummary').where('groupId', '==', f.id).get()).docs.find(d => d.get('nonSeason'));
  // The new attempt has no rounds. Cancelling it returns to the off state.
  await manager().requestClose(f.data(), uid, 'disable');
  clock += DAY; await addOffRounds(f, 2);
  return { f, source: source.ref };
}
for (const historyChoice of ['fresh', 'sealNow', 'continue']) test(`previously archived noncompetitive data can be selected with ${historyChoice} without double counting`, async () => {
  const { f, source } = await archivedPool();
  assert.equal((await manager().preview(f.id, uid)).played, 8);
  await manager().enable(f.data({ cadenceType: 'rounds', targetRounds: 12, historyChoice }), uid);
  assert.equal(await totalGoals(f), 15);
  assert.equal((await source.get()).get('completedRounds'), 0); assert.equal((await source.get()).get('players.' + uid + '.goals'), 0);
  assert.equal((await source.get()).get('players.' + uid + '.displayName'), 'שחקן בדיקה מבודדת');
  assert.equal((await f.state()).playedRounds, historyChoice === 'continue' ? 8 : 0);
  if (historyChoice === 'continue') {
    const pair = await db.doc(`communityPairStats/${f.id}__a__b`).get();
    assert.equal(pair.get('assistsAToB'), 2); assert.equal(pair.get('assistsBToA'), 1);
    assert.equal((await f.player.get()).get('eveningScoreSum'), 66); assert.equal((await f.player.get()).get('eveningScoreCount'), 8);
    assert.equal((await f.player.get()).get('bestEvening'), 9);
  }
});

test('a previously archived cancelled attempt also returns to the shared unassigned pool', async () => {
  const f = await fixture({ policyVersion: 2, enabled: false, currentId: 's1', currentNo: 1, count: 0, disabledAt: clock });
  const id = 'discard_1_old'; await seed(f, 3, id);
  await require('./lib/seasonRollover').closeSeason({ db, groupId: f.id, seasonId: id, seasonNo: 1,
    startsAt: clock - 3 * DAY, completedRounds: 3, nonSeason: true, now: clock });
  clock += DAY; await addOffRounds(f, 3);
  assert.equal((await manager().preview(f.id, uid)).played, 6);
  await manager().enable(f.data({ cadenceType: 'rounds', targetRounds: 12, historyChoice: 'continue' }), uid);
  assert.equal((await f.state()).playedRounds, 6); assert.equal(await totalGoals(f), 15);
});

test('a failure after transferring archived player rows resumes without adding the same goals twice', async () => {
  const { f, source } = await archivedPool(); let fail = true;
  const broken = new Proxy(db, { get(object, key) {
    if (key === 'runTransaction') return async (...args) => {
      const result = await object.runTransaction(...args);
      if (fail && (await source.get()).get('players.' + uid + '.poolTransferred') === true && !(await source.get()).get('poolConsumedBy')) {
        fail = false; throw Error('injected pool transfer interruption');
      }
      return result;
    };
    const value = Reflect.get(object, key, object); return typeof value === 'function' ? value.bind(object) : value;
  } });
  await assert.rejects(manager(broken).enable(f.data({ cadenceType: 'rounds', targetRounds: 12, historyChoice: 'continue' }), uid), /injected pool/);
  assert.equal(await totalGoals(f), 15); assert.equal((await f.state()).operation.failed, true);
  await manager().resume(f.id, uid);
  assert.equal((await f.state()).playedRounds, 8); assert.equal((await f.state()).operation, undefined);
  assert.equal(await totalGoals(f), 15); assert.equal((await f.player.get()).get('goals'), 15);
});

test('competitive archives stay immutable and never return through the unassigned pool', async () => {
  const f = await live(); await manager().requestClose(f.data(), uid, 'disable');
  const old = (await f.archive('s1').get()).data();
  clock += DAY; await addOffRounds(f, 3);
  await manager().enable(f.data({ cadenceType: 'rounds', targetRounds: 12, historyChoice: 'continue' }), uid);
  await manager().requestClose(f.data(), uid, 'disable');
  clock += DAY; await addOffRounds(f, 3);
  assert.equal((await manager().preview(f.id, uid)).played, 6);
  await manager().enable(f.data({ cadenceType: 'rounds', targetRounds: 12, historyChoice: 'sealNow' }), uid);
  assert.deepEqual((await f.archive('s1').get()).data(), old);
  assert.equal((await f.archive('s2').get()).get('completedRounds'), 6); assert.equal((await f.state()).currentNo, 3);
});


test('unassigned chemistry restores every overflow page and preserves missing coverage', async () => {
  const f = await fixture({ policyVersion: 2, enabled: false, count: 0, currentId: 's1', currentNo: 1, disabledAt: clock });
  const sid = 'off_legacy', source = f.archive(sid), page = f.archive(sid + '__pairs_1');
  const rows = Object.fromEntries(Array.from({ length: 401 }, (_, i) => {
    const a = `a${String(i).padStart(3, '0')}`, b = `b${String(i).padStart(3, '0')}`;
    return [`${a}__${b}`, { a, b, sameTeam: 1, assistsAToB: 1, assistsBToA: 0 }];
  }));
  await f.player.set({ groupId: f.id, userId: uid, games: 0, rounds: 0, goals: 0 });
  const entries = Object.entries(rows);
  await source.set({ groupId: f.id, seasonId: sid, nonSeason: true, zeroedAt: clock - DAY, completedRounds: 6,
    startsAt: clock - 7 * DAY, endsAt: clock - DAY, players: { [uid]: { games: 6, goals: 4, rounds: 6, eveningScoreSum: 48, eveningScoreCount: 6 } },
    totals: { goals: 4, rounds: 6 }, pairs: Object.fromEntries(entries.slice(0, 400)), pairPages: [page.id] });
  await page.set({ groupId: f.id, seasonId: sid, kind: 'pairPage', pairs: Object.fromEntries(entries.slice(400)) });
  for (let i = 0; i < 6; i++) await db.doc(`games/${f.id}-${i}`).set({ groupId: f.id, seasonId: sid, status: 'finished', startsAt: clock - (i + 1) * DAY });
  assert.equal((await manager().preview(f.id, uid)).played, 6);
  await manager().enable(f.data({ cadenceType: 'rounds', targetRounds: 12, historyChoice: 'continue' }), uid);
  const pairs = await db.collection('communityPairStats').where('groupId', '==', f.id).get();
  assert.equal(pairs.size, 401); assert.equal(pairs.docs.reduce((n, d) => n + d.get('assistsAToB'), 0), 401);
  assert.deepEqual((await page.get()).get('pairs'), {});
  assert.equal((await f.player.get()).get('csRounds'), undefined); assert.equal((await f.player.get()).get('asRounds'), undefined);
  assert.equal((await f.player.get()).get('goals'), 4); assert.equal((await f.state()).playedRounds, 6);
  assert.equal((await db.doc(`communityStats/${f.id}`).get()).get('chemistrySince'), clock - 7 * DAY);
});

test('a missing unassigned pair page fails before transfer and can resume after recovery', async () => {
  const { f, source } = await archivedPool(); const page = f.archive('pool-missing-page');
  await source.update({ pairPages: [page.id] });
  await assert.rejects(manager().enable(f.data({ cadenceType: 'rounds', targetRounds: 12, historyChoice: 'continue' }), uid), /Missing season pair page/);
  assert.equal((await f.player.get()).get('goals'), 5); assert.equal(await totalGoals(f), 15);
  const original = await source.get();
  await page.set({ groupId: f.id, seasonId: original.get('seasonId'), kind: 'pairPage', pairs: {} });
  await manager().resume(f.id, uid);
  assert.equal((await f.state()).playedRounds, 8); assert.equal(await totalGoals(f), 15);
});


test('the fifth round completed while cancellation waits creates a competitive season', async () => {
  const f = await live({ playedRounds: 4 }), game = db.doc(`games/${f.id}-fifth`);
  await game.set({ groupId: f.id, seasonId: 's1', status: 'active', startsAt: clock - 1000 });
  await manager().requestClose(f.data(), uid, 'disable');
  assert.equal((await f.state()).enabled, true);
  await game.update({ status: 'finished', endedBy: 'admin', playVerified: true });
  await db.doc(`roundSummaries/${game.id}`).set({ groupId: f.id, gameId: game.id });
  await f.player.update({ games: 5, eveningScoreCount: 5, eveningScoreSum: 40 });
  await f.ref.update({ 'seasons.playedRounds': 5 }); await manager().refresh(f.id);
  assert.equal((await f.state()).enabled, false); assert.equal((await f.state()).count, 1);
  assert.equal((await f.archive('s1').get()).get('completedRounds'), 5);
  assert.equal((await manager().preview(f.id, uid)).played, 0);
});

test('a stale pool preview is refused before any archived rows are consumed', async () => {
  const { f, source } = await archivedPool(); const snapshot = await manager().preview(f.id, uid);
  clock += DAY; await addOffRounds(f, 1, 2);
  await assert.rejects(manager().enable(f.data({ cadenceType: 'rounds', targetRounds: 12, historyChoice: 'continue', historySnapshot: snapshot }), uid), /season-operation:stale/);
  assert.equal((await source.get()).get('poolConsumedBy'), undefined);
  assert.equal(await totalGoals(f), 17);
});


test('restoring a reversed live pair keeps the direction of every assist', async () => {
  const { f } = await archivedPool(), pair = db.doc(`communityPairStats/${f.id}__a__b`);
  await pair.update({ a: 'b', b: 'a' });
  await manager().enable(f.data({ cadenceType: 'rounds', targetRounds: 12, historyChoice: 'continue' }), uid);
  assert.equal((await pair.get()).get('assistsAToB'), 1);
  assert.equal((await pair.get()).get('assistsBToA'), 2);
  assert.equal(await totalGoals(f), 15);
});


test('frozen former-player names survive pool transfer and the next competitive archive', async () => {
  const { f, source } = await archivedPool();
  const name = (await source.get()).get('players.' + uid + '.displayName');
  await db.doc(`users/${uid}`).delete();
  await manager().enable(f.data({ cadenceType: 'rounds', targetRounds: 12, historyChoice: 'sealNow' }), uid);
  assert.equal((await f.archive('s1').get()).get('players.' + uid + '.displayName'), name);
  assert.equal((await source.get()).get('players.' + uid + '.displayName'), name);
  assert.equal((await source.get()).get('players.' + uid + '.goals'), 0);
  assert.equal(await totalGoals(f), 15);
});

after(async () => { await db.terminate(); await app.delete(); });
