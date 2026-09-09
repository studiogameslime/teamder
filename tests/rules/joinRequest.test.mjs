// Asking to join a closed community — the self-add to `pendingPlayerIds`.
//
// Reported from production as two errors logged 0.7s apart for one tap:
// `joinGroup` and `requestJoinGroup`, both `permission-denied`, both
// "Missing or insufficient permissions". The user retried two minutes later
// and it went through, so nothing was broken for good — it just failed, with
// a raw permissions error, on a perfectly ordinary action.
//
// Two conditions denied that write, and both are exercised here:
//
//   1. The club has no `pendingPlayerIds` field at all. Reading it unguarded
//      ERRORS inside the rule, and an erroring clause denies. A club created
//      before the field existed could therefore never receive a join request.
//      One such club is live today.
//
//   2. The caller is ALREADY in the queue. `arrayUnion` is a no-op then, so
//      the array does not grow, and an `== old.size() + 1` size check fails.
//      That turned the second tap on "בקש להצטרף" — or any retry after a
//      network blip — into a hard error on a request that had already worked.
//
// The size check is now `<=`, which with `hasAll(old)` still pins the write to
// "at most one new entry, and it is the caller". The other half of this file
// is the proof of that: every eviction and injection shape stays denied. Those
// cases are the reason the strict form existed, and they must not be traded
// away for the fix.

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc } from 'firebase/firestore';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RULES = fs.readFileSync(path.join(HERE, '..', '..', 'firestore.rules'), 'utf8');

const GID = 'g1';
const ME = 'joiner';
const ADMIN = 'adminUid';

let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'rules-join-request',
    firestore: { rules: RULES, host: '127.0.0.1', port: 8080 },
  });
});

after(async () => {
  await env.cleanup();
});

/** Seed one closed club. `pending === undefined` omits the field entirely. */
async function seed(pending, extra = {}) {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'groups', GID), {
      name: 'closed club',
      isOpen: false,
      adminIds: [ADMIN],
      playerIds: [ADMIN, 'p1'],
      createdAt: 1,
      ...(pending === undefined ? {} : { pendingPlayerIds: pending }),
      ...extra,
    });
  });
}

/** Write `next` as the whole queue, as the joiner. Resolves to true if allowed. */
async function askToJoin(next) {
  const db = env.authenticatedContext(ME).firestore();
  try {
    await updateDoc(doc(db, 'groups', GID), {
      pendingPlayerIds: next,
      updatedAt: Date.now(),
    });
    return true;
  } catch {
    return false;
  }
}

describe('a person can ask to join', () => {
  test('the ordinary first request', async () => {
    await seed([]);
    assert.equal(await askToJoin([ME]), true);
  });

  test('joining a queue that already holds other people', async () => {
    await seed(['other']);
    assert.equal(await askToJoin(['other', ME]), true);
  });

  test('a club that predates the pendingPlayerIds field — bug 1', async () => {
    await seed(undefined);
    assert.equal(
      await askToJoin([ME]),
      true,
      'a club with no pendingPlayerIds must still accept a join request',
    );
  });

  test('asking twice is idempotent, not an error — bug 2', async () => {
    await seed([ME]);
    assert.equal(
      await askToJoin([ME]),
      true,
      'arrayUnion is a no-op when already pending; the retry must not fail',
    );
  });

  test('asking twice when others are queued too', async () => {
    await seed(['x', ME, 'y']);
    assert.equal(await askToJoin(['x', ME, 'y']), true);
  });
});

describe('but cannot touch anybody else on the way in', () => {
  test('cannot evict a pending rival and take their place', async () => {
    await seed(['victim']);
    assert.equal(await askToJoin([ME]), false);
  });

  test('cannot smuggle a stranger in alongside themselves', async () => {
    await seed(['victim']);
    assert.equal(await askToJoin(['victim', ME, 'stranger']), false);
  });

  test('cannot pad a duplicate to hide an eviction', async () => {
    // [a,b] → [b,b,me] grows by one and "contains" b, but a is gone. This is
    // the shape a set-membership check misses; hasAll on the list catches it.
    await seed(['a', 'b']);
    assert.equal(await askToJoin(['b', 'b', ME]), false);
  });

  test('cannot enqueue somebody who is not them', async () => {
    await seed([]);
    assert.equal(await askToJoin(['stranger']), false);
  });

  test('cannot empty the queue', async () => {
    await seed(['victim']);
    assert.equal(await askToJoin([]), false);
  });

  test('cannot slip in past a full club', async () => {
    // The client pre-checks capacity against the denormalised public
    // memberCount; the rule is what holds when that count lags.
    await seed([], { maxMembers: 2 });
    assert.equal(await askToJoin([ME]), false);
  });
});
