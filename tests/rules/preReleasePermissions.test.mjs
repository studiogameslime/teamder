// Full production rules, demo emulator only. Serial runner owns the ruleset.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { doc, collection, setDoc, getDoc, getDocs, updateDoc, query, where,
  orderBy, limit, writeBatch, runTransaction } from 'firebase/firestore';

const rules = fileURLToPath(new URL('../../firestore.rules', import.meta.url));
const A = 'alice', B = 'bob', C = 'carol', CONV = `${A}__${B}`, G = 'permission-club';
let env;
const db = uid => env.authenticatedContext(uid).firestore();
const group = (owner = A) => ({ name: 'Football', creatorId: owner, adminIds: [owner],
  playerIds: [owner], pendingPlayerIds: [], isOpen: false, maxMembers: 20 });
const mirror = { name: 'Football', memberCount: 1, city: 'City' };
const metadata = { participants: [A, B], createdAt: 1, updatedAt: 1 };
const message = (senderId = A) => ({ senderId, text: 'Hello', createdAt: 1 });
const dm = (fs, id = CONV) => doc(fs, 'dmConversations', id);
const msg = (fs, id = CONV) => doc(fs, 'dmConversations', id, 'messages', 'm1');
const seed = callback => env.withSecurityRulesDisabled(ctx => callback(ctx.firestore()));
before(async () => {
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8080');
  env = await initializeTestEnvironment({ projectId: 'demo-soccer', firestore: {
    host: '127.0.0.1', port: 8080, rules: readFileSync(process.env.RULES_FILE || rules, 'utf8'),
  } });
});
beforeEach(async () => env.clearFirestore());
after(async () => env?.cleanup());

test('DM: existing canonical conversation reopens idempotently from both participants', async () => {
  await seed(fs => setDoc(dm(fs), metadata));
  for (const uid of [A, B]) {
    await assertSucceeds(setDoc(dm(db(uid)), { ...metadata, updatedAt: 2 }, { merge: true }));
    assert.equal((await assertSucceeds(getDoc(dm(db(uid))))).exists(), true);
  }
  await assertFails(getDoc(dm(db(C))));
});

test('DM: new canonical conversation can be opened and then receive its first message', async () => {
  await assertSucceeds(setDoc(dm(db(A)), metadata, { merge: true }));
  await assertSucceeds(setDoc(msg(db(A)), message()));
  await assertSucceeds(getDoc(msg(db(B))));
  await assertFails(setDoc(msg(db(C)), message(C)));
});

test('DM: nonexistent canonical route returns no metadata and an empty messages query', async () => {
  assert.equal((await assertSucceeds(getDoc(dm(db(A))))).exists(), false);
  const rows = await assertSucceeds(getDocs(query(collection(db(A), 'dmConversations', CONV, 'messages'),
    orderBy('createdAt', 'desc'), limit(80))));
  assert.equal(rows.size, 0);
  await assertFails(getDoc(dm(db(C))));
});

test('DM: exact message/receipt/typing queries work; outsider and parent enumeration remain denied', async () => {
  await seed(async fs => {
    await setDoc(dm(fs), metadata);
    await setDoc(msg(fs), message());
    for (const kind of ['reads', 'typing']) await setDoc(doc(fs, 'dmConversations', CONV, kind, A), { at: 1 });
  });
  for (const kind of ['messages', 'reads', 'typing']) {
    const q = kind === 'messages'
      ? query(collection(db(B), 'dmConversations', CONV, kind), orderBy('createdAt', 'desc'), limit(80))
      : collection(db(B), 'dmConversations', CONV, kind);
    assert.equal((await assertSucceeds(getDocs(q))).size, 1);
    await assertFails(getDocs(collection(db(C), 'dmConversations', CONV, kind)));
  }
  // The app lists users/{uid}/chats; it does not list global DM metadata.
  await assertFails(getDocs(query(collection(db(A), 'dmConversations'), where('participants', 'array-contains', A))));
});

test('DM: the actual per-user conversation-list query remains readable only to its owner', async () => {
  const fs = db(A);
  await assertSucceeds(setDoc(doc(fs, 'users', A, 'chatUnread', `dm__${CONV}`), {
    scope: 'dm', parentId: CONV, title: 'Bob', lastMessageAt: 1,
  }, { merge: true }));
  assert.equal((await assertSucceeds(getDocs(collection(fs, 'users', A, 'chatUnread')))).size, 1);
  await assertFails(getDocs(collection(db(C), 'users', A, 'chatUnread')));
});

test('DM: a participant cannot replace or append participants or grant a third party history', async () => {
  await seed(async fs => { await setDoc(dm(fs), metadata); await setDoc(msg(fs), message()); });
  for (const participants of [[A, C], [A, B, C]])
    await assertFails(updateDoc(dm(db(A)), { participants, updatedAt: 2 }));
  await assertFails(getDoc(msg(db(C))));
  assert.deepEqual((await getDoc(dm(db(A)))).data().participants, [A, B]);
});

test('DM: historical forged metadata cannot give a third party reads, typing, receipts or sends', async () => {
  await seed(async fs => { await setDoc(dm(fs), { ...metadata, participants: [A, C] }); await setDoc(msg(fs), message()); });
  await assertSucceeds(getDoc(msg(db(B))));
  await assertFails(getDoc(msg(db(C))));
  await assertFails(setDoc(msg(db(C)), message(C)));
  for (const kind of ['reads', 'typing'])
    await assertFails(setDoc(doc(db(C), 'dmConversations', CONV, kind, C), { at: 1 }));
});

