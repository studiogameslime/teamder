// Cross-club isolation for the server-written stat rollups (audit P0-1).
//
// The bug these lock down: /communityPlayerStats, /communityStats,
// /gamePlayerStats and /communityPairStats were all `allow read: if
// isSignedIn()`, so any account could read every club's table, totals and pair
// chemistry. /communityPairStats was the worst case — a membership-gated match
// block for it already existed, but a SECOND permissive block for the same
// collection sat further down the file, and Firestore ORs overlapping match
// blocks (the more specific one does NOT win), so the gate was dead code.
//
// Run with the emulator up:
//   firebase emulators:start --only firestore --project demo-soccer
//   cd tests/rules && node --test clubIsolation.test.mjs

import { test, before, after, beforeEach } from 'node:test';
import { initializeTestEnvironment, assertFails, assertSucceeds }
  from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { doc, getDoc, setDoc, collection, query, where, getDocs, limit }
  from 'firebase/firestore';

const __dirname = dirname(fileURLToPath(import.meta.url));
let env;

const GID = 'clubA';            // the club that owns the data
const OTHER = 'clubB';          // a club the outsider really belongs to
const MEMBER = 'uMember';
const ADMIN = 'uAdmin';
const OUTSIDER = 'uOutsider';   // signed in, member of clubB only
const GAME = 'gameA';

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-soccer',
    firestore: {
      rules: readFileSync(join(__dirname, '..', '..', 'firestore.rules'), 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});
after(async () => env.cleanup());

const db = (uid) => env.authenticatedContext(uid).firestore();
const anon = () => env.unauthenticatedContext().firestore();

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const d = ctx.firestore();
    await setDoc(doc(d, 'groups', GID), {
      name: 'Club A', playerIds: [MEMBER], adminIds: [ADMIN], creatorId: ADMIN,
    });
    await setDoc(doc(d, 'groups', OTHER), {
      name: 'Club B', playerIds: [OUTSIDER], adminIds: [OUTSIDER], creatorId: OUTSIDER,
    });
    // A private, community-only game of club A.
    await setDoc(doc(d, 'games', GAME), {
      groupId: GID, createdBy: ADMIN, visibility: 'community',
      players: [MEMBER], participantIds: [MEMBER], status: 'finished',
      title: 'A', maxPlayers: 10, startsAt: 1,
    });
    await setDoc(doc(d, 'communityPlayerStats', `${GID}__${MEMBER}`),
      { groupId: GID, userId: MEMBER, goals: 7, rounds: 3, wins: 2 });
    await setDoc(doc(d, 'communityStats', GID), { groupId: GID, goals: 40, rounds: 12 });
    await setDoc(doc(d, 'communityPairStats', `${GID}__${MEMBER}__${ADMIN}`),
      { groupId: GID, a: ADMIN, b: MEMBER, sameTeam: 5, assists: 2 });
    await setDoc(doc(d, 'gamePlayerStats', `${GAME}__${MEMBER}`),
      { gameId: GAME, userId: MEMBER, goals: 2, rounds: 3 });
  });
});

// ── get(document) ────────────────────────────────────────────────────────
const DOCS = [
  ['communityPlayerStats', `${GID}__${MEMBER}`],
  ['communityStats', GID],
  ['communityPairStats', `${GID}__${MEMBER}__${ADMIN}`],
  ['gamePlayerStats', `${GAME}__${MEMBER}`],
];

for (const [col, id] of DOCS) {
  test(`${col}: club MEMBER can get`, async () => {
    await assertSucceeds(getDoc(doc(db(MEMBER), col, id)));
  });
  test(`${col}: club ADMIN can get`, async () => {
    await assertSucceeds(getDoc(doc(db(ADMIN), col, id)));
  });
  test(`${col}: signed-in NON-member is denied get`, async () => {
    await assertFails(getDoc(doc(db(OUTSIDER), col, id)));
  });
  test(`${col}: UNAUTHENTICATED is denied get`, async () => {
    await assertFails(getDoc(doc(anon(), col, id)));
  });
  test(`${col}: client write stays blocked even for the admin`, async () => {
    await assertFails(setDoc(doc(db(ADMIN), col, id), { goals: 999 }, { merge: true }));
  });
}

// ── list / query — the path the app actually uses ────────────────────────
// A list is evaluated per candidate document, so the group-filtered queries the
// screens issue must succeed for a member and fail for an outsider. Testing
// only get() would miss a rule that happens to pass on one doc.

test('list communityPlayerStats where groupId==club: member OK, outsider denied', async () => {
  const q = (uid) => query(collection(db(uid), 'communityPlayerStats'), where('groupId', '==', GID));
  await assertSucceeds(getDocs(q(MEMBER)));
  await assertFails(getDocs(q(OUTSIDER)));
  await assertFails(getDocs(query(collection(anon(), 'communityPlayerStats'), where('groupId', '==', GID))));
});

