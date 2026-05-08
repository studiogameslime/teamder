// Firestore Rules emulator tests.
//
// Run with the emulator running in another terminal:
//   firebase emulators:start --only firestore --project demo-soccer
//   cd tests/rules && npm install && npm test
//
// Each test boots a clean firestore environment, seeds the docs the
// scenario needs, then asserts that the action under test is allowed
// or denied as expected.
//
// We deliberately use Node's built-in `node:test` runner rather than
// Jest — the project doesn't have a test runner configured, and a
// no-dependency runner keeps this lean and CI-friendly.

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  doc,
  setDoc,
  updateDoc,
  getDoc,
  serverTimestamp,
} from 'firebase/firestore';

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

after(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

// ── Helpers ────────────────────────────────────────────────────────────

function db(uid) {
  return testEnv.authenticatedContext(uid).firestore();
}
function adminDb() {
  // withSecurityRulesDisabled bypasses rules — for seeding only.
  return testEnv.unauthenticatedContext().firestore();
}
async function seed(write) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await write(ctx.firestore());
  });
}

// Standard fixtures used across tests.
const ALICE = 'alice_uid';
const BOB = 'bob_uid';
const CAROL = 'carol_uid';
const GROUP_ID = 'group_1';
const GAME_ID = 'game_1';

async function seedGroup(overrides = {}) {
  await seed(async (fs) => {
    await setDoc(doc(fs, 'groups', GROUP_ID), {
      name: 'Test Group',
      creatorId: ALICE,
      adminIds: [ALICE],
      playerIds: [ALICE, BOB],
      pendingPlayerIds: [],
      isOpen: false,
      maxMembers: 20,
      ...overrides,
    });
  });
}

async function seedGame(overrides = {}) {
  await seed(async (fs) => {
    await setDoc(doc(fs, 'games', GAME_ID), {
      title: 'Tuesday Game',
      groupId: GROUP_ID,
      createdBy: ALICE,
      status: 'open',
      visibility: 'community',
      startsAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
      players: [ALICE],
      waitlist: [],
      pending: [],
      participantIds: [ALICE],
      maxPlayers: 12,
      ...overrides,
    });
  });
}

async function seedUser(uid, data = {}) {
  await seed(async (fs) => {
    await setDoc(doc(fs, 'users', uid), {
      id: uid,
      name: `User ${uid}`,
      createdAt: Date.now(),
      ...data,
    });
  });
}

// ── /users/{uid} ───────────────────────────────────────────────────────

test('users: cannot write achievements on someone else (closed loophole)', async () => {
  await seedUser(ALICE, { achievements: { gamesJoined: 0 } });
  // Bob attempts to inflate Alice's achievement counter.
  await assertFails(
    updateDoc(doc(db(BOB), 'users', ALICE), {
      achievements: { gamesJoined: 9999 },
      updatedAt: Date.now(),
    }),
  );
});

test('users: cannot write discipline on someone else', async () => {
  await seedUser(ALICE);
  await assertFails(
    updateDoc(doc(db(BOB), 'users', ALICE), {
      discipline: { yellowCards: 99, events: [] },
      updatedAt: Date.now(),
    }),
  );
});

test('users: self can update own profile fields', async () => {
  await seedUser(ALICE);
  await assertSucceeds(
    updateDoc(doc(db(ALICE), 'users', ALICE), {
      name: 'Alice Updated',
      updatedAt: Date.now(),
    }),
  );
});

test('users: cannot write stats from client (server-derived)', async () => {
  await seedUser(ALICE);
  await assertFails(
    updateDoc(doc(db(ALICE), 'users', ALICE), {
      stats: { totalGames: 9999, attendanceRate: 100 },
      updatedAt: Date.now(),
    }),
  );
});

test('users: name longer than 60 chars is rejected', async () => {
  await seedUser(ALICE);
  await assertFails(
    updateDoc(doc(db(ALICE), 'users', ALICE), {
      name: 'x'.repeat(61),
      updatedAt: Date.now(),
    }),
  );
});

// ── /games/{id} — self-join branch ─────────────────────────────────────

test('games: self can join an open community game', async () => {
  await seedGroup();
  await seedGame();
  await assertSucceeds(
    updateDoc(doc(db(BOB), 'games', GAME_ID), {
      players: [ALICE, BOB],
      waitlist: [],
      pending: [],
      participantIds: [ALICE, BOB],
      updatedAt: Date.now(),
    }),
  );
});

