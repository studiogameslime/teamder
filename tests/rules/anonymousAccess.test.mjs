// What a Firebase ANONYMOUS session can reach.
//
// Written as the baseline for the guest-browsing work: before `RootNavigator`
// creates an anonymous session for every fresh install, we need this file to
// say — in assertions, not in prose — exactly what such a session can read.
// Today an anonymous user is indistinguishable from a real one to every rule
// in the file: `isSignedIn()` is `request.auth != null` and nothing anywhere
// looks at the provider.
//
// TOKEN SHAPE — measured against the emulator, not assumed:
//
//   authenticatedContext(uid)                           → sign_in_provider 'custom'
//   authenticatedContext(uid, {firebase:{...:'anonymous'}}) → 'anonymous'
//   authenticatedContext(uid, {firebase:{...:'google.com'}}) → 'google.com'
//   custom claims with no `firebase` block              → still 'custom'
//
// The `firebase` block is ALWAYS present, so `token.firebase.sign_in_provider`
// never errors. That also means every one of the other 249 rules tests — all of
// which use the plain `authenticatedContext(uid)` — reads as a FULL account and
// keeps passing unchanged.
//
// LIST IS NOT GET. Several cases below issue the real query the app issues,
// because a rule can pass `getDoc` and still deny the collection query: a list
// is refused up front when Firestore cannot prove the rule holds for every
// matching document. That distinction cost a 1h48m production outage on
// 22.09 — see tests/rules/gameListRegression.test.mjs.
//
// Run: npm run test:rules   (serially — the suite shares one emulator)

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  doc, getDoc, setDoc, collection, documentId,
  query, where, getDocs, limit,
} from 'firebase/firestore';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RULES = process.env.RULES_FILE || join(__dirname, '../../firestore.rules');

const ALICE = 'uAlice';      // a real member of club g1
const BOB = 'uBob';          // a real account, NOT a member of g1
const ANON = 'uAnon';        // the anonymous browser
const CLUB = 'g1';

let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-soccer',
    firestore: { rules: readFileSync(RULES, 'utf8'), host: '127.0.0.1', port: 8080 },
  });
});
after(async () => { await env?.cleanup(); });

// ─── contexts ─────────────────────────────────────────────────────────────

/** A Firebase Anonymous session — what "continue as guest" produces today,
 *  and what every fresh install will get once the silent guest ships. */
const anon = () =>
  env.authenticatedContext(ANON, {
    firebase: { sign_in_provider: 'anonymous' },
  }).firestore();

/** A real account. Google here; `password` and `apple.com` behave identically
 *  for every rule in this file (asserted in the provider block below). */
const full = (uid = BOB) =>
  env.authenticatedContext(uid, {
    firebase: { sign_in_provider: 'google.com' },
  }).firestore();

const nobody = () => env.unauthenticatedContext().firestore();

