// What an ALREADY-INSTALLED binary can still READ once /users stops being
// world-readable to anyone holding a session.
//
// `oldClientCompat.test.mjs` next door asks the same deployment-safety
// question about WRITES. Nothing asked it about reads, and reads are where the
// anonymous-session hardening actually lands — so this file is the missing
// half, written for the emergency hotfix that closes the /users exposure.
//
// The exposure, stated plainly: `allow read: if isSignedIn()` grants `get` AND
// `list`. It is not "whoever knows a uid may fetch one document" — it is a
// downloadable index of every user, queryable by email and by inviter, to
// anybody who installs the app and gets a silent anonymous session. Those two
// halves are asserted separately below, because a rule can pass `getDoc` and
// still deny the collection query, and the reverse mistake is what makes an
// audit read as "just one document".
//
// GUEST BROWSING IS NOT NEW. `signInAsGuest` shipped 17.06.2026 (Apple review
// 5.1.1(v)), so binaries in the field have been minting anonymous sessions for
// months. The degradation those binaries take is therefore real, and this file
// PINS it rather than pretending it away: an old anonymous binary loses
// other-user reads, an old FULL-account binary loses nothing at all. Do not
// "fix" the first by widening /users — that is the hole.
//
// Run: npm run test:rules   (serially — the suite shares one emulator)
// Against a candidate artifact: RULES_FILE=/path/to/candidate.rules

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  doc, getDoc, setDoc, updateDoc, collection, documentId,
  query, where, getDocs, limit,
} from 'firebase/firestore';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RULES = process.env.RULES_FILE || join(__dirname, '../../firestore.rules');

const ALICE = 'uAlice';   // a real account somebody else is looking at
const ANON = 'uAnon';     // the anonymous browser
const CLUB = 'g1';

let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-soccer',
    firestore: { rules: readFileSync(RULES, 'utf8'), host: '127.0.0.1', port: 8080 },
  });
});
after(async () => { await env?.cleanup(); });

const anon = () =>
  env.authenticatedContext(ANON, { firebase: { sign_in_provider: 'anonymous' } }).firestore();
const full = (uid = 'uBob') =>
  env.authenticatedContext(uid, { firebase: { sign_in_provider: 'google.com' } }).firestore();
const nobody = () => env.unauthenticatedContext().firestore();

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    // Alice carries the fields the exposure is actually about, so a read that
    // is too broad shows up as a value somebody could have taken.
    await setDoc(doc(db, 'users', ALICE), {
      id: ALICE,
      name: 'אליס',
      email: 'alice@example.com',
      fcmTokens: ['tok-device-1'],
      invitedBy: 'someone',
      availability: { homeCityLat: 32.07, homeCityLng: 34.84 },
      createdAt: new Date('2026-01-01T00:00:00Z'),
    });
    await setDoc(doc(db, 'users', 'uBob'), { id: 'uBob', name: 'בוב', invitedBy: null });
    // The anonymous browser's OWN document. A guest does not create one today
    // (userService.signInAsGuest builds a runtime-only User), but self-access
    // has to keep working for the moment one exists — and for the upgraded
    // account that inherits the uid.
    await setDoc(doc(db, 'users', ANON), { id: ANON, name: '', isGuest: true, invitedBy: null });

    await setDoc(doc(db, 'usersPublic', ALICE), { id: ALICE, name: 'אליס', avatarId: 'a1' });
    await setDoc(doc(db, 'usersPublic', 'uBob'), { id: 'uBob', name: 'בוב' });

    await setDoc(doc(db, 'groupsPublic', CLUB), {
      id: CLUB, name: 'שכונה', memberCount: 1, isOpen: true,
    });
    await setDoc(doc(db, 'games', 'gamePub'), {
      id: 'gamePub', groupId: CLUB, visibility: 'public', status: 'open',
      createdBy: ALICE, participantIds: [ALICE], players: [ALICE],
      startsAt: new Date('2026-10-01T17:00:00Z'),
    });
  });
});

async function allowed(promise) {
  try { await promise; return true; } catch { return false; }
}

/** Say which direction moved. A rules change that LOOSENS is as much a
 *  regression as one that breaks a feature, and this file exists to catch
 *  the loosening. */
async function expectAccess(label, promise, want) {
  const got = await allowed(promise);
  assert.strictEqual(
    got, want,
    `${label}: expected ${want ? 'ALLOW' : 'DENY'}, got ${got ? 'ALLOW' : 'DENY'}`,
  );
}

// ─── the exposure this hotfix closes ──────────────────────────────────────

test('an anonymous session cannot reach another person’s user document', async () => {
  const db = anon();
  await expectAccess('get another user by uid', getDoc(doc(db, 'users', ALICE)), false);
});

test('an anonymous session cannot ENUMERATE the user base', async () => {
  // Separate from the get above on purpose. `allow read` grants both, and an
  // audit that only checks `getDoc` reports the exposure as an order of
  // magnitude smaller than it is.
  const db = anon();
  await expectAccess(
    'bare collection list',
    getDocs(query(collection(db, 'users'), limit(10))),
    false,
  );
  await expectAccess(
    'query by email',
    getDocs(query(collection(db, 'users'), where('email', '==', 'alice@example.com'), limit(10))),
    false,
  );
  await expectAccess(
    'query by inviter',
    getDocs(query(collection(db, 'users'), where('invitedBy', '==', 'someone'), limit(10))),
    false,
  );
  await expectAccess(
    'batched documentId() in — the roster-hydration shape',
    getDocs(query(collection(db, 'users'), where(documentId(), 'in', [ALICE]))),
    false,
  );
});

