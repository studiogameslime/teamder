// Rules: publishing a stored team split.
//
// Reported from production — an admin ended the evening, tapped "פרסם כוחות"
// four minutes later and got permission-denied, so that night's teams stayed
// hidden from the players for good.
//
// The cause was NOT the `status != 'finished'` guard everyone would suspect.
// `allow update` on /games is one long OR chain, and Firestore stops evaluating
// a rule after 1000 expressions: on a real game document the earlier branches
// spend the entire budget and the request is denied before the branch that
// would have allowed it is ever reached.
//
// That is why this suite runs against a fixture with the SAME 82 fields as the
// production document (values anonymised). A minimal 8-field game passes these
// tests even with the bug present — it never gets near the cap.
//
//   JAVA_HOME=/opt/homebrew/opt/openjdk \
//   npx firebase emulators:exec --only firestore --project rules-test \
//     "node --test --test-reporter=spec publishTeams.test.mjs"

import { test, before, after, beforeEach } from 'node:test';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { doc, setDoc, updateDoc } from 'firebase/firestore';

const { game, group } = JSON.parse(readFileSync('./bigGame.fixture.json', 'utf8'));
const GAME = 'game1';
const GROUP = 'grp1';
const ADMIN = 'uid_admin';      // club admin, NOT the game's creator
const OWNER = 'uid_owner';      // the game's creator
const PLAYER = 'uid_p0';        // an ordinary participant
const STRANGER = 'uid_nobody';

let env;
before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'rules-publish-teams',
    firestore: {
      rules: readFileSync('../../firestore.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

// Reset before EVERY case. Without this, a case that runs after a successful
// publish writes a no-op — Firestore computes an empty diff and the assertion
// passes for a reason unrelated to the rule under test.
beforeEach(async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'groups', GROUP), group);
    await setDoc(doc(db, 'games', GAME), game);
  });
});
after(async () => { await env?.cleanup(); });

const as = (uid) => env.authenticatedContext(uid).firestore();
const publishAs = (uid) =>
  updateDoc(doc(as(uid), 'games', GAME), {
    'draftTeams.published': true,
    updatedAt: Date.now(),
  });

test('a club admin can publish a split on a FINISHED game', async () => {
  await assertSucceeds(publishAs(ADMIN));
});

test('the game creator can too', async () => {
  await assertSucceeds(publishAs(OWNER));
});

test('an ordinary participant cannot', async () => {
  await assertFails(publishAs(PLAYER));
});

test('a stranger cannot', async () => {
  await assertFails(publishAs(STRANGER));
});

test('it cannot be used to rewrite who played with whom', async () => {
  const teams = [
    { index: 0, captainId: 'uid_p0', playerIds: ['uid_p0', 'uid_p5'] },
    { index: 1, captainId: 'uid_p1', playerIds: ['uid_p1', 'uid_p6'] },
  ];
  await assertFails(
    updateDoc(doc(as(ADMIN), 'games', GAME), {
      draftTeams: { ...game.draftTeams, published: true, teams },
      updatedAt: Date.now(),
    }),
  );
});

test('it cannot UNpublish a split', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'games', GAME), {
      ...game,
      draftTeams: { ...game.draftTeams, published: true },
    });
  });
  await assertFails(
    updateDoc(doc(as(ADMIN), 'games', GAME), {
      'draftTeams.published': false,
      updatedAt: Date.now(),
    }),
  );
});

test('it cannot smuggle another field through alongside the flag', async () => {
  await assertFails(
    updateDoc(doc(as(ADMIN), 'games', GAME), {
      'draftTeams.published': true,
      status: 'open',
      updatedAt: Date.now(),
    }),
  );
});