test('games: cannot register a different user (no proxy joins)', async () => {
  await seedGroup();
  await seedGame();
  // Bob tries to add Carol to the game.
  await assertFails(
    updateDoc(doc(db(BOB), 'games', GAME_ID), {
      players: [ALICE, CAROL],
      waitlist: [],
      pending: [],
      participantIds: [ALICE, CAROL],
      updatedAt: Date.now(),
    }),
  );
});

test('games: self-join cannot smuggle extra UIDs into waitlist', async () => {
  await seedGroup();
  await seedGame();
  // Bob legitimately joins players, but ALSO tries to stuff Carol +
  // a bogus uid into waitlist (the previous rule only checked players
  // delta, leaving waitlist unchecked).
  await assertFails(
    updateDoc(doc(db(BOB), 'games', GAME_ID), {
      players: [ALICE, BOB],
      waitlist: [CAROL, 'attacker'],
      pending: [],
      participantIds: [ALICE, BOB, CAROL, 'attacker'],
      updatedAt: Date.now(),
    }),
  );
});

test('games: self cannot change status from the join branch', async () => {
  await seedGroup();
  await seedGame();
  await assertFails(
    updateDoc(doc(db(BOB), 'games', GAME_ID), {
      players: [ALICE, BOB],
      participantIds: [ALICE, BOB],
      status: 'cancelled',
      updatedAt: Date.now(),
    }),
  );
});

test('games: cannot join a game whose start time has passed', async () => {
  await seedGroup();
  await seedGame({
    startsAt: Date.now() - 60_000,
  });
  await assertFails(
    updateDoc(doc(db(BOB), 'games', GAME_ID), {
      players: [ALICE, BOB],
      participantIds: [ALICE, BOB],
      updatedAt: Date.now(),
    }),
  );
});

test('games: organizer cannot transfer ownership (createdBy is immutable)', async () => {
  await seedGroup();
  await seedGame();
  await assertFails(
    updateDoc(doc(db(ALICE), 'games', GAME_ID), {
      createdBy: BOB,
      updatedAt: Date.now(),
    }),
  );
});

test('games: organizer cannot move game to a different community', async () => {
  await seedGroup();
  await seedGame();
  await assertFails(
    updateDoc(doc(db(ALICE), 'games', GAME_ID), {
      groupId: 'some_other_group',
      updatedAt: Date.now(),
    }),
  );
});

test('games: non-member cannot read a community-only game', async () => {
  await seedGroup();
  await seedGame({ visibility: 'community' });
  await assertFails(getDoc(doc(db(CAROL), 'games', GAME_ID)));
});

test('games: any signed-in user can read a public game', async () => {
  await seedGroup();
  await seedGame({ visibility: 'public' });
  await assertSucceeds(getDoc(doc(db(CAROL), 'games', GAME_ID)));
});

// ── /groups/{gid} ──────────────────────────────────────────────────────

test('groups: non-creator admin cannot rotate adminIds', async () => {
  // Alice = creator, Bob = co-admin (added by Alice elsewhere).
  await seedGroup({ adminIds: [ALICE, BOB] });
  await assertFails(
    updateDoc(doc(db(BOB), 'groups', GROUP_ID), {
      adminIds: [BOB],
      updatedAt: Date.now(),
    }),
  );
});

test('groups: creator cannot demote themselves out of adminIds', async () => {
  await seedGroup({ adminIds: [ALICE, BOB] });
  await assertFails(
    updateDoc(doc(db(ALICE), 'groups', GROUP_ID), {
      adminIds: [BOB],
      updatedAt: Date.now(),
    }),
  );
});

test('groups: anyone cannot promote themselves to admin', async () => {
  await seedGroup();
  // Carol (outsider) tries to write herself as admin.
  await assertFails(
    updateDoc(doc(db(CAROL), 'groups', GROUP_ID), {
      adminIds: [ALICE, CAROL],
      updatedAt: Date.now(),
    }),
  );
});

test('groups: cannot mutate creatorId after create', async () => {
  await seedGroup();
  await assertFails(
    updateDoc(doc(db(ALICE), 'groups', GROUP_ID), {
      creatorId: BOB,
      updatedAt: Date.now(),
    }),
  );
});

