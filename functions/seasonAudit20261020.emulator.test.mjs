// Regression probes from the 20.10.2026 audit and the subsequent fixes.
// All writes go to an isolated local Firestore project.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const admin = require('firebase-admin'), fs = require('node:fs'), ts = require('../node_modules/typescript');
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
const app = admin.initializeApp({ projectId: 'demo-teamder-seasons-audit' }, 'audit-20261020');
const db = app.firestore();
const { SeasonManager } = require('./lib/seasonManager');
const { assertSeasonOpenForGame } = require('./lib/seasonLock');
const DAY = 86400000, uid = 'audit-player';
let sequence = 0;
const now = Date.now();
const manager = () => new SeasonManager({ db, now: () => now,
  announce: async () => {}, report: async a => { throw a.err; } });
async function fixture(extra = {}) {
 const id = `audit-${process.pid}-${++sequence}`, ref = db.doc(`groups/${id}`);
 const seasons = { policyVersion: 2, revision: 0, enabled: true, count: 0,
  currentId: 's1', currentNo: 1, startedAt: now - 20 * DAY, playedRounds: 5,
  roundsAtStart: 0, cadence: { type: 'rounds', targetRounds: 5 },
  nextCadence: { type: 'rounds', targetRounds: 10 }, ...extra };
 await ref.set({ name: 'בדיקה מבודדת', adminIds: [uid], playerIds: [uid], seasons });
 await db.doc(`users/${uid}`).set({ name: 'בדיקה מבודדת' });
 await db.doc(`communityPlayerStats/${id}__${uid}`).set({ groupId: id, userId: uid,
  games: 5, rounds: 10, wins: 6, goals: 5, eveningScoreSum: 40, eveningScoreCount: 5 });
 await db.doc(`clubRecords/${id}`).set({ eveningsSealed: 5 });
 await db.doc(`communityStats/${id}`).set({ groupId: id, goals: 5, rounds: 10 });
 for (let i = 0; i < 5; i++) await db.doc(`games/${id}-${i}`).set({ groupId: id,
  seasonId: 's1', status: 'finished', startsAt: now - (i + 1) * DAY });
 return { id, ref, seasons, state: async () => (await ref.get()).get('seasons'),
  data: extra => ({ groupId: id, policyVersion: 2, ...extra }) };
}
function verificationHandler() {
 const source = fs.readFileSync(new URL('./src/index.ts', import.meta.url), 'utf8');
 const parsed = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, true);
 const statement = parsed.statements.find(n => ts.isVariableStatement(n) && n.declarationList.declarations.some(d => d.name.getText(parsed) === 'setEveningPlayed'));
 const code = ts.transpileModule(statement.getText(parsed), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
 const deps = { exports: {}, db, console, Date: class extends Date { static now() { return now; } },
  ENFORCE_APP_CHECK: false, onCall: (_, handler) => handler,
  HttpsError: require('firebase-functions/v2/https').HttpsError, seasonManager: manager,
  ...require('./lib/seasonLock'), ...require('./lib/liveSeasonStamp'), ...require('./lib/eveningPlayed') };
 return new Function(...Object.keys(deps), code + '\nreturn exports.setEveningPlayed;')(...Object.values(deps));
}

test('AUDIT-01 expired correction window must reject a statistical correction before sweep', () => {
 assert.throws(() => assertSeasonOpenForGame({ seasons: { policyVersion: 2, enabled: true,
  currentId: 's1', pendingClose: { seasonId: 's1', dueAt: now - 2 * DAY, closeAt: now - 1 } } }, { seasonId: 's1' }));
});

test('AUDIT-02 expired season must not be extended before its automatic close runs', async () => {
 const f = await fixture({ pendingClose: { seasonId: 's1', reason: 'rounds', dueAt: now - 2 * DAY, closeAt: now - 1 } });
 await assert.rejects(manager().updateTarget(f.data({ cadenceType: 'rounds', targetRounds: 12, scope: 'current' }), uid));
});

