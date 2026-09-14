// Who may read a sealed season.
//
// The archive is club-scoped, so the bound is club membership — the same as
// the live table it replaces. Two read statements rather than one, because a
// `list` does not bind the path wildcard: reading `groupId` from the path in a
// query raises a Null value error and denies everything, which is exactly the
// bug that once made communityStats unreadable.

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RULES = fs.readFileSync(path.join(HERE, '..', '..', 'firestore.rules'), 'utf8');
const GID = 'club1', MEMBER = 'member', OUTSIDER = 'outsider', LEFT = 'departed';

let env;
before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'rules-season-summary',
    firestore: { rules: RULES, host: '127.0.0.1', port: 8080 },
  });
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'groups', GID), {
      name: 'club', adminIds: ['admin'], playerIds: [MEMBER, 'admin'],
      pendingPlayerIds: [], createdAt: 1,
    });
    await setDoc(doc(db, 'seasonSummary', `${GID}__s1`), {
      groupId: GID, groupName: 'club', seasonId: 's1', no: 1, totals: {},
      // `departed` played the season and has since left the club.
      players: { [MEMBER]: { rounds: 10 }, [LEFT]: { rounds: 8 } },
    });
    await setDoc(doc(db, 'users', MEMBER, 'seasonTitles', `${GID}__s1__topScorer`), {
      groupId: GID, groupName: 'club', seasonId: 's1', seasonNo: 1,
      titleKey: 'topScorer', value: 31, at: 1,
    });
  });
});
after(async () => { await env.cleanup(); });

const asMember = () => env.authenticatedContext(MEMBER).firestore();
const asOutsider = () => env.authenticatedContext(OUTSIDER).firestore();
const asDeparted = () => env.authenticatedContext(LEFT).firestore();

describe('a club member reads their own seasons', () => {
  test('one season by id', async () => {
    const s = await getDoc(doc(asMember(), 'seasonSummary', `${GID}__s1`));
    assert.equal(s.exists(), true);
  });

  test('and can list them — the wildcard trap', async () => {
    // Answered from the FIELD. If the rule read groupId off the path this
    // would deny with a Null value error.
    const q = query(collection(asMember(), 'seasonSummary'),
                    where('groupId', '==', GID));
    const snap = await getDocs(q);
    assert.equal(snap.size, 1);
  });
});

describe('and so does somebody who PLAYED it and has since left', () => {
  // They are pushed a summary of this very season the day it closes. Denying
  // them would deep-link a real notification into a permission error — and
  // half the point of sealing a season is that leaving does not erase what you
  // did in it.
  test('by id', async () => {
    const s = await getDoc(doc(asDeparted(), 'seasonSummary', `${GID}__s1`));
    assert.equal(s.exists(), true);
    assert.equal(s.data().groupName, 'club');
  });

  test('but a LIST is still members-only — the wildcard trap, again', async () => {
    // A participant clause on the list path would be evaluated per document
    // and deny the whole query the moment it met a season this caller sat
    // out. So listing stays bound to membership; only the single-document
    // read widens.
    await assert.rejects(() => getDocs(query(
      collection(asDeparted(), 'seasonSummary'), where('groupId', '==', GID))));
  });

  test('and a member listing their club still gets every season', async () => {
    const snap = await getDocs(query(
      collection(asMember(), 'seasonSummary'), where('groupId', '==', GID)));
    assert.ok(snap.size >= 1);
  });

  test('but not a season they never played', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'seasonSummary', `${GID}__s0`), {
        groupId: GID, seasonId: 's0', no: 0, players: { someoneElse: { rounds: 4 } },
        totals: {},
      });
    });
    await assert.rejects(() =>
      getDoc(doc(asDeparted(), 'seasonSummary', `${GID}__s0`)));
  });
});

describe('somebody else cannot', () => {
  test('not by id', async () => {
    await assert.rejects(() =>
      getDoc(doc(asOutsider(), 'seasonSummary', `${GID}__s1`)));
  });

  test('not by query', async () => {
    await assert.rejects(() => getDocs(query(
      collection(asOutsider(), 'seasonSummary'), where('groupId', '==', GID))));
  });
});

describe('nobody writes', () => {
  test('not a member', async () => {
    await assert.rejects(() =>
      setDoc(doc(asMember(), 'seasonSummary', `${GID}__s9`), { groupId: GID }));
  });

  test('not even to their own club season', async () => {
    await assert.rejects(() => setDoc(
      doc(env.authenticatedContext('admin').firestore(), 'seasonSummary', `${GID}__s1`),
      { groupId: GID, tampered: true }));
  });
});

// ── The titles themselves ────────────────────────────────────────────────
//
// Deliberately wider than the season document they came from. A title is a
// boast worn on a public profile: it says a club name, a number and a season,
// and it hangs on a screen that is already open to every signed-in user.
// Binding it to club membership instead would mean a player could not show a
// title to anyone outside the club that gave it — which is the opposite of
// what a title is for.
//
// Writing is a different matter entirely.
describe('a season title is public, like the profile it hangs on', () => {
  test('a club member reads it', async () => {
    const t = await getDoc(doc(asMember(), 'users', MEMBER, 'seasonTitles', `${GID}__s1__topScorer`));
    assert.equal(t.exists(), true);
    assert.equal(t.data().value, 31);
  });

  test('and so does someone outside the club', async () => {
    const t = await getDoc(doc(asOutsider(), 'users', MEMBER, 'seasonTitles', `${GID}__s1__topScorer`));
    assert.equal(t.exists(), true);
  });

  test('a player can list their own titles', async () => {
    const snap = await getDocs(collection(asMember(), 'users', MEMBER, 'seasonTitles'));
    assert.equal(snap.size, 1);
  });

  test('and list somebody else\'s, which is the point of a boast', async () => {
    const snap = await getDocs(collection(asOutsider(), 'users', MEMBER, 'seasonTitles'));
    assert.equal(snap.size, 1);
  });
});

describe('but nobody awards themselves a title', () => {
  test('not on their own profile', async () => {
    await assert.rejects(() => setDoc(
      doc(asMember(), 'users', MEMBER, 'seasonTitles', `${GID}__s2__topScorer`),
      { groupId: GID, titleKey: 'topScorer', value: 99 }));
  });

  test('not on anybody else\'s', async () => {
    await assert.rejects(() => setDoc(
      doc(asOutsider(), 'users', MEMBER, 'seasonTitles', `${GID}__s2__mvp`),
      { groupId: GID, titleKey: 'mvp', value: 10 }));
  });

  test('and not by overwriting one they really did win', async () => {
    await assert.rejects(() => setDoc(
      doc(asMember(), 'users', MEMBER, 'seasonTitles', `${GID}__s1__topScorer`),
      { groupId: GID, titleKey: 'topScorer', value: 999 }));
  });
});