// ─── seed ─────────────────────────────────────────────────────────────────

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();

    // Two real people. Alice's doc carries the fields that must never reach a
    // public surface, so an over-broad read is visible in the assertion.
    await setDoc(doc(db, 'users', ALICE), {
      id: ALICE,
      name: 'אליס',
      avatarId: 'a1',
      email: 'alice@example.com',
      fcmTokens: ['tok-alice-device-1'],
      invitedBy: 'someone',
      phone: '0500000000',
      qa: true,
    });
    await setDoc(doc(db, 'users', BOB), { id: BOB, name: 'בוב', avatarId: 'a2' });

    // The public mirror this round introduces. Seeded unconditionally: the
    // baseline run asserts it is unreadable because no rule matches it yet.
    await setDoc(doc(db, 'usersPublic', ALICE), {
      id: ALICE, name: 'אליס', avatarId: 'a1',
    });
    await setDoc(doc(db, 'usersPublic', BOB), {
      id: BOB, name: 'בוב', avatarId: 'a2',
    });

    // One club, with Alice in it and Bob outside it.
    await setDoc(doc(db, 'groups', CLUB), {
      id: CLUB, name: 'שכונה', playerIds: [ALICE], adminIds: [ALICE], isOpen: true,
    });
    await setDoc(doc(db, 'groupsPublic', CLUB), {
      id: CLUB, name: 'שכונה', city: 'חולון', memberCount: 1, isOpen: true,
    });
    await setDoc(doc(db, 'communityShowcase', CLUB), {
      groupId: CLUB, name: 'שכונה', totalMembers: 1,
    });

    // A public game and a community-only one, so the visibility split is
    // exercised rather than assumed.
    await setDoc(doc(db, 'games', 'gamePub'), {
      id: 'gamePub', groupId: CLUB, visibility: 'public', status: 'open',
      createdBy: ALICE, participantIds: [ALICE], players: [ALICE],
      startsAt: new Date('2026-10-01T17:00:00Z'),
    });
    await setDoc(doc(db, 'games', 'gameCom'), {
      id: 'gameCom', groupId: CLUB, visibility: 'community', status: 'open',
      createdBy: ALICE, participantIds: [ALICE], players: [ALICE],
      startsAt: new Date('2026-10-02T17:00:00Z'),
    });

    // Stat rollups and marketing content.
    await setDoc(doc(db, 'rounds', 'r1'), { id: 'r1', gameId: 'gamePub', groupId: CLUB });
    await setDoc(doc(db, 'playerStats', ALICE), { userId: ALICE, goals: 12 });
    await setDoc(doc(db, 'ratings', ALICE), { ratedUserId: ALICE, avg: 7.4, count: 9 });
    await setDoc(doc(db, 'pairStats', `${ALICE}__${BOB}`), { a: ALICE, b: BOB, together: 4 });
    await setDoc(doc(db, 'users', ALICE, 'seasonTitles', 't1'), { title: 'מלך העונה' });
    await setDoc(doc(db, 'campaigns', 'c1'), {
      id: 'c1', kind: 'popup', active: true, title: 'ברוכים הבאים',
    });
    await setDoc(doc(db, 'appConfig', 'android'), { latestVersion: '1.1.14' });

    // Private per-user data — must stay private from everybody but the owner.
    await setDoc(doc(db, 'notifications', 'n1'), { userId: ALICE, body: 'x' });
    await setDoc(doc(db, 'friendRequests', 'fr1'), { fromUserId: ALICE, toUserId: BOB });
  });
});

// ─── helpers ──────────────────────────────────────────────────────────────

async function allowed(promise) {
  try { await promise; return true; } catch { return false; }
}

/** Assert and, on failure, say which direction moved — a rules change that
 *  loosens is as much a regression as one that breaks a feature. */
async function expectAccess(label, promise, want) {
  const got = await allowed(promise);
  assert.strictEqual(
    got, want,
    `${label}: expected ${want ? 'ALLOW' : 'DENY'}, got ${got ? 'ALLOW' : 'DENY'}`,
  );
}

const get = (db, ...path) => getDoc(doc(db, ...path));
const listAll = (db, col) => getDocs(query(collection(db, col), limit(10)));

// ─── the token itself ─────────────────────────────────────────────────────

test('provider claim: every real provider reads as a full account', async () => {
  // Guards the helper the rules will use. If Firebase ever stopped sending the
  // `firebase` block, `token.firebase.sign_in_provider` would ERROR rather than
  // compare false — and an erroring term inside an && denies. This proves the
  // block is there for each provider we actually ship.
  for (const p of ['google.com', 'apple.com', 'password']) {
    const db = env.authenticatedContext(`u_${p}`, {
      firebase: { sign_in_provider: p },
    }).firestore();
    await expectAccess(`${p} reads appConfig`, get(db, 'appConfig', 'android'), true);
  }
});

// ─── unauthenticated ──────────────────────────────────────────────────────

test('signed out: only the two deliberately-public collections', async () => {
  const db = nobody();
  // These two are `allow read: if true` — they back the public web pages.
  await expectAccess('appConfig', get(db, 'appConfig', 'android'), true);
  await expectAccess('communityShowcase', get(db, 'communityShowcase', CLUB), true);

  await expectAccess('users', get(db, 'users', ALICE), false);
  await expectAccess('groupsPublic', get(db, 'groupsPublic', CLUB), false);
  await expectAccess('public game', get(db, 'games', 'gamePub'), false);
});

// ─── what a guest MUST keep ───────────────────────────────────────────────
//
// These are the reads the browse experience is built on. They must be ALLOW
// before and after; a change that breaks one of them breaks the product.

