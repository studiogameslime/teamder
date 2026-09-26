// The optional city on "זה אתה?" — asked against the real rules, not reasoned
// about.
//
// The profile-confirmation screen now writes a home city alongside the name
// and the avatar, and it writes it to `availability.homeCity` — the field the
// availability editor and the filler matcher already use — via DOT PATHS
// rather than a nested object, so a city-only write cannot stamp a partial
// availability map over what the editor writes later.
//
// Three things make this worth a rules test rather than an assumption:
//
//   • it is the write on the critical path of EVERY new account. A denial here
//     is not a degraded feature, it is sign-up failing;
//   • it runs on a document that is seconds old, before the converter has
//     settled an `invitedBy` placeholder — the exact shape that has broken
//     /users writes before (see availabilitySave.test.mjs, and the
//     `.get(k,default)` null trap before that);
//   • dot paths reach the rules as a merged `request.resource.data`, and
//     "obviously the same as a nested write" is precisely the kind of
//     obviousness that has cost this project a production outage.

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, getDoc } from 'firebase/firestore';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RULES = fs.readFileSync(path.join(HERE, '..', '..', 'firestore.rules'), 'utf8');
const ME = 'u1';

let env;
before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'rules-onboarding-city',
    firestore: { rules: RULES, host: '127.0.0.1', port: 8080 },
  });
});
after(async () => { await env.cleanup(); });

/** Exactly what `userService.completeOnboarding` sends. */
async function completeOnboarding(seed, over = {}) {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'users', ME), { createdAt: 1, ...seed });
  });
  const db = env.authenticatedContext(ME).firestore();
  try {
    await updateDoc(doc(db, 'users', ME), {
      name: 'מתן',
      onboardingCompleted: true,
      updatedAt: 2,
      avatarId: 'a3',
      'availability.homeCity': 'תל־אביב–יפו',
      'availability.homeCityLat': 32.07,
      'availability.homeCityLng': 34.78,
      ...over,
    });
    return true;
  } catch (e) {
    return String(e).slice(0, 140);
  }
}

describe('finishing onboarding with a city', () => {
  // The shape a brand-new account actually has: the converter seeds a null
  // invitedBy placeholder on create.
  test('a fresh account with a null invitedBy placeholder', async () => {
    assert.equal(await completeOnboarding({ invitedBy: null }), true);
  });

  test('a fresh account with no invitedBy key at all', async () => {
    assert.equal(await completeOnboarding({}), true);
  });

  test('an invited account, attribution already locked', async () => {
    assert.equal(
      await completeOnboarding({ invitedBy: 'eliran', invitedByType: 'user' }),
      true,
    );
  });

  test('without a city — the field is optional and the write omits it', async () => {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', ME), { createdAt: 1, invitedBy: null });
    });
    const db = env.authenticatedContext(ME).firestore();
    let ok = true;
    try {
      await updateDoc(doc(db, 'users', ME), {
        name: 'מתן', onboardingCompleted: true, updatedAt: 2, avatarId: 'a3',
      });
    } catch { ok = false; }
    assert.equal(ok, true);
  });
});

describe('the dot paths do what they claim', () => {
  test('create the availability map when there was none', async () => {
    assert.equal(await completeOnboarding({ invitedBy: null }), true);
    await env.withSecurityRulesDisabled(async (ctx) => {
      const snap = await getDoc(doc(ctx.firestore(), 'users', ME));
      assert.equal(snap.data().availability.homeCity, 'תל־אביב–יפו');
      assert.equal(snap.data().availability.homeCityLat, 32.07);
    });
  });

  test('leave the REST of an existing availability map alone', async () => {
    // The reason this is a dot-path write. A nested `availability: {homeCity}`
    // would delete every field below on somebody who set their availability
    // before finishing onboarding — the whole filler opt-in, silently.
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', ME), {
        createdAt: 1,
        invitedBy: null,
        availability: {
          preferredDays: [2, 5],
          availabilityRadiusKm: 15,
          isAvailableForInvites: true,
          acceptsFillerPush: true,
        },
      });
    });
    const db = env.authenticatedContext(ME).firestore();
    await updateDoc(doc(db, 'users', ME), {
      name: 'מתן',
      onboardingCompleted: true,
      updatedAt: 2,
      'availability.homeCity': 'חיפה',
    });
    await env.withSecurityRulesDisabled(async (ctx) => {
      const a = (await getDoc(doc(ctx.firestore(), 'users', ME))).data().availability;
      assert.equal(a.homeCity, 'חיפה');
      assert.deepEqual(a.preferredDays, [2, 5]);
      assert.equal(a.acceptsFillerPush, true);
      assert.equal(a.availabilityRadiusKm, 15);
    });
  });
});

describe('what it must still refuse', () => {
  test('somebody else finishing MY onboarding', async () => {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', ME), { createdAt: 1 });
    });
    const db = env.authenticatedContext('someoneElse').firestore();
    let denied = false;
    try {
      await updateDoc(doc(db, 'users', ME), { 'availability.homeCity': 'חיפה' });
    } catch { denied = true; }
    assert.equal(denied, true);
  });

  test('an ANONYMOUS session writing a city onto a user doc', async () => {
    // A guest has no /users doc by design, and the city is collected AFTER
    // authentication. Nothing in this flow should give an anonymous uid a
    // reason to write one.
    await env.clearFirestore();
    const db = env
      .authenticatedContext('anon1', { firebase: { sign_in_provider: 'anonymous' } })
      .firestore();
    let denied = false;
    try {
      await updateDoc(doc(db, 'users', ME), { 'availability.homeCity': 'חיפה' });
    } catch { denied = true; }
    assert.equal(denied, true);
  });
});
