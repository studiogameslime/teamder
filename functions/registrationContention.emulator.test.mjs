// Run with Node 22.18+ and an isolated Firestore emulator on localhost:8186.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import ts from 'typescript';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import admin from 'firebase-admin';
import { doc, updateDoc, runTransaction } from 'firebase/firestore';
import { enqueueGameJoin } from '../src/services/enqueueGameJoin.ts';

const projectId = 'demo-filler-review';
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8186';
process.env.GCLOUD_PROJECT = projectId;
process.env.FIREBASE_CONFIG = JSON.stringify({ projectId });
const runId = Date.now().toString(36);
let api, db, env;
before(async () => {
  env = await initializeTestEnvironment({ projectId, firestore: { host: '127.0.0.1', port: 8186,
    rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8') } });
  api = await import('./lib/index.js');
  db = admin.firestore();
});
after(async () => {
  await env?.cleanup();
  await Promise.all(admin.apps.map(app => app.delete()));
});

async function round(label, options = {}) {
  const ref = db.doc('games/' + runId + '-' + label);
  const regular = ref.id + '-member', other = ref.id + '-other', filler = ref.id + '-filler';
  await Promise.all([
    db.doc('groups/' + ref.id).set({ adminIds: ['creator'], playerIds: ['creator', regular, other] }),
    ...[regular, other].map(uid => db.doc('users/' + uid).set({ isGuest: false })),
    ref.set({ groupId: ref.id, createdBy: 'creator', status: 'open', visibility: 'public', startsAt: Date.now() + 3600000,
      acceptsFillers: true, maxPlayers: 1, players: [], pending: [], waitlist: [], ...options }),
  ]);
  return { ref, regular, other, filler };
}
const client = uid => env.authenticatedContext(uid).firestore();
const enqueue = (ref, uid, time = Date.now(), device = client(uid)) => enqueueGameJoin(device, ref.id, uid, time);
const reconcile = ref => api.onJoinRequestCreated.run({ params: { gameId: ref.id }, data: { createTime: { toMillis: () => 0 } } });
const call = (name, uid, data) => api[name].run({ auth: { uid, token: { firebase: { sign_in_provider: 'password' } } }, data });
const submit = (ref, uid) => call('submitFillerInterest', uid, { gameId: ref.id, source: 'round' });
const approve = (ref, uid) => call('approveFiller', 'creator', { gameId: ref.id, candidateUid: uid });

test('the server distinguishes a real decline from an application overtaken by regular registration', async () => {
  const { ref, filler } = await round('decline-receipt');
  const params = { gameId: ref.id, candidateUid: filler };
  await submit(ref, filler);
  assert.equal((await call('declineFiller', 'creator', params)).declined, true);
  await submit(ref, filler);
  await ref.update({ players: [filler], participantIds: [filler] });
  assert.equal((await call('declineFiller', 'creator', params)).declined, false);
  assert.equal((await ref.collection('fillerInterests').doc(filler).get()).get('status'), 'superseded');
});

test('retrying a queued tap from a second device keeps its original place ahead of a later rival', async () => {
  const { ref, regular, other } = await round('retry');
  const start = Date.now();
  await enqueue(ref, regular, start);
  const request = ref.collection('joinRequests').doc(regular);
  const before = await request.get();
  await enqueue(ref, other, start + 40);
  await enqueue(ref, regular, start + 80);
  await reconcile(ref);
  const after = await request.get();
  assert.equal(after.get('tappedAt'), start);
  assert.deepEqual(after.get('requestedAt'), before.get('requestedAt'));
  assert.equal(after.get('bucket'), 'players');
  const game = (await ref.get()).data();
  assert.deepEqual(game.players, [regular]);
  assert.deepEqual(game.waitlist, [other]);
});

test('simultaneous devices and a redelivered event create one registration, and leaving permits a fresh request', async () => {
  const { ref, regular } = await round('devices');
  assert.deepEqual((await Promise.all([enqueue(ref, regular), enqueue(ref, regular)])).sort(), ['created', 'listen']);
  await Promise.all([reconcile(ref), reconcile(ref)]);
  const request = ref.collection('joinRequests').doc(regular);
  const first = await request.get();
  assert.equal(first.get('registrationCreated'), true);
  await enqueue(ref, regular);
  assert.deepEqual((await request.get()).updateTime, first.updateTime);
  assert.deepEqual((await ref.get()).get('players'), [regular]);
  await ref.update({ players: [], participantIds: [] });
  await enqueue(ref, regular);
  assert.equal((await request.get()).get('state'), 'queued');
  await reconcile(ref);
  assert.equal((await request.get()).get('registrationCreated'), true);
  assert.deepEqual((await ref.get()).get('players'), [regular]);
});

for (const order of ['member-first', 'filler-first', 'simultaneous']) {
  test('one place shared by member registration and manager approval: ' + order, async () => {
    const { ref, regular, filler } = await round(order);
    await Promise.all([enqueue(ref, regular), submit(ref, filler)]);
    if (order === 'member-first') { await reconcile(ref); await approve(ref, filler); }
    else if (order === 'filler-first') { await approve(ref, filler); await reconcile(ref); }
    else await Promise.all([reconcile(ref), approve(ref, filler)]);
    await reconcile(ref);
    const g = (await ref.get()).data();
    assert.equal(g.players.length, 1);
    assert.equal(g.waitlist.length, 1);
    assert.deepEqual([...new Set([...g.players, ...g.waitlist])].sort(), [regular, filler].sort());
    assert.deepEqual(new Set(g.participantIds), new Set([regular, filler]));
    if (order !== 'simultaneous') assert.equal(g.players[0], order === 'member-first' ? regular : filler);
    const memberBucket = g.players.includes(regular) ? 'players' : 'waitlist';
    const fillerBucket = g.players.includes(filler) ? 'players' : 'waitlist';
    assert.equal((await ref.collection('joinRequests').doc(regular).get()).get('bucket'), memberBucket);
    assert.equal((await ref.collection('fillerInterests').doc(filler).get()).get('bucket'), fillerBucket);
    const notices = await db.collection('notifications').where('recipientId', '==', filler).get();
    assert.equal(notices.size, 1);
    assert.equal(notices.docs[0].get('payload.bucket'), fillerBucket);
  });
}

test('an active guest and an outstanding promotion reserve seats across both registration paths', async () => {
  const { ref, regular, filler } = await round('reserved', { maxPlayers: 2,
    guests: [{ id: 'active' }, { id: 'waiting', waitlisted: true }], pendingPromotion: { uid: 'offered' },
    waitlist: ['offered'] });
  await Promise.all([enqueue(ref, regular), submit(ref, filler)]);
  await Promise.all([reconcile(ref), approve(ref, filler)]);
  const g = (await ref.get()).data();
  assert.deepEqual(g.players, []);
  assert.deepEqual([...g.waitlist].sort(), [regular, filler, 'offered'].sort());
  assert.equal(g.waitlist[0], 'offered');
  assert.equal(g.pendingPromotion.uid, 'offered');
});

test('a postponed opening rejects the queued request; after reopening the same player can retry', async () => {
  const { ref, regular } = await round('postponed');
  await enqueue(ref, regular);
  await ref.update({ status: 'scheduled', registrationOpensAt: Date.now() + 60000 });
  await reconcile(ref);
  const receipt = ref.collection('joinRequests').doc(regular);
  assert.equal((await receipt.get()).get('reason'), 'GAME_NOT_OPEN');
  assert.deepEqual((await ref.get()).get('players'), []);
  await ref.update({ status: 'open', registrationOpensAt: Date.now() - 1000 });
  await enqueue(ref, regular);
  await reconcile(ref);
  assert.equal((await receipt.get()).get('bucket'), 'players');
});

test('a burst of twelve members gets one last place in tap order across overlapping handlers', async () => {
  const { ref } = await round('burst', { maxPlayers: 2, players: ['first'] });
  const members = Array.from({ length: 12 }, (_, index) => ref.id + '-' + index);
  await db.doc('groups/' + ref.id).update({ playerIds: members });
  await Promise.all(members.map(uid => db.doc('users/' + uid).set({ isGuest: false })));
  const start = Date.now();
  await Promise.all([...members].reverse().map(uid => enqueue(ref, uid, start + members.indexOf(uid) * 10)));
  await Promise.all([reconcile(ref), reconcile(ref)]);
  const game = (await ref.get()).data();
  assert.deepEqual(game.players, ['first', members[0]]);
  assert.deepEqual(game.waitlist, members.slice(1));
  assert.equal(new Set(game.participantIds).size, 13);
});

test('a registered player and an active guest of the same name occupy independent seats', async () => {
  const guest = { id: 'local-guest', name: 'גיא' };
  const { ref, regular } = await round('same-name', { guests: [guest], maxPlayers: 2 });
  await db.doc('users/' + regular).update({ name: guest.name });
  await enqueue(ref, regular);
  await reconcile(ref);
  const game = (await ref.get()).data();
  assert.deepEqual(game.guests, [guest]);
  assert.deepEqual(game.players, [regular]);
  assert.deepEqual(game.participantIds, [regular]);
});

for (const member of [true, false]) {
  test('a blocked invitation no longer authorizes direct placement for a ' + (member ? 'club member' : 'nonmember'),
    { todo: member ? 'Confirmed: existing member bypasses manager approval; permission change requires owner review' : false }, async () => {
    const { ref, regular } = await round('blocked-' + member, { visibility: 'private', requiresApproval: true, acceptsFillers: false });
    if (!member) await db.doc('groups/' + ref.id).update({ playerIds: ['creator'] });
    await ref.update({ approvedInvites: { [regular]: { inviterId: 'creator', expiresAt: Date.now() + 60000 } }, invitedUserIds: [regular] });
    await enqueue(ref, regular);
    await db.doc('users/' + regular + '/blocked/creator').set({ at: Date.now() });
    await reconcile(ref);
    const request = await ref.collection('joinRequests').doc(regular).get();
    const game = (await ref.get()).data();
    assert.deepEqual(game.players, []);
    if (member) {
      assert.equal(request.get('bucket'), 'pending');
      assert.deepEqual(game.pending, [regular]);
    } else {
      assert.equal(request.get('reason'), 'GAME_JOIN_FORBIDDEN');
      assert.deepEqual(game.pending, []);
    }
  });
}

for (const order of ['withdraw-first', 'approve-first', 'simultaneous']) {
  test('withdraw versus approve leaves the filler receipt consistent with the roster: ' + order,
    { todo: order !== 'withdraw-first' ? 'Direct withdrawal after approval can rewrite an approved interest; changes to rules require owner review' : false },
    async () => {
      const { ref, filler } = await round(order);
      await submit(ref, filler);
      const withdraw = () => updateDoc(doc(client(filler), 'games', ref.id, 'fillerInterests', filler), { status: 'cancelled', updatedAt: Date.now() });
      if (order === 'withdraw-first') {
        await withdraw();
        await assert.rejects(approve(ref, filler), e => e.code === 'failed-precondition');
      } else if (order === 'approve-first') {
        await approve(ref, filler);
        await withdraw().catch(e => assert.equal(e.code, 'permission-denied'));
      } else {
        await Promise.allSettled([approve(ref, filler), withdraw()]);
      }
      const status = (await ref.collection('fillerInterests').doc(filler).get()).get('status');
      const players = (await ref.get()).get('players');
      assert.ok(status === 'cancelled' || status === 'approved');
      assert.equal(players.includes(filler), status === 'approved');
    });
}

test('two equal tap times and equal arrivals break the tie by player id even on event redelivery', async () => {
  const { ref, regular, other } = await round('tied');
  const instant = admin.firestore.Timestamp.now();
  const batch = db.batch();
  for (const uid of [regular, other]) batch.set(ref.collection('joinRequests').doc(uid), {
    uid, state: 'queued', tappedAt: instant.toMillis(), requestedAt: instant,
  });
  await batch.commit();
  await Promise.all([reconcile(ref), reconcile(ref)]);
  const ordered = [regular, other].sort();
  assert.deepEqual((await ref.get()).get('players'), [ordered[0]]);
  assert.deepEqual((await ref.get()).get('waitlist'), [ordered[1]]);
});

test('a former member cannot use an offer addressed to a current member', async () => {
  const { ref, regular, other } = await round('past-member', { visibility: 'private' });
  await db.doc('groups/' + ref.id).update({ playerIds: [other] });
  await ref.update({ waitlist: [other], pendingPromotion: { uid: other, offeredAt: Date.now() } });
  await assert.rejects(call('resolveSpotOffer', regular, { gameId: ref.id, decision: 'confirm' }),
    e => e.code === 'failed-precondition' && e.message === 'STALE_OFFER');
  assert.deepEqual((await ref.get()).get('players'), []);
  await call('resolveSpotOffer', other, { gameId: ref.id, decision: 'confirm' });
  assert.deepEqual((await ref.get()).get('players'), [other]);
});

test('a two-minute offer cannot be accepted after its deadline while the expiry sweep is pending', async () => {
  const { ref, regular } = await round('expired', { waitlistApprovalTimeoutMinutes: 2 });
  await ref.update({ waitlist: [regular], pendingPromotion: { uid: regular, offeredAt: Date.now() - 121000 } });
  await assert.rejects(call('resolveSpotOffer', regular, { gameId: ref.id, decision: 'confirm' }),
    e => e.code === 'failed-precondition' && e.message === 'STALE_OFFER');
  assert.deepEqual((await ref.get()).get('players'), []);
});

test('registered roster hands over the same members and guest to three games and the season archive', async () => {
  const ref = db.doc('games/audit'), groupId = 'club', guest = { id: 'same-name', name: 'דני' };
  const members = Array.from({ length: 12 }, (_, i) => 't' + Math.floor(i / 3) + '-p' + (i % 3));
  const joining = members[0], leaving = 'departing';
  const initial = [...members.slice(1), leaving];
  await db.doc('groups/' + groupId).set({ adminIds: ['owner'], playerIds: [...members, leaving] });
  await Promise.all([joining, leaving].map(uid => db.doc('users/' + uid).set({ name: 'דני', isGuest: false })));
  await ref.collection('joinRequests').doc(joining).delete();
  await ref.set({ groupId, createdBy: 'owner', status: 'open', startsAt: Date.now() + 3600000,
    visibility: 'public', acceptsFillers: true, maxPlayers: 13, guests: [guest], players: initial,
    waitlist: [], pending: [], participantIds: initial, updatedAt: Date.now() });
  await enqueue(ref, joining);
  await reconcile(ref);
  const before = await ref.get();
  assert.deepEqual(before.get('waitlist'), [joining]);
  // Execute the app's cancellation body, with real user-scoped transactions.
  // Diagnostics, analytics and outgoing notification delivery are local stubs.
  const body = await readFile(new URL('../src/services/gameService.ts', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('service.ts', body, ts.ScriptTarget.Latest, true);
  let method;
  const find = n => {
    if (ts.isMethodDeclaration(n) && n.name.getText(ast) === 'cancelGameV2') method = n.getText(ast);
    ts.forEachChild(n, find);
  };
  find(ast);
  assert.ok(method);
  const device = client(leaving);
  const cancellationEvents = [];
  const bindings = {
    USE_MOCK_DATA: false, clearMyGamesCache() {}, runDiagnosticOperation: (_name, _params, fn) => fn(),
    docs: { game: id => doc(device, 'games', id) }, getFirebase: () => ({ db: device }), runTransaction,
    logEvent: type => cancellationEvents.push(type), notificationsService: { notifyPlayerCancelled() {} }, AnalyticsEvent: { GameCancelled: 'cancelled' },
    observeCaughtError() {}, logError() {}, logUnexpected() {}, Date, console,
  };
  // Firestore accepts objects from its own realm. Keep the production method
  // in this realm while injecting only its test dependencies.
  const methodJs = ts.transpileModule('({' + method + '})', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const cancel = Function(...Object.keys(bindings), 'return ' + methodJs)(...Object.values(bindings));
  await cancel.cancelGameV2(ref.id, leaving);
  const cancelled = await ref.get();
  assert.ok(!cancelled.get('players').includes(leaving));
  await cancel.cancelGameV2(ref.id, leaving);
  assert.deepEqual((await ref.get()).updateTime, cancelled.updateTime);
  assert.deepEqual(cancellationEvents, ['cancelled']);
  await api.onGameRosterChanged.run({ params: { gameId: ref.id }, data: { before, after: cancelled } });
  assert.equal((await ref.get()).get('pendingPromotion.uid'), joining);
  assert.equal((await call('resolveSpotOffer', joining, { gameId: ref.id, decision: 'confirm' })).changed, true);
  assert.equal((await call('resolveSpotOffer', joining, { gameId: ref.id, decision: 'confirm' })).changed, false);
  const final = (await ref.get()).data();
  assert.deepEqual(new Set(final.players), new Set(members));
  assert.deepEqual(final.guests, [guest]);
  assert.deepEqual(final.waitlist, []);
  assert.deepEqual(new Set(final.participantIds), new Set(members));
  if (process.env.TEAMDER_WRITE_EVENING_EVIDENCE === '1') {
    await writeFile(new URL('../docs/audits/2026-11-04-system-night/evidence/evening-roster.json', import.meta.url),
      JSON.stringify({ gameId: ref.id, groupId, maxPlayers: final.maxPlayers, joining, leaving,
        guests: final.guests, players: final.players, waitlist: final.waitlist, participantIds: final.participantIds }, null, 2) + '\n');
  }
});