test('guest CAN browse public clubs', async () => {
  const db = anon();
  await expectAccess('groupsPublic get', get(db, 'groupsPublic', CLUB), true);
  await expectAccess('groupsPublic list', listAll(db, 'groupsPublic'), true);
  await expectAccess('communityShowcase get', get(db, 'communityShowcase', CLUB), true);
});

test('guest CAN browse public games', async () => {
  const db = anon();
  await expectAccess('public game get', get(db, 'games', 'gamePub'), true);
  // The real feed query, not a getDoc.
  await expectAccess(
    'public games query',
    getDocs(query(collection(db, 'games'), where('visibility', '==', 'public'), limit(10))),
    true,
  );
});

test('guest CAN read app config and marketing campaigns', async () => {
  const db = anon();
  await expectAccess('appConfig', get(db, 'appConfig', 'android'), true);
  await expectAccess('campaigns list', listAll(db, 'campaigns'), true);
});

// ─── what a guest must NOT have ───────────────────────────────────────────

test('guest CANNOT read another person’s private user document', async () => {
  // THE headline of this round. Alice's doc carries email, fcmTokens, phone
  // and attribution; before the change an anonymous session reads all of it.
  await expectAccess('users/{other} get', get(anon(), 'users', ALICE), false);
});

test('guest CANNOT enumerate the user base', async () => {
  await expectAccess('users list', listAll(anon(), 'users'), false);
});

test('guest CANNOT read cross-club stat rollups', async () => {
  const db = anon();
  await expectAccess('playerStats', get(db, 'playerStats', ALICE), false);
  await expectAccess('ratings', get(db, 'ratings', ALICE), false);
  await expectAccess('pairStats', get(db, 'pairStats', `${ALICE}__${BOB}`), false);
  await expectAccess('rounds', get(db, 'rounds', 'r1'), false);
  await expectAccess('seasonTitles', get(db, 'users', ALICE, 'seasonTitles', 't1'), false);
});

test('guest CANNOT read community-only games', async () => {
  await expectAccess('community game', get(anon(), 'games', 'gameCom'), false);
});

test('guest CANNOT read private per-user collections', async () => {
  const db = anon();
  await expectAccess('notifications', get(db, 'notifications', 'n1'), false);
  await expectAccess('friendRequests', get(db, 'friendRequests', 'fr1'), false);
});

test('guest CANNOT write anything', async () => {
  const db = anon();
  await expectAccess(
    'create own user doc',
    setDoc(doc(db, 'users', ANON), { id: ANON, name: 'x', createdAt: 1 }),
    false,
  );
  await expectAccess(
    'join a public game',
    setDoc(doc(db, 'games', 'gamePub'), { players: [ANON] }, { merge: true }),
    false,
  );
  await expectAccess(
    'write a public mirror',
    setDoc(doc(db, 'usersPublic', ANON), { id: ANON, name: 'x' }),
    false,
  );
});

// ─── usersPublic ──────────────────────────────────────────────────────────

test('usersPublic is world-readable and client-unwritable', async () => {
  // Readable by everyone, including signed-out: it backs the public web pages
  // as well as the in-app guest surfaces, and it holds only what those pages
  // already render.
  await expectAccess('guest get', get(anon(), 'usersPublic', ALICE), true);
  await expectAccess('full account get', get(full(), 'usersPublic', ALICE), true);
  await expectAccess('signed out get', get(nobody(), 'usersPublic', ALICE), true);

  // A guest resolves BY id and cannot enumerate. A full account may list —
  // the batched roster query depends on it, and that account can already
  // enumerate /users, so four public fields is strictly less than it has.
  await expectAccess('guest list', listAll(anon(), 'usersPublic'), false);
  await expectAccess('full account list', listAll(full(), 'usersPublic'), true);

  // Server-written only. A client that could write here could impersonate.
  await expectAccess(
    'owner cannot write their own mirror',
    setDoc(doc(full(ALICE), 'usersPublic', ALICE), { id: ALICE, name: 'הכי טוב' }),
    false,
  );
});

// ─── the roster query the migration introduces ────────────────────────────

