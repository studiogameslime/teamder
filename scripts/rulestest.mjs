// Standalone Firestore rules test for the confirmed game-doc security holes.
// Run with the Firestore emulator up:  node scripts/rulestest.mjs
import { readFileSync } from 'fs';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc } from 'firebase/firestore';

const env = await initializeTestEnvironment({
  projectId: 'demo-teamder',
  firestore: {
    rules: readFileSync('firestore.rules', 'utf8'),
    host: '127.0.0.1',
    port: 8080,
  },
});

let pass = 0, fail = 0;
const check = async (name, p) => {
  try { await p; console.log('  ✅', name); pass++; }
  catch (e) { console.log('  ❌', name, '—', (e.message || e).slice(0, 90)); fail++; }
};

// Seed a game doc via the rules-disabled admin context.
async function seed(data) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'groups/grp1'), {
      id: 'grp1', creatorId: 'owner', adminIds: ['owner'],
      playerIds: ['owner', 'B'], pendingPlayerIds: [], isOpen: true,
    });
    await setDoc(doc(db, 'games/g1'), data);
  });
}
const BASE = {
  id: 'g1', groupId: 'grp1', createdBy: 'owner', status: 'open',
  players: ['owner'], waitlist: ['B'], pending: [], participantIds: ['owner', 'B'],
  maxPlayers: 1, cancellations: {}, joinedAt: { owner: 100 },
  ballBringerIds: ['owner'], rejectedPlayerIds: [], updatedAt: 1,
};
const asB = () => env.authenticatedContext('B').firestore();
const g = (db) => doc(db, 'games/g1');

console.log('Rules tests (game-doc self-write holes):');

// (1) pendingPromotion forge — a client sets pendingPromotion.uid=self.
await seed({ ...BASE });
await check('pendingPromotion: forge self-offer is DENIED',
  assertFails(updateDoc(g(asB()), { pendingPromotion: { uid: 'B' }, updatedAt: 2 })));

// (2) pendingPromotion legit — the offeree clears their own offer (pass/cancel).
await seed({ ...BASE, pendingPromotion: { uid: 'B', offeredAt: 5 } });
await check('pendingPromotion: clearing own offer (null) is ALLOWED',
  assertSucceeds(updateDoc(g(asB()), { pendingPromotion: null, updatedAt: 2 })));

// (3) cancellations griefing — inject a cancellation under someone else's uid.
await seed({ ...BASE });
await check('cancellations: writing another uid is DENIED',
  assertFails(updateDoc(g(asB()), { cancellations: { victim: 999 }, updatedAt: 2 })));

// (4) cancellations legit — a player records their OWN cancellation.
await seed({ ...BASE, players: ['owner', 'B'], waitlist: [], participantIds: ['owner', 'B'] });
await check('cancellations: writing own uid is ALLOWED',
  assertSucceeds(updateDoc(g(asB()), {
    players: ['owner'], participantIds: ['owner'],
    cancellations: { B: 999 }, updatedAt: 2,
  })));

// (5) ballBringerIds swap — remove someone else, add self (same size).
await seed({ ...BASE });
await check('ballBringer: same-size swap (forge others) is DENIED',
  assertFails(updateDoc(g(asB()), { ballBringerIds: ['B'], updatedAt: 2 })));

// (6) ballBringer legit — add self.
await seed({ ...BASE });
await check('ballBringer: adding own uid is ALLOWED',
  assertSucceeds(updateDoc(g(asB()), { ballBringerIds: ['owner', 'B'], updatedAt: 2 })));

// (7) legit spot-offer ACCEPT — waitlisted B is the offeree, moves to players
//     and clears the offer. Must still work (clause d relies on the OLD offer).
await seed({ ...BASE, players: ['owner'], waitlist: ['B'], maxPlayers: 2,
  participantIds: ['owner', 'B'], pendingPromotion: { uid: 'B', offeredAt: 5 } });
await check('spot-offer accept (waitlist→players, clear offer) is ALLOWED',
  assertSucceeds(updateDoc(g(asB()), {
    players: ['owner', 'B'], waitlist: [], participantIds: ['owner', 'B'],
    pendingPromotion: null, joinedAt: { owner: 100, B: 200 }, updatedAt: 2,
  })));

// (8) legit self-withdraw from the WAITLIST (no cancellations/offer touched).
await seed({ ...BASE, players: ['owner'], waitlist: ['B'], participantIds: ['owner', 'B'] });
await check('self-withdraw from waitlist is ALLOWED',
  assertSucceeds(updateDoc(g(asB()), {
    waitlist: [], participantIds: ['owner'], updatedAt: 2,
  })));

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
await env.cleanup();
process.exit(fail ? 1 : 0);