test('list communityPairStats where groupId==club: member OK, outsider denied', async () => {
  const q = (uid) => query(collection(db(uid), 'communityPairStats'), where('groupId', '==', GID));
  await assertSucceeds(getDocs(q(MEMBER)));
  await assertFails(getDocs(q(OUTSIDER)));
});

test('list communityStats where groupId==club: member OK, outsider denied', async () => {
  const q = (uid) => query(collection(db(uid), 'communityStats'), where('groupId', '==', GID));
  await assertSucceeds(getDocs(q(MEMBER)));
  await assertFails(getDocs(q(OUTSIDER)));
});

test('list gamePlayerStats where gameId==game: member OK, outsider denied', async () => {
  const q = (uid) => query(collection(db(uid), 'gamePlayerStats'), where('gameId', '==', GAME));
  await assertSucceeds(getDocs(q(MEMBER)));
  await assertFails(getDocs(q(OUTSIDER)));
});

// An UNFILTERED sweep of the whole collection is the raw exfiltration attempt.
// It must fail for everyone — including a member, who is only entitled to their
// own club's slice, not to whatever the first page happens to contain.
test('unfiltered collection sweeps are denied for member and outsider alike', async () => {
  for (const col of ['communityPlayerStats', 'communityStats', 'communityPairStats', 'gamePlayerStats']) {
    await assertFails(getDocs(query(collection(db(OUTSIDER), col), limit(50))));
    await assertFails(getDocs(query(collection(db(MEMBER), col), limit(50))));
  }
});

// ── gamePlayerStats follows the GAME's audience, not the club's ──────────
test('gamePlayerStats: a PUBLIC game stays readable by any signed-in user', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const d = ctx.firestore();
    await setDoc(doc(d, 'games', 'pubGame'), {
      groupId: GID, createdBy: ADMIN, visibility: 'public',
      players: [MEMBER], participantIds: [MEMBER], status: 'finished',
      title: 'P', maxPlayers: 10, startsAt: 1,
    });
    await setDoc(doc(d, 'gamePlayerStats', `pubGame__${MEMBER}`),
      { gameId: 'pubGame', userId: MEMBER, goals: 1 });
  });
  // No regression: the finished-game scorers table on a public game still loads
  // for someone outside the club, exactly as it does today.
  await assertSucceeds(getDoc(doc(db(OUTSIDER), 'gamePlayerStats', `pubGame__${MEMBER}`)));
  await assertFails(getDoc(doc(anon(), 'gamePlayerStats', `pubGame__${MEMBER}`)));
});

test('gamePlayerStats: a game PARTICIPANT who is not a club member can read', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const d = ctx.firestore();
    await setDoc(doc(d, 'games', 'invGame'), {
      groupId: GID, createdBy: ADMIN, visibility: 'community',
      players: [OUTSIDER], participantIds: [OUTSIDER], status: 'finished',
      title: 'I', maxPlayers: 10, startsAt: 1,
    });
    await setDoc(doc(d, 'gamePlayerStats', `invGame__${OUTSIDER}`),
      { gameId: 'invGame', userId: OUTSIDER, goals: 1 });
  });
  await assertSucceeds(getDoc(doc(db(OUTSIDER), 'gamePlayerStats', `invGame__${OUTSIDER}`)));
});

// ── legacy per-club rating summaries ────────────────────────────────────
test('groups/{gid}/ratings is club-scoped, not world-readable', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'groups', GID, 'ratings', MEMBER),
      { average: 4.2, count: 9 });
  });
  await assertSucceeds(getDoc(doc(db(MEMBER), 'groups', GID, 'ratings', MEMBER)));
  await assertFails(getDoc(doc(db(OUTSIDER), 'groups', GID, 'ratings', MEMBER)));
});

// Backward compatibility: one production communityStats doc (a hidden personal
// group's, created only by the chemistry-window write) has never carried a
// `groupId` field. A field-only rule would have made it permanently unreadable
// for its own owner, so the `allow get` statement covers it via the path
// wildcard.
test('communityStats: a doc with NO groupId field is still readable by its member', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'communityStats', GID),
      { kingGoalsSum: 0, kingGoalsCount: 0, updatedAt: 1 });   // no groupId
  });
  await assertSucceeds(getDoc(doc(db(MEMBER), 'communityStats', GID)));
  await assertFails(getDoc(doc(db(OUTSIDER), 'communityStats', GID)));
  await assertFails(getDoc(doc(anon(), 'communityStats', GID)));
});

// A group that no longer exists must deny, not blow up the evaluation.
test('communityStats: a doc whose group was deleted denies cleanly', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'communityStats', 'ghostClub'),
      { groupId: 'ghostClub', goals: 3 });
  });
  await assertFails(getDoc(doc(db(MEMBER), 'communityStats', 'ghostClub')));
});
