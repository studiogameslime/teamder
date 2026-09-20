// Who may SEND a client-originated notification.
//
// `clientNotifTypeAllowed` has always said which TYPES a client may write. It
// never said anything about whether this particular client has any standing to
// write them, and a probe against these rules showed what that cost: a
// complete stranger could send any victim `approved`, `rejected`,
// `groupDeleted`, `spotOpened`, `spotOffered`, `newGameInCommunity`,
// `gameCanceledOrUpdated` or `playerCancelled`, naming a club and a game they
// had nothing to do with. "התקבלת למועדון" from nobody.
//
// The suite's own `cannot fake an "approved" push` case has been failing on
// this for a long time — but not for the reason its name suggests. It asserts
// a denial for `spotOpened`, which the whitelist deliberately permits, and the
// comment three lines beneath it says exactly that. The test was
// self-contradictory. The hole underneath it was real.
//
// This file is the other half of the fix, and the more important half: every
// legitimate sender must still get through. A security rule that also blocks
// the organiser cancelling a game has not made anybody safer.

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, deleteDoc } from 'firebase/firestore';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RULES = fs.readFileSync(path.join(HERE, '..', '..', 'firestore.rules'), 'utf8');

const GID = 'club1';
const GAME = 'game1';
const ADMIN = 'adminUid';     // club admin AND the game's creator
const PLAYER = 'playerUid';   // registered in the game
const STRANGER = 'strangerUid';
const VICTIM = 'victimUid';

let env;
let seq = 0;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'rules-notif-sender',
    firestore: { rules: RULES, host: '127.0.0.1', port: 8080 },
  });
});
after(async () => { await env.cleanup(); });

async function seed() {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'groups', GID), {
      name: 'club', adminIds: [ADMIN], playerIds: [ADMIN, PLAYER], createdAt: 1,
    });
    await setDoc(doc(db, 'games', GAME), {
      groupId: GID, createdBy: ADMIN, status: 'open', title: 'evening',
      visibility: 'community', players: [ADMIN, PLAYER],
      participantIds: [ADMIN, PLAYER], waitlist: [], pending: [],
      maxPlayers: 12, startsAt: 2, createdAt: 1,
    });
  });
}

/** Send `type` as `uid` with the given payload. True if the rules allowed it. */
async function send(uid, type, payload) {
  const db = env.authenticatedContext(uid).firestore();
  try {
    await setDoc(doc(db, 'notifications', `n_${seq++}`), {
      type,
      recipientId: VICTIM,
      payload,
      delivered: false,
      read: false,
      createdAtMs: 1,
    });
    return true;
  } catch {
    return false;
  }
}

const OF_GROUP = { groupId: GID, groupName: 'club' };
const OF_GAME = { gameId: GAME, gameTitle: 'evening' };

describe('the legitimate senders still get through', () => {
  test('a club admin approves a join', async () => {
    await seed();
    assert.equal(await send(ADMIN, 'approved', OF_GROUP), true);
  });

  test('a club admin rejects one', async () => {
    await seed();
    assert.equal(await send(ADMIN, 'rejected', OF_GROUP), true);
  });

  test('a club admin announces a new game', async () => {
    await seed();
    assert.equal(await send(ADMIN, 'newGameInCommunity', OF_GROUP), true);
  });

  test('the organiser cancels or changes a game', async () => {
    await seed();
    assert.equal(await send(ADMIN, 'gameCanceledOrUpdated', OF_GAME), true);
  });

  test('the organiser offers a freed spot', async () => {
    await seed();
    assert.equal(await send(ADMIN, 'spotOffered', OF_GAME), true);
    assert.equal(await send(ADMIN, 'spotOpened', OF_GAME), true);
  });

  // The one flow where the sender is deliberately NOT an admin: a player
  // pulling out tells the organiser. Requiring admin rights here would have
  // broken exactly the case the notification exists for.
  // ⚠️ THE REAL PAYLOAD, taken from the shipped build, not one I invented.
  //
  // Both places the app sends `playerCancelled` from are the consolidated
  // account-deletion push: `{ cancellingUserId, gameTitles, reason }`, with NO
  // gameId — it covers several games at once and the sender is leaving all of
  // them. The first version of this test passed a made-up `{ gameId }` and
  // went green while the rule it was guarding would have broken every real
  // send, on HEAD and on the build in the stores.
  test('a player announces their own departure — the real payload', async () => {
    await seed();
    assert.equal(
      await send(PLAYER, 'playerCancelled', {
        cancellingUserId: PLAYER,
        gameTitles: ['evening'],
        reason: 'accountDeleted',
      }),
      true,
    );
  });

  test('and may not announce somebody else\'s', async () => {
    await seed();
    assert.equal(
      await send(STRANGER, 'playerCancelled', {
        cancellingUserId: PLAYER,
        gameTitles: ['evening'],
        reason: 'accountDeleted',
      }),
      false,
    );
  });

  // Dispatched at groupService step 5, AFTER the club document is deleted at
  // step 3 — so there is nothing left to check authority against, and the rule
  // requires the club to be ABSENT rather than the sender to be its admin.
  test('a club admin announces the deletion, after the club is gone', async () => {
    await seed();
    await env.withSecurityRulesDisabled(async (ctx) => {
      await deleteDoc(doc(ctx.firestore(), 'groups', GID));
    });
    assert.equal(await send(ADMIN, 'groupDeleted', OF_GROUP), true);
  });
});

