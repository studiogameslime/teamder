// "שמירת זמינות נכשלה" — permission-denied, four times, on 1.1.10.
//
// Pulse error 17u7z13. Context: {"screen":"AvailabilityEditScreen","days":"",
// "radiusKm":15,"userId":"E7vjdAjEp8VGJca4LFukTw8K0Kl1"}. `days: ""` is the
// tell — the user saved with NO day selected, which is what the screen sends
// when somebody clears the grid and taps save.
//
// The write is a single updateDoc on /users/{uid} with an `availability` map,
// so the question is which clause of the /users update rule refuses it. Asked
// here against the real rules rather than reasoned about.

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc } from 'firebase/firestore';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RULES = fs.readFileSync(process.env.RULES_AT_ERROR ? path.join(HERE, '_atError.rules') : path.join(HERE, '..', '..', 'firestore.rules'), 'utf8');
const ME = 'u1';

let env;
before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'rules-availability',
    firestore: { rules: RULES, host: '127.0.0.1', port: 8080 },
  });
});
after(async () => { await env.cleanup(); });

/** Seed a user doc, then save availability as that user. */
async function save(seed, availability) {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'users', ME), { name: 'מתן', createdAt: 1, ...seed });
  });
  const db = env.authenticatedContext(ME).firestore();
  try {
    await updateDoc(doc(db, 'users', ME), { availability, updatedAt: 2 });
    return true;
  } catch (e) {
    return String(e).slice(0, 120);
  }
}

/** Exactly what AvailabilityEditScreen.persistAvailability sends. */
const payload = (over = {}) => ({
  preferredDays: [],
  preferredTimes: [],
  availabilitySlots: {},
  preferredCity: null,
  cities: [],
  homeCity: null,
  homeCityLat: null,
  homeCityLng: null,
  availabilityRadiusKm: 15,
  isAvailableForInvites: true,
  acceptsFillerPush: false,
  ...over,
});

describe('saving availability', () => {
  test('an ordinary user clearing every day — the reported case', async () => {
    assert.equal(await save({}, payload()), true);
  });

  test('with days and slots filled in', async () => {
    assert.equal(
      await save({}, payload({ preferredDays: [2, 5], preferredTimes: ['evening'],
        availabilitySlots: { 2: ['evening'], 5: ['morning'] } })),
      true,
    );
  });

  test('with a home city and coordinates', async () => {
    assert.equal(
      await save({}, payload({ preferredCity: 'תל־אביב–יפו', cities: ['תל־אביב–יפו'],
        homeCity: 'תל־אביב–יפו', homeCityLat: 32.07, homeCityLng: 34.78 })),
      true,
    );
  });

  // The account shapes that could plausibly be the reporter's.
  test('a user whose attribution is already locked', async () => {
    assert.equal(await save({ invitedBy: 'someoneElse', invitedByType: 'user' }, payload()), true);
  });

  test('a user with a null invitedBy placeholder', async () => {
    assert.equal(await save({ invitedBy: null }, payload()), true);
  });

  test('a LEGACY user doc with no invitedBy key at all', async () => {
    // The shape that broke every /users write once before: reading an absent
    // field errors, and an erroring clause denies.
    assert.equal(await save({ name: 'ותיק' }, payload()), true);
  });

  test('a user whose display name is an email — one of the 92 robots', async () => {
    // The name is unchanged by this write, so nameNotNewlyEmail must let it
    // through. If it did not, every one of those accounts would be locked out
    // of fcm-token refresh and availability alike.
    assert.equal(await save({ name: 'appstore.review@teamder.app' }, payload()), true);
  });

  test('a user with no name field at all', async () => {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', ME), { createdAt: 1 });
    });
    const db = env.authenticatedContext(ME).firestore();
    let ok = true;
    try { await updateDoc(doc(db, 'users', ME), { availability: payload(), updatedAt: 2 }); }
    catch { ok = false; }
    assert.equal(ok, true);
  });
});

describe('and it is still somebody else who cannot', () => {
  test('a different user may not write my availability', async () => {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', ME), { name: 'מתן', createdAt: 1 });
    });
    const db = env.authenticatedContext('someoneElse').firestore();
    let ok = true;
    try { await updateDoc(doc(db, 'users', ME), { availability: payload() }); } catch { ok = false; }
    assert.equal(ok, false);
  });
});
