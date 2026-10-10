// The season's 24-hour correction window blocks the START of an evening.
//
// Spec §4 and §5. A season that has met its finish line does not close on the
// final whistle: it opens a window in which admins fix what the evening got
// wrong, and during which no evening may be started anywhere in the club.
// Titles are decided from the numbers as they stand when the window shuts, so
// a correction made inside it counts and one made after it cannot — and an
// evening started inside it would be adding results to a season that is
// already being totted up.
//
// `markGameStarted` is a direct client write to `games/{id}`, so this has to
// hold in the rules or it does not hold at all.
//
// The two halves that matter and are easy to get wrong:
//   • ONLY the start is blocked. Fixing a score, publishing teams, editing the
//     roster and finishing an evening that was already running must all still
//     work — that is the entire point of the window.
//   • A club with no seasons, or with seasons and no window open, is
//     completely unaffected. That is almost every club in the database.

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc } from 'firebase/firestore';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RULES = fs.readFileSync(path.join(HERE, '..', '..', 'firestore.rules'), 'utf8');

const GID = 'club1';
const GAME = 'game1';
const ADMIN = 'adminUid';
const PLAYER = 'playerUid';

let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'rules-season-window',
    firestore: { rules: RULES, host: '127.0.0.1', port: 8080 },
  });
});

after(async () => {
  await env.cleanup();
});

/** Seed a club and one open game. `pendingClose` undefined = no window. */
async function seed(pendingClose, gameExtra = {}) {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'groups', GID), {
      name: 'club',
      adminIds: [ADMIN],
      playerIds: [ADMIN, PLAYER],
      createdAt: 1,
      seasons: {
        enabled: true,
        currentId: 's2',
        currentNo: 2,
        cadence: { type: 'rounds', targetRounds: 24 },
        ...(pendingClose === undefined ? {} : { pendingClose }),
      },
    });
    await setDoc(doc(db, 'games', GAME), {
      groupId: GID,
      createdBy: ADMIN,
      status: 'open',
      title: 'evening',
      visibility: 'community',
      players: [ADMIN, PLAYER],
      participantIds: [ADMIN, PLAYER],
      waitlist: [],
      pending: [],
      maxPlayers: 12,
      startsAt: 2,
      createdAt: 1,
      ...gameExtra,
    });
  });
}

const OPEN_WINDOW = { seasonId: 's2', dueAt: 1, closeAt: 99999999999999, reason: 'rounds' };

/** Try the write `patch` as `uid`. Resolves true if the rules allowed it. */
async function write(uid, patch) {
  const db = env.authenticatedContext(uid).firestore();
  try {
    await updateDoc(doc(db, 'games', GAME), patch);
    return true;
  } catch {
    return false;
  }
}

/** The exact shape `gameService.markGameStarted` writes on a first start. */
const START = {
  status: 'active',
  liveMatch: { phase: 'roundRunning', startedAt: 1234, assignments: {}, benchOrder: [], scoreA: 0, scoreB: 0 },
};

describe('with a correction window open', () => {
  test('the admin cannot start an evening', async () => {
    await seed(OPEN_WINDOW);
    assert.equal(await write(ADMIN, START), false);
  });

  test('nor can the game creator by another route', async () => {
    await seed(OPEN_WINDOW);
    assert.equal(
      await write(ADMIN, { 'liveMatch.startedAt': 1234, status: 'active' }),
      false,
    );
  });

  // Everything the window EXISTS to allow.
  test('but the admin can still correct a score', async () => {
    await seed(OPEN_WINDOW, {
      status: 'finished',
      liveMatch: { phase: 'done', startedAt: 500, scoreA: 1, scoreB: 0 },
    });
    // A finished game is closed to this branch by its own terminal-state
    // guard, so correct one that is still active — the case the window is for.
    await seed(OPEN_WINDOW, {
      status: 'active',
      liveMatch: { phase: 'roundRunning', startedAt: 500, scoreA: 1, scoreB: 0 },
    });
    assert.equal(await write(ADMIN, { 'liveMatch.scoreA': 2 }), true);
  });

  test('and edit a future evening without starting it', async () => {
    await seed(OPEN_WINDOW);
    assert.equal(await write(ADMIN, { title: 'moved to Thursday', startsAt: 999 }), true);
  });

  test('and finish an evening that was already running', async () => {
    await seed(OPEN_WINDOW, {
      status: 'active',
      liveMatch: { phase: 'roundRunning', startedAt: 500 },
    });
    // startedAt is already present, so this is not a start.
    assert.equal(await write(ADMIN, { 'liveMatch.phase': 'done' }), true);
  });
});

