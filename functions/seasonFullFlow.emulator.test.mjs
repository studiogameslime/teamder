// Integrated server flow using the exported callable and Firestore handlers.
// Trigger delivery is explicit: this verifies their real bodies, not Cloud
// Eventarc delivery. No production project, credentials, FCM or Cloud Tasks.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const rootRequire = createRequire(new URL('../package.json', import.meta.url));
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = 'demo-teamder-season-full-flow';
process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: process.env.GCLOUD_PROJECT });
const handlers = require('./lib/index');
const admin = require('firebase-admin'), db = admin.firestore();
assert.equal(db.projectId, 'demo-teamder-season-full-flow');
const realNow = Date.now;
let clock = realNow(), sequence = 0;
const call = (name, uid, data) => handlers[name].run({ auth: { uid }, data });
const ids = ['FlowPlayerA000000000000000001','FlowPlayerB000000000000000002','FlowPlayerC000000000000000003'];
const gid = `full-${process.pid}-${clock}`, club = db.doc(`groups/${gid}`);
let clientEnvironment;
async function clientReaders() {
 const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
 const ts = rootRequire('typescript');
 const { initializeTestEnvironment } = rootRequire('@firebase/rules-unit-testing');
 clientEnvironment ??= await initializeTestEnvironment({ projectId: db.projectId,
  firestore: { host: '127.0.0.1', port: 8080, rules: fs.readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') } });
 const clientDb = clientEnvironment.authenticatedContext(ids[0]).firestore();
 const firebase = rootRequire('firebase/firestore'), cache = new Map();
 function load(file) {
  file = path.resolve(file);
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} }; cache.set(file, module);
  const imports = name => {
   if (name === '@/firebase/config') return { USE_MOCK_DATA: false, getFirebase: () => ({ db: clientDb }) };
   if (name === '@/services/errorLog') return { logError: (...args) => console.error('client reader', ...args) };
   if (name === '@/services/groupService') return { groupService: { hydrateUsers: async uids =>
    Promise.all(uids.map(async id => ({ id, ...(await firebase.getDoc(firebase.doc(clientDb, 'usersPublic', id))).data() }))) } };
   if (name.startsWith('@/')) return load(path.resolve('src', name.slice(2)) + '.ts');
   if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name) + '.ts');
   return rootRequire(name);
  };
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(js, { module, exports: module.exports, require: imports, console, Date, Map, Set, Number, Math });
  return module.exports;
 }
 return { summary: load('src/services/seasonSummaryService.ts').seasonSummaryService,
  history: load('src/services/seasonHistoryService.ts').seasonHistoryService,
  titles: load('src/services/seasonTitlesService.ts').seasonTitlesService,
  mergeAllTime: load('src/utils/allTimeTable.ts').mergeAllTime,
  parseSeasonTable: load('src/utils/seasonArchive.ts').parseSeasonTable };
}
async function deliver(before, after) {
 await handlers.onGameRosterChanged.run({ params: { gameId: after.id }, data: { before, after } });
}
async function round({ finish = true } = {}) {
 clock = realNow();
 const game = db.doc(`games/${gid}-${++sequence}`);
 await game.set({ groupId: gid, createdBy: ids[0], adminIds: [ids[0]], title: 'בדיקה מבודדת',
  status: 'open', startsAt: clock, players: ids, pending: [], waitlist: [], visibility: 'private',
  liveMatch: { assignments: {}, benchOrder: [], phase: 'idle', scoreA: 0, scoreB: 0 } });
 await call('startSeasonEvening', ids[0], { gameId: game.id });
 await call('commitRoundStats', ids[0], { gameId: game.id, roundId: 1, sideA: ids.slice(0,2),
  sideB: [ids[2]], winnerSide: 'A', goals: [{ scorerId: ids[0], assisterId: ids[1], team: 'A', minute: 1 }], penalties: [] });
 if (finish) await finishRound(game);
 return game;
}
async function finishRound(game) {
 const before = await game.get();
 await game.update({ status: 'finished', endedBy: 'admin', endedAt: clock });
 const after = await game.get();
 await deliver(before, after);
 assert.equal((await db.doc(`roundSummaries/${game.id}`).get()).exists, true);
 // A redelivered finish must not count a second attendance or rating.
 await deliver(before, await game.get());
}

