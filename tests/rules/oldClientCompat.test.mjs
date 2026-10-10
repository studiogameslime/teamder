// Historical writes stay covered, with explicit current-contract outcomes.
// The current canceller removes only self; the server creates the next offer.
// These assertions do not claim compatibility with the historical offer writer.
//
// Run: FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node --test tests/rules/oldClientCompat.test.mjs

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
let testEnv;
before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-soccer',
    firestore: {
      rules: readFileSync(process.env.RULES_FILE || join(__dirname, '..', '..', 'firestore.rules'), 'utf8'),
      host: '127.0.0.1', port: 8080,
    },
  });
});
after(async () => { await testEnv.cleanup(); });
beforeEach(async () => { await testEnv.clearFirestore(); });

const db = (uid) => testEnv.authenticatedContext(uid).firestore();
const seed = (w) => testEnv.withSecurityRulesDisabled((c) => w(c.firestore()));
const A = 'alice', B = 'bob', C = 'carol';
const GAME = 'game_1';

async function seedGame(over) {
  await seed((fs) => setDoc(doc(fs, 'games', GAME), {
    title: 'T', groupId: 'g1', createdBy: A, status: 'open',
    visibility: 'community', startsAt: Date.now() + 7 * 864e5,
    players: [], waitlist: [], pending: [], participantIds: [],
    maxPlayers: 2, ...over,
  }));
}

test('auto-shift cancel (net-0: remove self + inject waitlist head into players) is DENIED', async () => {
  // A client-side auto-promotion is a size-neutral member swap. Keep it denied;
  // current cancellation leaves next-seat selection to the server. This test
  // makes no claim about the population of historical installed clients.
  await seedGame({ players: [A, B], waitlist: [C], participantIds: [A, B, C], waitlistApprovalRequired: false });
  await assertFails(updateDoc(doc(db(B), 'games', GAME), {
    players: [A, C], waitlist: [], pending: [],
    participantIds: [A, C], cancellations: { [B]: Date.now() }, updatedAt: Date.now(),
  }));
});

test('historical offer-writing cancel is denied; current self-only cancel with waitlist is allowed', async () => {
  await seedGame({ players: [A, B], waitlist: [C], participantIds: [A, B, C], waitlistApprovalRequired: true });
  const write = updateDoc(doc(db(B), 'games', GAME), {
    players: [A], waitlist: [C], pending: [], participantIds: [A, C],
    pendingPromotion: { uid: C, offeredAt: Date.now() },
    cancellations: { [B]: Date.now() }, updatedAt: Date.now(),
  });
  await assertFails(write);
  await assertSucceeds(updateDoc(doc(db(B), 'games', GAME), {
    players: [A], waitlist: [C], pending: [], participantIds: [A, C],
    cancellations: { [B]: Date.now() }, updatedAt: Date.now(),
  }));
});

test('OLD-CLIENT simple cancel (no waitlist, no teams): B just removes self', async () => {
  await seedGame({ players: [A, B], waitlist: [], participantIds: [A, B] });
  const write = updateDoc(doc(db(B), 'games', GAME), {
    players: [A], waitlist: [], pending: [], participantIds: [A],
    cancellations: { [B]: Date.now() }, updatedAt: Date.now(),
  });
  try { await assertSucceeds(write); console.log('  >>> OLD simple cancel: ALLOWED'); }
  catch { console.log('  >>> OLD simple cancel: DENIED'); throw new Error('DENIED'); }
});
