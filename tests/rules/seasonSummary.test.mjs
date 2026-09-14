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
const GID = 'club1', MEMBER = 'member', OUTSIDER = 'outsider';

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
      groupId: GID, seasonId: 's1', no: 1, players: {}, totals: {},
    });
  });
});
after(async () => { await env.cleanup(); });

const asMember = () => env.authenticatedContext(MEMBER).firestore();
const asOutsider = () => env.authenticatedContext(OUTSIDER).firestore();

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
