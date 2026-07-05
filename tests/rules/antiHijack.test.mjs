// Anti-hijack rules tests (audit #1/#2/#6). Proves the self-leave / self-cancel
// branches allow a LEGIT self-only removal but DENY the "remove self + evict a
// victim + inject a stranger" swap AND the duplicate-padding eviction.
//
// Run with the firestore emulator up:
//   firebase emulators:start --only firestore --project demo-soccer
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node --test tests/rules/antiHijack.test.mjs

import { test, before, after, beforeEach } from 'node:test';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { doc, setDoc, updateDoc } from 'firebase/firestore';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectId = 'demo-soccer';
let testEnv;

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId,
    firestore: {
      rules: readFileSync(join(__dirname, '..', '..', 'firestore.rules'), 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});
after(async () => { await testEnv.cleanup(); });
beforeEach(async () => { await testEnv.clearFirestore(); });

const db = (uid) => testEnv.authenticatedContext(uid).firestore();
const seed = (write) =>
  testEnv.withSecurityRulesDisabled((ctx) => write(ctx.firestore()));

const ALICE = 'alice', BOB = 'bob', CAROL = 'carol', STRANGER = 'stranger';
const G = 'group_1', GAME = 'game_1';

// ── Group self-leave (#1) ────────────────────────────────────────────────
async function seedOpenGroup(playerIds) {
  await seed((fs) =>
    setDoc(doc(fs, 'groups', G), {
      name: 'G', creatorId: ALICE, adminIds: [ALICE],
      playerIds, pendingPlayerIds: [], isOpen: true, maxMembers: 50,
    }),
  );
}

test('#1 LEGIT: a member can remove ONLY themselves from playerIds', async () => {
  await seedOpenGroup([ALICE, BOB, CAROL]);
  await assertSucceeds(
    updateDoc(doc(db(BOB), 'groups', G), {
      playerIds: [ALICE, CAROL], updatedAt: Date.now(),
    }),
  );
});

test('#1 HIJACK denied: remove self + evict victim + inject stranger (net −1)', async () => {
  await seedOpenGroup([ALICE, BOB, CAROL]);
  // BOB drops himself AND CAROL and plants STRANGER → size 3→2.
  await assertFails(
    updateDoc(doc(db(BOB), 'groups', G), {
      playerIds: [ALICE, STRANGER], updatedAt: Date.now(),
    }),
  );
});

test('#1 DUPLICATE-PADDING denied: evict victim, pad with a duplicate survivor', async () => {
  await seedOpenGroup([ALICE, BOB, CAROL]);
  // BOB drops himself AND CAROL, pads ALICE twice → size 3→2, no stranger.
  await assertFails(
    updateDoc(doc(db(BOB), 'groups', G), {
      playerIds: [ALICE, ALICE], updatedAt: Date.now(),
    }),
  );
});

test('#1 denied: a member cannot evict another member (plain, no self-removal)', async () => {
  await seedOpenGroup([ALICE, BOB, CAROL]);
  // BOB tries to drop CAROL while staying → not a self-leave at all.
  await assertFails(
    updateDoc(doc(db(BOB), 'groups', G), {
      playerIds: [ALICE, BOB], updatedAt: Date.now(),
    }),
  );
});

// ── Group pending self-cancel (#6) ───────────────────────────────────────
async function seedGroupWithPending(pendingPlayerIds) {
  await seed((fs) =>
    setDoc(doc(fs, 'groups', G), {
      name: 'G', creatorId: ALICE, adminIds: [ALICE],
      playerIds: [ALICE], pendingPlayerIds, isOpen: false, maxMembers: 50,
    }),
  );
}

test('#6 LEGIT: a requester can withdraw ONLY their own pending request', async () => {
  await seedGroupWithPending([BOB, CAROL]);
  await assertSucceeds(
    updateDoc(doc(db(BOB), 'groups', G), {
      pendingPlayerIds: [CAROL], updatedAt: Date.now(),
    }),
  );
});

test('#6 HIJACK denied: wipe the queue + inject stranger requests', async () => {
  await seedGroupWithPending([BOB, CAROL]);
  // BOB removes himself + CAROL and plants STRANGER → size 2→1.
  await assertFails(
    updateDoc(doc(db(BOB), 'groups', G), {
      pendingPlayerIds: [STRANGER], updatedAt: Date.now(),
    }),
  );
});

test('#6 DUPLICATE-PADDING denied: drop a rival request, pad a duplicate', async () => {
  await seedGroupWithPending([BOB, CAROL, 'dave']);
  // BOB drops himself AND CAROL, pads dave twice → size 3→2.
  await assertFails(
    updateDoc(doc(db(BOB), 'groups', G), {
      pendingPlayerIds: ['dave', 'dave'], updatedAt: Date.now(),
    }),
  );
});

// ── Game self-cancel (#2) ────────────────────────────────────────────────
async function seedGame(players) {
  await seed((fs) =>
    setDoc(doc(fs, 'games', GAME), {
      title: 'T', groupId: G, createdBy: ALICE, status: 'open',
      visibility: 'community', startsAt: Date.now() + 7 * 864e5,
      players, waitlist: [], pending: [], participantIds: players,
      maxPlayers: 12,
    }),
  );
}

test('#2 LEGIT: a player can cancel ONLY themselves from a game', async () => {
  await seedGame([ALICE, BOB, CAROL]);
  await assertSucceeds(
    updateDoc(doc(db(BOB), 'games', GAME), {
      players: [ALICE, CAROL], waitlist: [], pending: [],
      participantIds: [ALICE, CAROL],
      cancellations: { [BOB]: Date.now() }, updatedAt: Date.now(),
    }),
  );
});

test('#2 HIJACK denied: cancel self + evict victim + seat a stranger', async () => {
  await seedGame([ALICE, BOB, CAROL]);
  await assertFails(
    updateDoc(doc(db(BOB), 'games', GAME), {
      players: [ALICE, STRANGER], waitlist: [], pending: [],
      participantIds: [ALICE, STRANGER],
      cancellations: { [BOB]: Date.now() }, updatedAt: Date.now(),
    }),
  );
});

test('#2 DUPLICATE-PADDING denied: cancel self + evict victim, pad a duplicate', async () => {
  await seedGame([ALICE, BOB, CAROL]);
  await assertFails(
    updateDoc(doc(db(BOB), 'games', GAME), {
      players: [ALICE, ALICE], waitlist: [], pending: [],
      participantIds: [ALICE, ALICE],
      cancellations: { [BOB]: Date.now() }, updatedAt: Date.now(),
    }),
  );
});
