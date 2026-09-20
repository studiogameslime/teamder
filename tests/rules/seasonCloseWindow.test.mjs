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
