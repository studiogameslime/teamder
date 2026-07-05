// Deployment-safety check: will the NEW tightened rules DENY an OLD (installed)
// client's cancel write? The old client cancelGameV2 does client-side
// auto-promotion / offer / team-prune INSIDE the canceller's write. If the new
// rules reject those, deploying rules to prod breaks "cancel" for every user on
// an old app version until they update.
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
      rules: readFileSync(join(__dirname, '..', '..', 'firestore.rules'), 'utf8'),
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
  // This write shape (canceller does a client-side auto-promotion) is EXACTLY
  // the size-neutral member-swap the anti-hijack rule must block, and NO shipped
  // client produces it: the currently-installed client (1.0.49) uses the offer
  // model (test below), and the auto-mode feature ships in the SAME release as
  // these rules. So denying it is correct and breaks nothing already installed.
  await seedGame({ players: [A, B], waitlist: [C], participantIds: [A, B, C], waitlistApprovalRequired: false });
  await assertFails(updateDoc(doc(db(B), 'games', GAME), {
    players: [A, C], waitlist: [], pending: [],
    participantIds: [A, C], cancellations: { [B]: Date.now() }, updatedAt: Date.now(),
  }));
});

test('OLD-CLIENT manual-offer cancel: B removes self AND sets pendingPromotion to head C', async () => {
  await seedGame({ players: [A, B], waitlist: [C], participantIds: [A, B, C], waitlistApprovalRequired: true });
  const write = updateDoc(doc(db(B), 'games', GAME), {
    players: [A], waitlist: [C], pending: [], participantIds: [A, C],
    pendingPromotion: { uid: C, offeredAt: Date.now() },
    cancellations: { [B]: Date.now() }, updatedAt: Date.now(),
  });
  try { await assertSucceeds(write); console.log('  >>> OLD manual-offer cancel: ALLOWED'); }
  catch { console.log('  >>> OLD manual-offer cancel: DENIED (old clients would break on deploy!)'); throw new Error('DENIED'); }
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
