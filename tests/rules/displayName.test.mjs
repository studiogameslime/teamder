// A display name may not BE an email address.
//
// This rule exists because of a machine, not a person. Google Play runs a
// **pre-launch report** robot (Firebase Test Lab) against every release we
// upload. Play Console hands that robot the demo credentials from the "App
// access" page, and the robot types them into every text input it finds —
// including our onboarding "what's your name?" field. It then taps onward,
// joining public clubs and registering for real games.
//
// Forty-seven such accounts accumulated between 22.06 and 19.09.2026, all
// named `appstore.review@teamder.app`, all Android, clustering on release
// days. Two of them PLAYED in a finished game of a real seven-player club and
// sit inside its statistics to this day; a third was in that club's pending
// queue 75 seconds after signing up. The organiser was approving robots.
//
// What let it through is the detail worth keeping: `nameNotReserved` used to
// treat any name containing '@' as EXEMPT from the brand check. The robot's
// name contains "teamder" and would have been refused from the very first
// signup — the escape hatch was the hole. It is gone, and an email-shaped name
// is now refused outright.
//
// Of 676 accounts live on 19.09.2026, 47 carried an '@' in `name` and all 47
// were this robot. There is no real user to break.

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc } from 'firebase/firestore';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RULES = fs.readFileSync(path.join(HERE, '..', '..', 'firestore.rules'), 'utf8');

const ME = 'u1';

let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'rules-display-name',
    firestore: { rules: RULES, host: '127.0.0.1', port: 8080 },
  });
});

after(async () => {
  await env.cleanup();
});

/** Sign up with `name`. Resolves true if the rules allowed the create. */
async function signUp(name) {
  await env.clearFirestore();
  const db = env.authenticatedContext(ME).firestore();
  try {
    await setDoc(doc(db, 'users', ME), {
      ...(name === undefined ? {} : { name }),
      email: 'someone@gmail.com',
      createdAt: 1,
    });
    return true;
  } catch {
    return false;
  }
}

/** Seed an existing account, then try to rename it. */
async function rename(from, to, patch = {}) {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'users', ME), {
      ...(from === undefined ? {} : { name: from }),
      email: 'someone@gmail.com',
      createdAt: 1,
    });
  });
  const db = env.authenticatedContext(ME).firestore();
  try {
    await updateDoc(doc(db, 'users', ME), {
      ...(to === undefined ? {} : { name: to }),
      ...patch,
    });
    return true;
  } catch {
    return false;
  }
}

describe('an email address is not a display name', () => {
  test('the exact name the Play robot signs up with is refused', async () => {
    assert.equal(await signUp('appstore.review@teamder.app'), false);
  });

  for (const name of [
    'appstore.review@teamder.app',
    'hazelblake.54551@gmail.com',
    'RAMONACARPENTER.29111@GMAIL.COM',   // the check lowercases first
    'eugene.burns+footy@googlemail.co.uk',
    '  elsiepeterson.90814@gmail.com  ', // padding does not disguise it
    'מתן someone@gmail.com',             // an address EMBEDDED in a name
  ]) {
    test(`refused at signup: ${JSON.stringify(name)}`, async () => {
      assert.equal(await signUp(name), false);
    });
  }

  for (const name of [
    'מתן לוי',
    'Idan Almaliach',
    'עידן @ נחלים',        // a bare '@' is not an address
    'DJ @Khaled',
    'user@localhost',       // no dot in the domain — not an address shape
    'a@b.c',                // single-letter TLD is below the {2,} floor
  ]) {
    test(`still allowed at signup: ${JSON.stringify(name)}`, async () => {
      assert.equal(await signUp(name), true);
    });
  }

  test('a signup with no name at all is unaffected', async () => {
    assert.equal(await signUp(undefined), true);
  });
});

describe('renaming', () => {
  test('a real player cannot rename themselves into an address', async () => {
    assert.equal(await rename('מתן לוי', 'matan@gmail.com'), false);
  });

  test('and can rename themselves to anything else', async () => {
    assert.equal(await rename('מתן לוי', 'מתן ל.'), true);
  });

  // The load-bearing half. An account that ALREADY carries such a name must
  // not be locked out of every unrelated write — fcm token refresh, presence,
  // availability — for ever. `nameNotNewlyEmail` only polices a name that is
  // actually changing, exactly as `nameNotNewlyReserved` does for the brand.
  test('an existing robot account can still write unrelated fields', async () => {
    assert.equal(
      await rename('appstore.review@teamder.app', 'appstore.review@teamder.app', {
        lastSeenAt: 2,
      }),
      true,
    );
  });

  test('an unrelated write that omits `name` entirely is unaffected', async () => {
    assert.equal(await rename('appstore.review@teamder.app', undefined, { lastSeenAt: 2 }), true);
  });

  test('but it cannot move to a DIFFERENT address', async () => {
    assert.equal(await rename('appstore.review@teamder.app', 'other@gmail.com'), false);
  });

  test('and it can clean itself up to a real name', async () => {
    assert.equal(await rename('appstore.review@teamder.app', 'עידן'), true);
  });
});

// The escape hatch that was the actual hole. `appstore.review@teamder.app`
// contains "teamder"; the brand check skipped any name with an '@' in it, so
// the one name we would most obviously have wanted to refuse was waved past.
describe('the brand check no longer exempts email-shaped names', () => {
  for (const name of ['support@teamder.app', 'Teamder Support', 'טימדר רשמי']) {
    test(`refused: ${JSON.stringify(name)}`, async () => {
      assert.equal(await signUp(name), false);
    });
  }
});