// ── /groupsPublic/{gid} ────────────────────────────────────────────────

test('groupsPublic: cannot create unless canonical /groups exists', async () => {
  // No matching /groups doc — the create must be denied.
  await assertFails(
    setDoc(doc(db(ALICE), 'groupsPublic', 'forged_id'), {
      name: 'Spam Group',
      memberCount: 999,
    }),
  );
});

test('groupsPublic: admin of canonical group can create the public mirror', async () => {
  await seedGroup();
  await assertSucceeds(
    setDoc(doc(db(ALICE), 'groupsPublic', GROUP_ID), {
      name: 'Test Group',
      memberCount: 2,
    }),
  );
});

// ── /notifications/{id} ────────────────────────────────────────────────

test('notifications: cannot fake a server-only push (gameReminder)', async () => {
  // Bob tries to send Alice a fake "game starting now" push.
  await assertFails(
    setDoc(doc(db(BOB), 'notifications', 'fake_1'), {
      type: 'gameReminder',
      recipientId: ALICE,
      payload: { gameId: GAME_ID, gameTitle: 'Fake Game' },
      delivered: false,
    }),
  );
});

test('notifications: cannot fake an "approved" push to inflate a join', async () => {
  await assertFails(
    setDoc(doc(db(BOB), 'notifications', 'fake_2'), {
      type: 'spotOpened',
      recipientId: ALICE,
      payload: { gameId: GAME_ID, gameTitle: 'Fake' },
      delivered: false,
    }),
  );
  // spotOpened IS in the client whitelist — that's intentional (it
  // was the legacy auto-promote channel) but the CF still validates
  // sender identity downstream. The server-only types this guards
  // are gameReminder / gameRsvpNudge / joinRequest / etc.
  // Re-test with a definitely-server-only type:
  await assertFails(
    setDoc(doc(db(BOB), 'notifications', 'fake_3'), {
      type: 'gameRsvpNudge',
      recipientId: ALICE,
      payload: {},
      delivered: false,
    }),
  );
});

test('notifications: client cannot directly create inviteToGame (moved to CF)', async () => {
  // The previous rule allowed clients to write `inviteToGame` notifs
  // directly with arbitrary payload. That let any signed-in user
  // phish "מנהל הקבוצה" by spoofing inviterName. The path now goes
  // through the `sendGameInvite` callable; direct creates are denied.
  await assertFails(
    setDoc(doc(db(BOB), 'notifications', 'invite_attempt'), {
      type: 'inviteToGame',
      recipientId: ALICE,
      payload: {
        gameId: GAME_ID,
        gameTitle: 'Tuesday Game',
        inviterName: 'מנהל הקבוצה', // ← would have been spoofed
        startsAt: Date.now() + 100000,
      },
      delivered: false,
    }),
  );
});

test('notifications: unauthenticated cannot create inviteToGame', async () => {
  await assertFails(
    setDoc(doc(unauthDb(), 'notifications', 'unauth_invite'), {
      type: 'inviteToGame',
      recipientId: ALICE,
      payload: { gameId: GAME_ID },
      delivered: false,
    }),
  );
});

test('notifications: cannot fake inviterName by writing to inbox of another user', async () => {
  // Even if Bob tried via a *different* allowed type with a fake
  // inviterName field, the rule's payload field-size caps clamp it
  // — and the read rule prevents Bob from even confirming delivery.
  // We pick `playerCancelled` (a client-allowed type) and stuff a
  // 5KB string into a non-listed key — should still fail because
  // payload field caps reject it.
  await assertFails(
    setDoc(doc(db(BOB), 'notifications', 'sneak_attempt'), {
      type: 'playerCancelled',
      recipientId: ALICE,
      payload: {
        gameId: GAME_ID,
        gameTitle: 'x'.repeat(2000), // exceeds 200-char cap on gameTitle
      },
      delivered: false,
    }),
  );
});

test('notifications: cannot read another user\'s notifications', async () => {
  await seed(async (fs) => {
    await setDoc(doc(fs, 'notifications', 'private_1'), {
      type: 'inviteToGame',
      recipientId: ALICE,
      delivered: false,
      payload: {},
    });
  });
  await assertFails(getDoc(doc(db(BOB), 'notifications', 'private_1')));
});

