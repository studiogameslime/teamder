// The /games read rule: a DELETED game must read as "not found", never as
// "access blocked".
//
// The bug (production error 1e6ngah — game 1KbP87BKVLfShb8kiNvw, deleted
// manually at 15:32, four denials logged between 15:34 and 16:06): `allow
// read` on /games dereferenced `resource.data` directly. On a document that
// does not exist `resource` is null, so EVERY disjunct raises, the whole
// expression is an error, and the error reaches the client as
// `permission-denied`. useGameEvents read that code as "the viewer lost
// access" and pivoted to the permissions wall — so a game that had simply
// been deleted told the user they weren't allowed to see it.
//
// ⚠️ Scope, measured rather than assumed: a MISSING DOCUMENT is the only
// case that actually changed. Firestore's `||` is error-tolerant — a raising
// disjunct beside a true one still yields true — so the rest of the rewrite
// (`.get()` defaults, isGroupMemberSafe, the reordering) is behaviour-neutral
// and every test below except the first passes against the OLD rule too.
// They are kept as audience pins, not as proof of the rewrite: the value here
// is that nobody can quietly widen or narrow who may read a game.
//
// Run with the emulator up:
//   firebase emulators:start --only firestore --project demo-soccer
//   cd tests/rules && node --test gameReadDeleted.test.mjs

import { test, before, after, beforeEach } from 'node:test';
import { initializeTestEnvironment, assertFails, assertSucceeds }
  from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { doc, getDoc, setDoc } from 'firebase/firestore';

const __dirname = dirname(fileURLToPath(import.meta.url));
let env;

const GID = 'clubA';
const OTHER = 'clubB';
const MEMBER = 'uMember';
const ADMIN = 'uAdmin';
const OUTSIDER = 'uOutsider';   // signed in, member of clubB only

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
    // Community-only game of club A.
    await setDoc(doc(d, 'games', 'gCommunity'), {
      groupId: GID, createdBy: ADMIN, visibility: 'community',
      players: [MEMBER], participantIds: [MEMBER], status: 'open',
      title: 'A', maxPlayers: 10, startsAt: 1,
    });
    // Public game of club A.
    await setDoc(doc(d, 'games', 'gPublic'), {
      groupId: GID, createdBy: ADMIN, visibility: 'public',
      players: [], participantIds: [], status: 'open',
      title: 'P', maxPlayers: 10, startsAt: 1,
    });
    // ⚠️ These fixtures are deliberately NOT `visibility: 'public'`. A public
    // game is allowed by the FIRST disjunct, which settles the read before
    // any other term is reached — so a public fixture pins nothing about the
    // rest of the rule. Every fixture below is community-visibility, so the
    // read has to walk the whole expression.
    //
    // Community game whose club doc is GONE. The creator must still reach
    // their own game, and a stranger must still not.
    await setDoc(doc(d, 'games', 'gDeadClub'), {
      groupId: 'clubDeletedLongAgo', createdBy: ADMIN, visibility: 'community',
      players: [], participantIds: [], status: 'open',
      title: 'D', maxPlayers: 10, startsAt: 1,
    });
    // Community game missing participantIds entirely (a legacy doc), with an
    // invitee — the invitee gets in, a stranger does not, whether or not the
    // field is there.
    await setDoc(doc(d, 'games', 'gNoFields'), {
      groupId: GID, createdBy: ADMIN, visibility: 'community',
      invitedUserIds: [OUTSIDER],
      status: 'open', title: 'N', maxPlayers: 10, startsAt: 1,
    });
    // The filler branch, both sides of its boundary — the term whose
    // visibility read moved to .get(), which is the one place the rewrite
    // could have widened the audience. An opted-in community game is visible
    // to a nearby non-member; an opted-in PRIVATE game stays hidden.
    await setDoc(doc(d, 'games', 'gFillerCommunity'), {
      groupId: GID, createdBy: ADMIN, visibility: 'community',
      acceptsFillers: true,
      players: [], participantIds: [], status: 'open',
      title: 'F', maxPlayers: 10, startsAt: 1,
    });
    await setDoc(doc(d, 'games', 'gFillerPrivate'), {
      groupId: GID, createdBy: ADMIN, visibility: 'private',
      acceptsFillers: true,
      players: [], participantIds: [], status: 'open',
      title: 'FP', maxPlayers: 10, startsAt: 1,
    });
    // Community game invited-only viewer.
    await setDoc(doc(d, 'games', 'gInvited'), {
      groupId: GID, createdBy: ADMIN, visibility: 'community',
      players: [], participantIds: [], invitedUserIds: [OUTSIDER],
      status: 'open', title: 'I', maxPlayers: 10, startsAt: 1,
    });
  });
});

// ── the fix: the one case that actually changed ────────────────────
test('DELETED game reads as not-found, not permission-denied', async () => {
  const snap = await assertSucceeds(getDoc(doc(db(MEMBER), 'games', 'gDeletedYesterday')));
  if (snap.exists()) throw new Error('expected a missing document');
});

test('creator still reads their game after the club doc was deleted', async () => {
  await assertSucceeds(getDoc(doc(db(ADMIN), 'games', 'gDeadClub')));
});

test('a dead club does not hand the game to a stranger', async () => {
  await assertFails(getDoc(doc(db(OUTSIDER), 'games', 'gDeadClub')));
});

test('an invitee reads a game whose participantIds field is absent', async () => {
  await assertSucceeds(getDoc(doc(db(OUTSIDER), 'games', 'gNoFields')));
});

test('a stranger still cannot read that same field-less game', async () => {
  await assertFails(getDoc(doc(db('uNobody'), 'games', 'gNoFields')));
});

// ── the filler branch, both sides of the boundary ──────────────────
test('filler candidate reads a community game that opted into fillers', async () => {
  await assertSucceeds(getDoc(doc(db(OUTSIDER), 'games', 'gFillerCommunity')));
});

test('a PRIVATE game stays hidden even with acceptsFillers on', async () => {
  await assertFails(getDoc(doc(db(OUTSIDER), 'games', 'gFillerPrivate')));
});

// ── the audience, pinned (these hold against the old rule too) ─────
test('anonymous still cannot read anything, missing doc included', async () => {
  await assertFails(getDoc(doc(anon(), 'games', 'gPublic')));
  await assertFails(getDoc(doc(anon(), 'games', 'gDeletedYesterday')));
});

test('outsider still cannot read a community-only game', async () => {
  await assertFails(getDoc(doc(db(OUTSIDER), 'games', 'gCommunity')));
});

test('club member reads the community game', async () => {
  await assertSucceeds(getDoc(doc(db(MEMBER), 'games', 'gCommunity')));
});

test('creator reads their own game', async () => {
  await assertSucceeds(getDoc(doc(db(ADMIN), 'games', 'gCommunity')));
});

test('invitee reads the community game they were invited to', async () => {
  await assertSucceeds(getDoc(doc(db(OUTSIDER), 'games', 'gInvited')));
});

test('anyone signed in reads a public game', async () => {
  await assertSucceeds(getDoc(doc(db(OUTSIDER), 'games', 'gPublic')));
});