test('actual round commits, finish aggregation, correction, expiry, archive and titles reconcile', async () => {
 for (const [i, uid] of ids.entries()) {
  await db.doc(`users/${uid}`).set({ name: `בדיקה ${i}`, stats: {} });
  await db.doc(`usersPublic/${uid}`).set({ name: `בדיקה ${i}` });
 }
 await club.set({ name: 'מועדון בדיקה מקומי', adminIds: [ids[0]], playerIds: ids, isPersonal: false });
 await call('enableClubSeasons', ids[0], { groupId: gid, policyVersion: 2, historyChoice: 'fresh', cadenceType: 'rounds', targetRounds: 5 });
 const games = [];
 for (let i = 0; i < 5; i++) games.push(await round());
 let seasons = (await club.get()).get('seasons');
 assert.equal(seasons.playedRounds, 5);
 assert.equal(seasons.currentId, 's1');
 assert.equal(seasons.pendingClose.closeAt - seasons.pendingClose.dueAt, 86400000);
 assert.equal((await db.doc(`communityPlayerStats/${gid}__${ids[0]}`).get()).get('games'), 5);
 await call('addRetroGoal', ids[0], { gameId: games[4].id, scorerId: ids[0], retroGoalId: 'flow-correction' });
 const live = (await db.doc(`communityPlayerStats/${gid}__${ids[0]}`).get()).data();
 assert.equal(live.goals, 6); assert.equal(live.eveningScoreCount, 5);
 assert.equal((await db.doc(`seasonSummary/${gid}__s1`).get()).exists, false);
 // Advance the test-owned deadline, not the global clock used by gRPC.
 await club.update({ 'seasons.pendingClose.closeAt': realNow() - 1 });
 await assert.rejects(call('addRetroGoal', ids[0], { gameId: games[4].id, scorerId: ids[0], retroGoalId: 'too-late' }), /closedSeasonGame/);
 await assert.rejects(call('updateSeasonTarget', ids[0], { groupId: gid, policyVersion: 2, cadenceType: 'rounds', targetRounds: 10, scope: 'current' }), /closedSeasonGame/);
 await call('syncClubSeason', ids[0], { groupId: gid });
 seasons = (await club.get()).get('seasons');
 assert.equal(seasons.currentId, 's2'); assert.equal(seasons.count, 1); assert.equal(seasons.playedRounds, 0);
 const archive = (await db.doc(`seasonSummary/${gid}__s1`).get()).data();
 assert.equal(archive.publicationPending, false); assert.equal(archive.completedRounds, 5);
 assert.equal(archive.players[ids[0]].goals, 6); assert.equal(archive.players[ids[0]].games, 5);
 assert.equal(archive.players[ids[0]].eveningScoreCount, 5);
 assert.equal(archive.awards.mvp.value, Math.round(live.eveningScoreSum / 5 * 100) / 100);
 assert.equal(archive.awards.topWinner.value, 100); assert.equal(archive.awards.topWinner.valueUnit, 'percent');
 assert.equal((await db.doc(`communityPlayerStats/${gid}__${ids[0]}`).get()).get('goals'), 0);
 assert.equal((await db.doc(`users/${ids[0]}/seasonTitles/${gid}__s1__topWinner`).get()).get('valueUnit'), 'percent');
 assert.equal((await db.doc(`seasonCards/${gid}__s1`).get()).get('publicationPending'), false);
 const readers = await clientReaders();
 const closed = await readers.summary.load({ groupId: gid, userId: ids[0], seasonId: 's1' });
 assert.equal(closed.closed, true); assert.equal(closed.completedRounds, 5);
 assert.equal(closed.myTitles.find(t => t.key === 'topWinner').valueUnit, 'percent');
 const current = await readers.summary.load({ groupId: gid, userId: ids[0], seasonId: 's2' });
 assert.equal(current.closed, false); assert.equal(current.completedRounds, 0);
 assert.equal(current.seasonTitles.length, 0); assert.equal(current.club.leaders.some(t => t.key === 'mvp'), false);
 const history = await readers.history.list(gid, true);
 assert.equal(history.filter(s => !s.nonSeason).length, 1);
 const table = await readers.history.table(gid, 's1');
 assert.equal(table.players.find(p => p.uid === ids[0]).goals, 6);
 assert.equal((await readers.titles.list(ids[0])).find(t => t.titleKey === 'topWinner').valueUnit, 'percent');
 await club.update({ adminIds: [], playerIds: ids.slice(1) });
 const former = await readers.summary.load({ groupId: gid, userId: ids[0], seasonId: 's1' });
 assert.equal(former.closed, true); assert.equal(former.available.length, 1);
 assert.equal(former.myTitles.find(t => t.key === 'topWinner').value, 100);
 await club.update({ adminIds: [ids[0]], playerIds: ids });
 const frozen = JSON.stringify(archive);
 await assert.rejects(call('addRetroGoal', ids[0], { gameId: games[0].id, scorerId: ids[0], retroGoalId: 'closed' }), /closedSeasonGame/);
 assert.equal(JSON.stringify((await db.doc(`seasonSummary/${gid}__s1`).get()).data()), frozen);
});

test('a manual close waits for the active round to seal, then cancels the short attempt into the reusable pool', async () => {
 const game = await round({ finish: false });
 await call('disableClubSeasons', ids[0], { groupId: gid, policyVersion: 2 });
 assert.equal((await club.get()).get('seasons.enabled'), true);
 await finishRound(game);
 // Summary refresh is followed explicitly, just as the asynchronous sweep does.
 await call('syncClubSeason', ids[0], { groupId: gid });
 assert.equal((await club.get()).get('seasons.enabled'), false);
 assert.equal((await club.get()).get('seasons.count'), 1);
 assert.equal((await db.doc(`communityPlayerStats/${gid}__${ids[0]}`).get()).get('goals'), 1);
 assert.equal((await call('previewClubSeasons', ids[0], { groupId: gid })).played, 1);
 await call('enableClubSeasons', ids[0], { groupId: gid, policyVersion: 2, historyChoice: 'continue', cadenceType: 'rounds', targetRounds: 5 });
 assert.equal((await club.get()).get('seasons.currentId'), 's2');
 assert.equal((await club.get()).get('seasons.playedRounds'), 1);
 assert.equal((await db.doc(`communityPlayerStats/${gid}__${ids[0]}`).get()).get('goals'), 1);
 const readers = await clientReaders();
 const current = await readers.summary.load({ groupId: gid, userId: ids[0], seasonId: 's2' });
 assert.equal(current.closed, false); assert.equal(current.completedRounds, 1); assert.equal(current.club.numbers.goals, 1);
 const archive = await readers.history.table(gid, 's1');
 const player = (await db.doc(`communityPlayerStats/${gid}__${ids[0]}`).get()).data();
 const live = readers.parseSeasonTable({ players: { [ids[0]]: player }, totals: { goals: 1, rounds: 1 }, completedRounds: 1 });
 assert.equal(readers.mergeAllTime([archive, live]).players.find(p => p.uid === ids[0]).goals, 7);
});

after(async () => { Date.now = realNow; await clientEnvironment?.cleanup(); await db.terminate(); for (const app of admin.apps) await app.delete(); });