describe('and the stranger does not', () => {
  for (const [type, payload] of [
    ['approved', OF_GROUP],
    ['rejected', OF_GROUP],
    ['newGameInCommunity', OF_GROUP],
    ['gameCanceledOrUpdated', OF_GAME],
    ['spotOpened', OF_GAME],
    ['spotOffered', OF_GAME],
    ['groupDeleted', OF_GROUP],
  ]) {
    test(`a stranger cannot forge ${type}`, async () => {
      await seed();
      assert.equal(await send(STRANGER, type, payload), false);
    });
  }

  test('nor can a club MEMBER who is not an admin', async () => {
    // The member half matters as much as the stranger half: everyone in the
    // club could otherwise tell everyone else they had been approved.
    await seed();
    assert.equal(await send(PLAYER, 'approved', OF_GROUP), false);
    assert.equal(await send(PLAYER, 'groupDeleted', OF_GROUP), false);
  });

  test('nor can anyone send playerCancelled without naming themselves', async () => {
    await seed();
    assert.equal(await send(STRANGER, 'playerCancelled', OF_GAME), false);
    assert.equal(await send(STRANGER, 'playerCancelled', {}), false);
  });

  test('and an empty or missing payload is not a way round it', async () => {
    await seed();
    assert.equal(await send(STRANGER, 'approved', {}), false);
    assert.equal(await send(STRANGER, 'approved', { groupId: '' }), false);
    assert.equal(await send(STRANGER, 'gameCanceledOrUpdated', { gameId: 'nope' }), false);
  });
});

// ── The compatibility gate ─────────────────────────────────────────────
//
// These rules are enforced on the client that is IN THE STORES, which is
// 1.1.10 from commit 4de80d0 and contains none of this work. If a shape it
// sends is refused, a real person loses a real flow — silently, because the
// dispatch sites swallow their errors — and no app update can reach them for
// days.
//
// So every payload below is copied from `git show 4de80d0:src/services/...`,
// not written from memory of what the code ought to send. That distinction
// already caught one break: `playerCancelled` carries no gameId at all.

describe('every payload the SHIPPED client actually sends', () => {
  const CASES = [
    // groupService — club-level approvals
    ['approved',   ADMIN,  { groupId: GID, groupName: 'club' }],
    ['rejected',   ADMIN,  { groupId: GID, groupName: 'club' }],
    // gameService — game-level approvals, sent by the organiser
    ['approved',   ADMIN,  { gameId: GAME, gameTitle: 'evening', bucket: 'players' }],
    ['rejected',   ADMIN,  { gameId: GAME, gameTitle: 'evening' }],
    // a new game announced to the club
    ['newGameInCommunity', ADMIN, {
      groupId: GID, gameId: GAME, title: 'evening', startsAt: 2, fieldName: 'pitch' }],
    // the organiser changing or cancelling one
    ['gameCanceledOrUpdated', ADMIN, { gameId: GAME, gameTitle: 'evening' }],
    ['gameCanceledOrUpdated', ADMIN, {
      gameId: GAME, groupId: GID, action: 'updated', gameTitle: 'evening',
      recipientUids: [PLAYER], editorUid: '' }],
    // waitlist movement
    ['spotOffered', ADMIN, { gameId: GAME, gameTitle: 'evening', startsAt: 2 }],
    ['spotOpened',  ADMIN, { gameId: GAME, gameTitle: 'evening', startsAt: 2 }],
    // and the account-deletion consolidation, which names no game
    ['playerCancelled', PLAYER, {
      cancellingUserId: PLAYER, gameTitles: ['evening'], reason: 'accountDeleted' }],
  ];

  for (const [type, sender, payload] of CASES) {
    const keys = Object.keys(payload).slice(0, 3).join(',');
    test(`${type} from its real sender — { ${keys}… }`, async () => {
      await seed();
      assert.equal(await send(sender, type, payload), true);
    });
  }

  // The deletion pair, which both fire after their subject is gone.
  test('groupDeleted, dispatched after the club document is deleted', async () => {
    await seed();
    await env.withSecurityRulesDisabled(async (ctx) => {
      await deleteDoc(doc(ctx.firestore(), 'groups', GID));
    });
    assert.equal(await send(ADMIN, 'groupDeleted', { groupId: GID, groupName: 'club' }), true);
  });

  // Not a gap: the shipped client does NOT dispatch this one for real. Its own
  // comment says so — "a client dispatch here can't be authorised once the doc
  // is gone AND would win the dedup race" — and the live path mints it
  // server-side with srv:true. Pinned so that if someone ever re-enables the
  // client dispatch, this says what will happen.
  test('gameCanceledOrUpdated after the GAME is gone is refused — by design', async () => {
    await seed();
    await env.withSecurityRulesDisabled(async (ctx) => {
      await deleteDoc(doc(ctx.firestore(), 'games', GAME));
    });
    assert.equal(
      await send(ADMIN, 'gameCanceledOrUpdated', { gameId: GAME, action: 'deleted' }),
      false,
    );
  });
});

// ⚠️ The residual, stated rather than left to be discovered.
describe('what this does NOT close', () => {
  test('groupDeleted naming a club that does not exist is still accepted', async () => {
    // The rule for this type is "the club must be absent", because by the time
    // the real notification is sent the club IS absent and there is nothing
    // left to authorise against. So a forger can still say "your club was
    // deleted" about a club id nobody has ever seen — which renders in the
    // recipient's app as a notification about nothing.
    //
    // Closing it properly means moving the dispatch server-side, where the
    // sender's membership can be checked before the delete. That is a change
    // to make deliberately, not inside a rules patch.
    await seed();
    assert.equal(
      await send(STRANGER, 'groupDeleted', { groupId: 'no-such-club', groupName: 'x' }),
      true,
    );
  });
});