test('DM: forged id, reverse order, self-conversation and extra participant creations are denied', async () => {
  for (const [id, participants] of [['unrelated', [A, B]], [`${B}__${A}`, [B, A]],
    [`${A}__${A}`, [A, A]], [CONV, [A, B, C]], [CONV, [B, A]]])
    await assertFails(setDoc(dm(db(A), id), { ...metadata, participants }));
});

test('DM: friends-only privacy gates both opening and direct message bypass', async () => {
  await seed(fs => setDoc(doc(fs, 'users', B), { dmFriendsOnly: true, friends: [] }));
  await assertFails(setDoc(dm(db(A)), metadata));
  await assertFails(setDoc(msg(db(A)), message()));
  await seed(fs => setDoc(doc(fs, 'users', B), { dmFriendsOnly: true, friends: [A] }));
  await assertSucceeds(setDoc(dm(db(A)), metadata));
  await assertSucceeds(setDoc(msg(db(A)), message()));
});

test('DM: existing history remains readable after friends-only restriction; new sends are denied', async () => {
  await seed(async fs => { await setDoc(dm(fs), metadata); await setDoc(msg(fs), message());
    await setDoc(doc(fs, 'users', B), { dmFriendsOnly: true, friends: [] }); });
  await assertSucceeds(setDoc(dm(db(A)), { ...metadata, updatedAt: 2 }, { merge: true }));
  await assertSucceeds(getDoc(msg(db(A))));
  await assertFails(setDoc(doc(db(A), 'dmConversations', CONV, 'messages', 'm2'), message()));
});

test('DM: each participant can write their own receipt/typing, never the other participant or sender', async () => {
  await seed(fs => setDoc(dm(fs), metadata));
  for (const kind of ['reads', 'typing']) {
    await assertSucceeds(setDoc(doc(db(A), 'dmConversations', CONV, kind, A), { at: 1 }));
    await assertFails(setDoc(doc(db(A), 'dmConversations', CONV, kind, B), { at: 1 }));
  }
  await assertFails(setDoc(msg(db(A)), message(B)));
});

test('groupsPublic: count-one orphan and non-admin mirror are denied; real admin succeeds', async () => {
  await assertFails(setDoc(doc(db(A), 'groupsPublic', G), mirror));
  await seed(fs => setDoc(doc(fs, 'groups', G), { ...group(), playerIds: [A, B] }));
  await assertFails(setDoc(doc(db(B), 'groupsPublic', G), mirror));
  await assertSucceeds(setDoc(doc(db(A), 'groupsPublic', G), mirror));
});

for (const mode of ['batch', 'transaction']) test(`groupsPublic: new canonical source and mirror in one ${mode} succeed atomically`, async () => {
  const fs = db(A);
  if (mode === 'batch') {
    const batch = writeBatch(fs);
    batch.set(doc(fs, 'groups', G), group()); batch.set(doc(fs, 'groupsPublic', G), mirror);
    await assertSucceeds(batch.commit());
  } else await assertSucceeds(runTransaction(fs, async tx => {
    tx.set(doc(fs, 'groups', G), group()); tx.set(doc(fs, 'groupsPublic', G), mirror);
  }));
  await assertSucceeds(getDoc(doc(fs, 'groups', G)));
  await assertSucceeds(getDoc(doc(fs, 'groupsPublic', G)));
});

test('groupsPublic: the same canonical create shape is independently allowed before its mirror', async () => {
  const fs = db(A);
  await assertSucceeds(setDoc(doc(fs, 'groups', G), group()));
  await assertSucceeds(setDoc(doc(fs, 'groupsPublic', G), mirror));
});

test('groupsPublic: oversized or mismatched mirror rejects the whole source-and-mirror batch', async () => {
  for (const [id, count] of [[G, 2], ['unrelated-club', 1]]) {
    const fs = db(A), batch = writeBatch(fs);
    batch.set(doc(fs, 'groups', G), group());
    batch.set(doc(fs, 'groupsPublic', id), { ...mirror, memberCount: count });
    await assertFails(batch.commit());
    await seed(async server => assert.equal((await getDoc(doc(server, 'groups', G))).exists(), false));
  }
});

test('groupsPublic: fake mirror adminIds and escalation of somebody elses source cannot grant creation', async () => {
  await seed(fs => setDoc(doc(fs, 'groups', G), group()));
  await assertFails(setDoc(doc(db(B), 'groupsPublic', G), { ...mirror, adminIds: [B] }));
  const fs = db(B), batch = writeBatch(fs);
  batch.update(doc(fs, 'groups', G), { adminIds: [A, B] });
  batch.set(doc(fs, 'groupsPublic', G), mirror);
  await assertFails(batch.commit());
});

test('groupsPublic: valid existing metadata batch and discovery query remain supported', async () => {
  await seed(async fs => { await setDoc(doc(fs, 'groups', G), group());
    await setDoc(doc(fs, 'groupsPublic', G), mirror); });
  const fs = db(A), batch = writeBatch(fs);
  batch.update(doc(fs, 'groups', G), { name: 'New name' });
  batch.update(doc(fs, 'groupsPublic', G), { name: 'New name' });
  await assertSucceeds(batch.commit());
  assert.equal((await assertSucceeds(getDocs(query(collection(db(C), 'groupsPublic'), where('city', '==', 'City'))))).size, 1);
});
