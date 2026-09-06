// Club members may read a finished evening's per-mini-game history, not only
// the players who were on that week's roster. Non-members must still be denied.
import { readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';

let env;

const GAME = 'g-finished';
const GROUP = 'club-1';
const PLAYER = 'uid-player';   // on the roster
const MEMBER = 'uid-member';   // in the club, NOT on the roster
const OUTSIDER = 'uid-outsider';

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-soccer',
    firestore: {
      rules: readFileSync('../../firestore.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'groups', GROUP), {
      name: 'club', adminIds: [], playerIds: [PLAYER, MEMBER], pendingPlayerIds: [],
    });
    await setDoc(doc(db, 'games', GAME), {
      groupId: GROUP, createdBy: PLAYER, players: [PLAYER], waitlist: [],
      status: 'finished', visibility: 'group',
    });
    await setDoc(doc(db, 'games', GAME, 'roundHistory', 'r1'), { scoreA: 2, scoreB: 1 });
    await setDoc(doc(db, 'games', GAME, 'committedRounds', 'r1'), { at: 1 });
  });
});

after(async () => { await env?.cleanup(); });

const read = (uid, sub) =>
  getDoc(doc(env.authenticatedContext(uid).firestore(), 'games', GAME, sub, 'r1'));

test('a rostered player still reads roundHistory', async () => {
  await assertSucceeds(read(PLAYER, 'roundHistory'));
});

test('a club member who did NOT play reads roundHistory — the fix', async () => {
  await assertSucceeds(read(MEMBER, 'roundHistory'));
});

test('a club member who did NOT play reads committedRounds', async () => {
  await assertSucceeds(read(MEMBER, 'committedRounds'));
});

test('a non-member is still denied roundHistory', async () => {
  await assertFails(read(OUTSIDER, 'roundHistory'));
});

test('a non-member is still denied committedRounds', async () => {
  await assertFails(read(OUTSIDER, 'committedRounds'));
});

test('nobody may write roundHistory', async () => {
  const db = env.authenticatedContext(PLAYER).firestore();
  await assertFails(setDoc(doc(db, 'games', GAME, 'roundHistory', 'r1'), { scoreA: 9 }));
});

test('an unauthenticated reader is denied', async () => {
  const db = env.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(db, 'games', GAME, 'roundHistory', 'r1')));
});