describe('with no window open', () => {
  test('the admin starts the evening exactly as before', async () => {
    await seed(undefined);
    assert.equal(await write(ADMIN, START), true);
  });

  test('a club with no seasons block at all is untouched', async () => {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'groups', GID), {
        name: 'club', adminIds: [ADMIN], playerIds: [ADMIN], createdAt: 1,
      });
      await setDoc(doc(db, 'games', GAME), {
        groupId: GID, createdBy: ADMIN, status: 'open', title: 'e',
        visibility: 'community', players: [ADMIN], participantIds: [ADMIN],
        waitlist: [], pending: [], maxPlayers: 12, startsAt: 2, createdAt: 1,
      });
    });
    assert.equal(await write(ADMIN, START), true);
  });
});

// The stamp is scoped to the season it belongs to on the SERVER side
// (`currentPendingClose` refuses a mismatch). The rule is deliberately
// simpler — any pendingClose blocks — because the server deletes the field in
// the same write that advances the lifecycle, so a stamp naming a dead season
// should not exist. This pins what the rule actually does, so that if the
// server ever leaves litter behind, the consequence is documented rather than
// discovered.
// ⚠️ The null trap, which has bitten this file's rules before.
//
// `.get(k, default)` in Firestore rules substitutes the default only for an
// ABSENT key. A key that is PRESENT and null comes back as null, and calling
// `.get()` on null RAISES — and a raised error denies the whole request, not
// just the branch it happened in. The rules elsewhere test
// `resource.data.liveMatch == null` explicitly, so a null liveMatch is a shape
// this database really holds.
//
// If `isStartingTheEvening()` had that bug, every admin edit to such a game
// would be denied — not only starts, and not only during a window. These are
// the cases that would catch it.
describe('a game whose liveMatch is present and NULL', () => {
  test('can still be edited by the admin, window or not', async () => {
    await seed(OPEN_WINDOW, { liveMatch: null });
    assert.equal(await write(ADMIN, { title: 'renamed' }), true);
  });

  test('and with no window either', async () => {
    await seed(undefined, { liveMatch: null });
    assert.equal(await write(ADMIN, { title: 'renamed' }), true);
  });

  test('and starting it is still blocked inside a window', async () => {
    await seed(OPEN_WINDOW, { liveMatch: null });
    assert.equal(await write(ADMIN, START), false);
  });

  test('and still allowed outside one', async () => {
    await seed(undefined, { liveMatch: null });
    assert.equal(await write(ADMIN, START), true);
  });
});

// The end state of "disable while a window is open", which is the shape that
// bricked the club before `disableClubSeasons` learned to clear the stamp.
//
// After the fix the server writes `enabled:false` AND deletes `pendingClose`
// in the same call, so the club must be able to play again immediately. These
// cases pin the two halves of that end state as the rules see them.
describe('after seasons are switched off mid-window', () => {
  test('a club left with enabled:false and NO stamp can start', async () => {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'groups', GID), {
        name: 'club', adminIds: [ADMIN], playerIds: [ADMIN], createdAt: 1,
        seasons: { enabled: false, currentId: 's3', currentNo: 3, count: 2 },
      });
      await setDoc(doc(db, 'games', GAME), {
        groupId: GID, createdBy: ADMIN, status: 'open', title: 'e',
        visibility: 'community', players: [ADMIN], participantIds: [ADMIN],
        waitlist: [], pending: [], maxPlayers: 12, startsAt: 2, createdAt: 1,
      });
    });
    assert.equal(await write(ADMIN, START), true);
  });

  test('and one left with the stamp still on it cannot — the bug, pinned', async () => {
    // Kept as a test rather than deleted with the bug: the rules block on the
    // stamp regardless of `enabled`, and that is deliberate. It is why every
    // path that turns seasons off, advances a season or reopens one has to
    // delete the field, and why the sweep cleans a stale one. If a future
    // change leaves a stamp behind, this is what the club experiences.
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'groups', GID), {
        name: 'club', adminIds: [ADMIN], playerIds: [ADMIN], createdAt: 1,
        seasons: { enabled: false, currentId: 's3', currentNo: 3, count: 2,
                   pendingClose: OPEN_WINDOW },
      });
      await setDoc(doc(db, 'games', GAME), {
        groupId: GID, createdBy: ADMIN, status: 'open', title: 'e',
        visibility: 'community', players: [ADMIN], participantIds: [ADMIN],
        waitlist: [], pending: [], maxPlayers: 12, startsAt: 2, createdAt: 1,
      });
    });
    assert.equal(await write(ADMIN, START), false);
  });
});