// ── /groups/{gid}/ratings/{ratedUid}/votes/{raterUid} ──────────────────

test('ratings: cannot self-rate', async () => {
  await seedGroup();
  await assertFails(
    setDoc(
      doc(db(ALICE), 'groups', GROUP_ID, 'ratings', ALICE, 'votes', ALICE),
      {
        raterUserId: ALICE,
        ratedUserId: ALICE,
        rating: 5,
      },
    ),
  );
});

test('ratings: rating outside 1..5 is rejected', async () => {
  await seedGroup();
  await assertFails(
    setDoc(
      doc(db(ALICE), 'groups', GROUP_ID, 'ratings', BOB, 'votes', ALICE),
      {
        raterUserId: ALICE,
        ratedUserId: BOB,
        rating: 99,
      },
    ),
  );
});

test('ratings: non-member cannot rate inside the group', async () => {
  await seedGroup();
  await assertFails(
    setDoc(
      doc(db(CAROL), 'groups', GROUP_ID, 'ratings', BOB, 'votes', CAROL),
      {
        raterUserId: CAROL,
        ratedUserId: BOB,
        rating: 4,
      },
    ),
  );
});

test('ratings: a member can rate another member', async () => {
  await seedGroup();
  await assertSucceeds(
    setDoc(
      doc(db(ALICE), 'groups', GROUP_ID, 'ratings', BOB, 'votes', ALICE),
      {
        raterUserId: ALICE,
        ratedUserId: BOB,
        rating: 4,
      },
    ),
  );
});

test('ratings: cannot read someone else\'s vote (voter privacy)', async () => {
  await seedGroup();
  await seed(async (fs) => {
    await setDoc(
      doc(fs, 'groups', GROUP_ID, 'ratings', BOB, 'votes', ALICE),
      { raterUserId: ALICE, ratedUserId: BOB, rating: 5 },
    );
  });
  await assertFails(
    getDoc(doc(db(BOB), 'groups', GROUP_ID, 'ratings', BOB, 'votes', ALICE)),
  );
});

// ── /playerStats/{uid} ─────────────────────────────────────────────────

test('playerStats: clients cannot write (server-only)', async () => {
  await assertFails(
    setDoc(doc(db(ALICE), 'playerStats', ALICE), {
      totalGames: 100,
    }),
  );
});

// ── /gameUpdateLatches ─────────────────────────────────────────────────

test('gameUpdateLatches: clients cannot read or write', async () => {
  await assertFails(getDoc(doc(db(ALICE), 'gameUpdateLatches', GAME_ID)));
  await assertFails(
    setDoc(doc(db(ALICE), 'gameUpdateLatches', GAME_ID), {
      lastDispatchedAt: Date.now(),
    }),
  );
});

// ── Unauthenticated context ────────────────────────────────────────────
//
// Anyone with the public Firebase API key (which is bundled into the
// app and therefore extractable from any APK) can hit Firestore from
// curl/Postman without auth. These cases prove the rules deny those
// requests at the perimeter — App Check on top will harden it
// further but the rules layer alone must block unauthenticated.

function unauthDb() {
  return testEnv.unauthenticatedContext().firestore();
}

test('unauth: cannot read /games', async () => {
  await seedGroup();
  await seedGame({ visibility: 'public' });
  await assertFails(getDoc(doc(unauthDb(), 'games', GAME_ID)));
});

test('unauth: cannot read /users', async () => {
  await seedUser(ALICE);
  await assertFails(getDoc(doc(unauthDb(), 'users', ALICE)));
});

test('unauth: cannot create /groups', async () => {
  await assertFails(
    setDoc(doc(unauthDb(), 'groups', 'forged'), {
      name: 'Spam',
      adminIds: ['anon'],
      playerIds: ['anon'],
      pendingPlayerIds: [],
    }),
  );
});

test('unauth: cannot create /notifications', async () => {
  await assertFails(
    setDoc(doc(unauthDb(), 'notifications', 'spam'), {
      type: 'inviteToGame',
      recipientId: ALICE,
      delivered: false,
    }),
  );
});

test('unauth: /appConfig is the only readable surface', async () => {
  await seed(async (fs) => {
    await setDoc(doc(fs, 'appConfig', 'android'), { minVersion: 1 });
  });
  await assertSucceeds(getDoc(doc(unauthDb(), 'appConfig', 'android')));
});