test('AUDIT-03 unresolved evening without a date must prevent publication', async () => {
 const f = await fixture({ pendingClose: { seasonId: 's1', reason: 'rounds', dueAt: now - 2 * DAY, closeAt: now - 1 } });
 await db.doc(`games/${f.id}-undated`).set({ groupId: f.id, status: 'finished', endedBy: 'auto', players: [uid] });
 assert.equal((await manager().listUnverified(f.id, uid)).items.length, 1);
 await manager().refresh(f.id);
 const s = await f.state();
 assert.equal(s.currentId, 's1', 'must not close while an undated evening awaits its date');
 assert.ok(s.pendingClose.pausedAt, 'the timer must pause');
});

test('AUDIT-04 verification must not move a stamped current-season evening before season start', async () => {
 const f = await fixture({ cadence: { type: 'rounds', targetRounds: 10 } });
 const gameId = `${f.id}-verify`, game = db.doc(`games/${gameId}`);
 await game.set({ groupId: f.id, seasonId: 's1', status: 'finished', endedBy: 'auto',
  startsAt: now - DAY, players: [uid] });
 await assert.rejects(verificationHandler()({ auth: { uid }, data: { gameId, played: true, occurredAt: now - 40 * DAY } }));
});

test('AUDIT-05 a new round must start after the window expires and join the next season', async () => {
 const f = await fixture({ pendingClose: { seasonId: 's1', reason: 'rounds', dueAt: now - 2 * DAY, closeAt: now - 1 } });
 const gameId = `${f.id}-next`, game = db.doc(`games/${gameId}`);
 await game.set({ groupId: f.id, status: 'open', startsAt: now + 1000, createdBy: uid });
 await manager().startEvening(gameId, uid);
 assert.equal((await game.get()).get('seasonId'), 's2');
 assert.equal((await f.state()).currentId, 's2');
});

test('an expired window still admits settlement of the round it is waiting for', async () => {
 const f = await fixture({ pendingClose: { seasonId: 's1', reason: 'rounds', dueAt: now - 2 * DAY, closeAt: now - 1 } });
 assert.doesNotThrow(() => assertSeasonOpenForGame({ seasons: f.seasons }, { seasonId: 's1' }, { settlement: true }));
 const gameId = `${f.id}-undated`, game = db.doc(`games/${gameId}`);
 await game.set({ groupId: f.id, status: 'finished', endedBy: 'auto', players: [uid] });
 await manager().refresh(f.id);
 await verificationHandler()({ auth: { uid }, data: { gameId, played: false } });
 assert.equal((await game.get()).get('playVerified'), false);
 assert.equal((await game.get()).get('startsAt'), undefined);
 assert.equal((await f.state()).currentId, 's2');
});

test('a real pause preserves target editing after the original deadline, while a closed stamp never settles again', async () => {
 const f = await fixture({ pendingClose: { seasonId: 's1', reason: 'rounds', dueAt: now - 2 * DAY,
  closeAt: now - DAY, pausedAt: now - 2 * DAY, remainingMs: 3600000, awaitingVerification: 1 } });
 await manager().updateTarget(f.data({ cadenceType: 'rounds', targetRounds: 12, scope: 'current' }), uid);
 assert.equal((await f.state()).cadence.targetRounds, 12);
 assert.equal((await f.state()).pendingClose, undefined);
 assert.throws(() => assertSeasonOpenForGame({ seasons: { ...f.seasons, currentId: 's2' } }, { seasonId: 's1' }, { settlement: true }), /closedSeasonGame/);
});

test('expiry occurring while a target update acquires its transaction guard is refused', async () => {
 const { acquireSeasonOperation } = require('./lib/seasonOperation');
 const { assertSeasonTargetEditable } = require('./lib/seasonLock');
 const f = await fixture({ pendingClose: { seasonId: 's1', reason: 'rounds', dueAt: now - DAY, closeAt: now + 1 } });
 await assert.rejects(acquireSeasonOperation(db, f.ref, await f.state(), 'updateSeasonTarget', {},
  sea => assertSeasonTargetEditable(sea, now + 1)), /closedSeasonGame/);
 assert.equal((await f.state()).operation, undefined);
 await f.ref.update({ 'seasons.pendingClose.closeAt': now - 1 });
 await assert.rejects(manager().requestClose(f.data(), uid, 'disable'), /closedSeasonGame/);
});

after(async () => { await db.terminate(); await app.delete(); });