describe('the rule is the presence of the field, not its contents', () => {
  test('a stamp naming an older season still blocks', async () => {
    await seed({ ...OPEN_WINDOW, seasonId: 's1' });
    assert.equal(await write(ADMIN, START), false);
  });

  test('a window whose deadline has passed still blocks in the rules', async () => {
    // Deliberate: the rules do not read clocks. The sweep is what notices the
    // deadline, closes the season and deletes the field; until it runs, the
    // club stays blocked. At most one hour.
    await seed({ ...OPEN_WINDOW, closeAt: 1 });
    assert.equal(await write(ADMIN, START), false);
  });
});

// ── The expression budget, which is the real deploy risk here ───────────
//
// Firestore stops evaluating a rule after 1000 expressions and DENIES. The
// games `allow update` is one long OR chain, and it is already close enough to
// that ceiling that the suite's own `games: self can join an open community
// game` case fails on it against the 82-field fixture — a pre-existing failure
// the rules file documents at the top of the chain ("that is what actually
// failed in production").
//
// The correction-window guard is added to the ORGANISER/ADMIN branch, which is
// the LAST branch in the chain: an admin write pays for every branch before it
// and then for this one. So the admin path on a real, fat game document is
// exactly where a few extra expressions could tip something over, and it is
// the case worth pinning rather than reasoning about.

// readFileSync keeps this fixture compatible with both Node 20 and Node 24.
// Import assertions were removed in Node 22; the fixture and expectations stay identical.
const bigGame = JSON.parse(fs.readFileSync(path.join(HERE, 'bigGame.fixture.json'), 'utf8'));

describe('the 82-field game, and the cap the admin branch already sits behind', () => {
  async function seedBig(pendingClose) {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'groups', GID), {
        ...bigGame.group,
        name: 'club',
        adminIds: [ADMIN],
        playerIds: [ADMIN, PLAYER],
        createdAt: 1,
        seasons: {
          enabled: true,
          currentId: 's2',
          currentNo: 2,
          cadence: { type: 'rounds', targetRounds: 24 },
          ...(pendingClose === undefined ? {} : { pendingClose }),
        },
      });
      await setDoc(doc(db, 'games', GAME), { ...bigGame.game, groupId: GID, createdBy: ADMIN });
    });
  }

  // ⚠️ PRE-EXISTING, and measured both ways before being written down here.
  //
  // An admin renaming this game is DENIED — with the correction-window guard
  // and, when the same case is run against the rules as they stood before it,
  // without it. The cause is the 1000-expression cap: the organiser/admin
  // branch is the last in a long OR chain and the budget is gone before the
  // request reaches it.
  //
  // This is not a fixture built to break things. It is 82 fields, 14 players,
  // 27 invited users — an ordinary Teamder game — and the rules file's own
  // note at the top of the chain says this cap "is what actually failed in
  // production".
  //
  // Pinned as it behaves rather than as it should behave, so the suite stays
  // honest about what changed today (nothing) while keeping the finding where
  // someone will meet it. If the chain is ever trimmed back under the cap,
  // these two flip to allowed and whoever sees them fail should read this and
  // invert them.
  test('⚠️ pre-existing: an admin edit is denied by the expression cap', async () => {
    await seedBig(OPEN_WINDOW);
    assert.equal(await write(ADMIN, { title: 'renamed' }), false);
  });

  test('⚠️ pre-existing: and denied with no season window in play at all', async () => {
    await seedBig(undefined);
    assert.equal(await write(ADMIN, { title: 'renamed' }), false);
  });

  // The half that matters for THIS feature, and it is the safe half: running
  // out of budget denies. So on a game this size the window's guard may never
  // be reached — and the outcome is the one the guard wanted anyway.
  test('the start is refused inside the window', async () => {
    await seedBig(OPEN_WINDOW);
    assert.equal(await write(ADMIN, START), false);
  });

  test('⚠️ pre-existing: and refused outside it too, for the same reason', async () => {
    await seedBig(undefined);
    assert.equal(await write(ADMIN, START), false);
  });
});