test('the public roster renders for both kinds of viewer', async () => {
  // A guest resolves each participant by id — groupService.hydratePublicUsers
  // takes this branch when auth.currentUser.isAnonymous.
  const g = anon();
  await expectAccess('guest resolves a participant', get(g, 'usersPublic', ALICE), true);
  await expectAccess('guest resolves another', get(g, 'usersPublic', BOB), true);

  // A full account issues the batched query — the one that keeps a big roster
  // at a handful of queries instead of one read per member.
  await expectAccess(
    'batched documentId() in query',
    getDocs(query(
      collection(full(), 'usersPublic'),
      where(documentId(), 'in', [ALICE, BOB]),
    )),
    true,
  );
});

// ─── the player card, as a guest ──────────────────────────────────────────

test('the guest player card reads the mirror and nothing else', async () => {
  // This is the data contract of PlayerCardScreen's guest branch, written as
  // assertions so the screen cannot quietly start reaching for a document it
  // is not allowed to have.
  //
  // The point is not only that the four private reads are DENIED — it is that
  // the screen must never issue them. A denial costs a round trip and files a
  // permission error; the branch returns before any of them mount.
  const db = anon();

  // What it renders: name + avatar, by id, from the mirror.
  await expectAccess('identity from the mirror', get(db, 'usersPublic', ALICE), true);

  // What it must not touch.
  await expectAccess('the user document', get(db, 'users', ALICE), false);
  await expectAccess('lifetime stats', get(db, 'playerStats', ALICE), false);
  await expectAccess('rating aggregate', get(db, 'ratings', ALICE), false);
  await expectAccess('pair chemistry', get(db, 'pairStats', `${ALICE}__${BOB}`), false);

  // The referral count on the self view is a LIST over /users — also out.
  await expectAccess(
    'referral count query',
    getDocs(query(collection(db, 'users'), where('invitedBy', '==', ALICE), limit(10))),
    false,
  );
});

test('the same card, for a full account, reads everything it always did', async () => {
  const db = full();
  await expectAccess('the user document', get(db, 'users', ALICE), true);
  await expectAccess('lifetime stats', get(db, 'playerStats', ALICE), true);
  await expectAccess('rating aggregate', get(db, 'ratings', ALICE), true);
  await expectAccess('pair chemistry', get(db, 'pairStats', `${ALICE}__${BOB}`), true);
  await expectAccess(
    'referral count query',
    getDocs(query(collection(db, 'users'), where('invitedBy', '==', ALICE), limit(10))),
    true,
  );
});

// ─── a full account keeps what it had ─────────────────────────────────────
//
// The round must not cost a real user anything. Each of these passes today and
// must still pass afterwards.

test('full account keeps every read it has today', async () => {
  const db = full();
  await expectAccess('users/{other}', get(db, 'users', ALICE), true);
  await expectAccess('playerStats', get(db, 'playerStats', ALICE), true);
  await expectAccess('ratings', get(db, 'ratings', ALICE), true);
  await expectAccess('pairStats', get(db, 'pairStats', `${ALICE}__${BOB}`), true);
  await expectAccess('rounds', get(db, 'rounds', 'r1'), true);
  await expectAccess('seasonTitles', get(db, 'users', ALICE, 'seasonTitles', 't1'), true);
  await expectAccess('groupsPublic', get(db, 'groupsPublic', CLUB), true);
  await expectAccess('public game', get(db, 'games', 'gamePub'), true);
  await expectAccess('campaigns', listAll(db, 'campaigns'), true);
});

test('full account keeps the real list queries', async () => {
  const db = full();
  await expectAccess('groupsPublic list', listAll(db, 'groupsPublic'), true);
  await expectAccess(
    'public games query',
    getDocs(query(collection(db, 'games'), where('visibility', '==', 'public'), limit(10))),
    true,
  );
  // The query that the 22.09 outage broke. Cheap to keep watching.
  await expectAccess(
    'my games query',
    getDocs(query(
      collection(db, 'games'),
      where('participantIds', 'array-contains', BOB),
      limit(10),
    )),
    true,
  );
});

test('a member still reads their own club’s community game', async () => {
  await expectAccess('member reads community game', get(full(ALICE), 'games', 'gameCom'), true);
});

test('owner still reads and writes their own user document', async () => {
  const db = full(ALICE);
  await expectAccess('own doc get', get(db, 'users', ALICE), true);
  await expectAccess(
    'own profile edit',
    setDoc(doc(db, 'users', ALICE), { name: 'אליס כהן' }, { merge: true }),
    true,
  );
});