// ─── what an anonymous session must KEEP ──────────────────────────────────

test('an anonymous session still owns its own document', async () => {
  // `isSelf(uid)` carries this, not `isFullAccount()`. If the split ever
  // collapses to `allow get: if isFullAccount()`, a guest — and, for the
  // instant after linkWithCredential, a freshly upgraded account on a stale
  // token — loses its own profile.
  const db = anon();
  await expectAccess('get self', getDoc(doc(db, 'users', ANON)), true);
  await expectAccess('update self', updateDoc(doc(db, 'users', ANON), { name: 'אורח' }), true);
});

test('discovery is untouched for an anonymous session', async () => {
  const db = anon();
  await expectAccess(
    'public games feed',
    getDocs(query(collection(db, 'games'), where('visibility', '==', 'public'), limit(10))),
    true,
  );
  await expectAccess(
    'public clubs feed',
    getDocs(query(collection(db, 'groupsPublic'), limit(10))),
    true,
  );
});

// ─── a full account loses nothing ─────────────────────────────────────────

test('a full account keeps every /users read it has today', async () => {
  const db = full();
  await expectAccess('get another user', getDoc(doc(db, 'users', ALICE)), true);
  await expectAccess('list the collection', getDocs(query(collection(db, 'users'), limit(10))), true);
  await expectAccess(
    'batched documentId() in — hydrateUsers',
    getDocs(query(collection(db, 'users'), where(documentId(), 'in', [ALICE, 'uBob']))),
    true,
  );
});

// ─── the public mirror ────────────────────────────────────────────────────

test('usersPublic: get by id is open to everyone, list is not', async () => {
  // GET is world-open because it backs the public web pages — the game and
  // personal-invite landings — and holds four fields those pages already show.
  // LIST is a different thing: a downloadable index of every name in the
  // product. A full account may have it, because it can already enumerate
  // /users and the batched query is what keeps a 200-member roster at ~7
  // queries instead of 200 billed reads.
  for (const [who, db] of [['signed out', nobody()], ['anonymous', anon()], ['full', full()]]) {
    await expectAccess(`${who}: get by id`, getDoc(doc(db, 'usersPublic', ALICE)), true);
  }

  await expectAccess('signed out: list', getDocs(query(collection(nobody(), 'usersPublic'), limit(10))), false);
  await expectAccess('anonymous: list', getDocs(query(collection(anon(), 'usersPublic'), limit(10))), false);
  await expectAccess(
    'anonymous: documentId() in',
    getDocs(query(collection(anon(), 'usersPublic'), where(documentId(), 'in', [ALICE]))),
    false,
  );

  await expectAccess('full: list', getDocs(query(collection(full(), 'usersPublic'), limit(10))), true);
  await expectAccess(
    'full: documentId() in',
    getDocs(query(collection(full(), 'usersPublic'), where(documentId(), 'in', [ALICE, 'uBob']))),
    true,
  );
});

test('usersPublic is server-written only', async () => {
  // Nobody writes here, the owner included. A client that could would be able
  // to publish any name under any uid, and an owner writing their own mirror
  // is exactly how the two documents drift apart.
  for (const [who, db] of [['signed out', nobody()], ['anonymous', anon()], ['full', full(ALICE)]]) {
    await expectAccess(
      `${who}: write own mirror`,
      setDoc(doc(db, 'usersPublic', ALICE), { id: ALICE, name: 'הכי טוב' }),
      false,
    );
  }
});

// ─── the degradation, pinned rather than wished away ──────────────────────

test('OLD BINARY, anonymous session: the two canonical reads it loses', async () => {
  // These are the surfaces mapped in the migration audit. An installed binary
  // from June onward hydrates rosters and player cards from the CANONICAL
  // /users document, because the public mirror did not exist when it shipped.
  //
  // Both go away, and both degrade quietly rather than crashing: gameStore's
  // hydratePlayers wraps the call in try/catch and roster names fall back to
  // the "…" placeholder, and PlayerCardScreen catches and renders
  // `playerCardNotFound`. That is the accepted cost of closing the exposure.
  //
  // This test exists so the cost stays a DECISION. If someone later widens
  // /users to make these pass again, they reopen the hole this file was
  // written to close, and they will have to delete an assertion that says so.
  const db = anon();
  await expectAccess(
    'roster hydration — hydrateUsers documentId() in',
    getDocs(query(collection(db, 'users'), where(documentId(), 'in', [ALICE]))),
    false,
  );
  await expectAccess(
    'player card — getUserById',
    getDoc(doc(db, 'users', ALICE)),
    false,
  );
});

test('OLD BINARY, full account: canonical reads remain allowed', async () => {
  // The population that matters most is untouched, which is what makes the
  // hotfix deployable ahead of the client release.
  const db = full();
  await expectAccess('roster hydration', getDocs(query(collection(db, 'users'), where(documentId(), 'in', [ALICE]))), true);
  await expectAccess('player card', getDoc(doc(db, 'users', ALICE)), true);
});
