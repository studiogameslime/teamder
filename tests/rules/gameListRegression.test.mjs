// The list queries the app actually issues against /games.
//
// Written after a burst of permission-denied on 22.09 — getMyLiveOrUpcomingGames,
// deriveGamesJoined, getPlayedGames, findRegistrationConflict — from users on
// 1.1.8 and 1.1.11, i.e. binaries that had not changed. The only thing that had
// changed was the ruleset, released 05:17:35Z; the first denial is 06:00:37Z.
//
// These are LIST queries, not gets. A list is evaluated per returned document,
// and it is also subject to the document-access budget: every distinct
// exists()/get() path counts. isGroupMemberSafe() adds an exists() the old
// isGroupMember() did not have, so a query spanning several clubs can spend
// twice the budget it used to.
//
// Run: firebase emulators:exec --only firestore --project demo-soccer \
//        "cd tests/rules && node --test gameListRegression.test.mjs"

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { initializeTestEnvironment, assertFails, assertSucceeds }
  from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { collection, query, where, getDocs, setDoc, doc } from 'firebase/firestore';

const __dirname = dirname(fileURLToPath(import.meta.url));
const UID = 'uPlayer';
const RULES = process.env.RULES_FILE || join(__dirname, '../../firestore.rules');
let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-soccer',
    firestore: { rules: readFileSync(RULES, 'utf8'), host: '127.0.0.1', port: 8080 },
  });
});
after(async () => { await env?.cleanup(); });

// N clubs, one game each, the player a participant in every one. This is the
// shape that spends the access budget: every game points at a DIFFERENT group,
// so the group lookup cannot be served from the per-request cache.
async function seed(clubCount) {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'users', UID), { id: UID, name: 'P' });
    for (let i = 0; i < clubCount; i++) {
      const gid = `club${i}`;
      await setDoc(doc(db, 'groups', gid), { id: gid, playerIds: [UID], adminIds: [] });
      await setDoc(doc(db, 'games', `game${i}`), {
        id: `game${i}`, groupId: gid, visibility: 'community',
        createdBy: 'someoneElse', participantIds: [UID],
        startsAt: new Date('2026-09-23T17:00:00Z'),
      });
    }
  });
}

const asPlayer = () => env.authenticatedContext(UID).firestore();
const myGames = (db) => getDocs(query(
  collection(db, 'games'),
  where('participantIds', 'array-contains', UID),
  where('startsAt', '>=', new Date('2026-09-20T00:00:00Z')),
));

for (const n of [1, 5, 9, 10, 11, 15]) {
  test(`getMyLiveOrUpcomingGames across ${n} different clubs`, async () => {
    await seed(n);
    const snap = await assertSucceeds(myGames(asPlayer()));
    assert.equal(snap.size, n, `expected all ${n} games back`);
  });
}
