import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, getDoc } from 'firebase/firestore';
import fs from 'node:fs';

const RULES_PATH = '/Users/matan/Projects/soccer/firestore.rules';
const withSeasons = fs.readFileSync(RULES_PATH, 'utf8');
// Strip the new seasons clause to compare expression budgets.
const clause = `        (
          !affectedKeys().hasAny(['seasons']) ||
          (
            'seasons' in resource.data &&
            request.resource.data.seasons == resource.data.seasons
          )
        ) &&
`;
if (!withSeasons.includes(clause)) { console.log('CLAUSE NOT FOUND'); process.exit(1); }
const without = withSeasons.replace(clause, '');

async function run(label, rules, nPlayers) {
  const env = await initializeTestEnvironment({
    projectId: 'probe-' + label.toLowerCase() + '-' + nPlayers,
    firestore: { rules, host: '127.0.0.1', port: 8080 },
  });
  await env.clearFirestore();
  const players = Array.from({length: nPlayers}, (_, i) => 'u' + i);
  const pending = Array.from({length: 200}, (_, i) => 'p' + i);
  const admins = Array.from({length: 20}, (_, i) => 'a' + i);
  admins[0] = 'admin';
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'groups', 'g1'), {
      name: 'club', adminIds: admins, creatorId: 'admin',
      playerIds: players, pendingPlayerIds: pending, createdAt: 1,
      description: 'x', city: 'y', fieldName: 'f', fieldAddress: 'fa',
      seasons: { enabled: true, currentNo: 2, currentId: 's2', count: 1, startedAt: 1,
                 cadence: { type: 'rounds', targetRounds: 20 } },
    });
  });
  const db = env.authenticatedContext('admin').firestore();
  let res;
  try {
    await updateDoc(doc(db, 'groups', 'g1'), { description: 'עדכון רגיל' });
    res = 'ALLOWED';
  } catch (e) { res = 'DENIED: ' + String(e.message).slice(0, 160); }
  console.log(`${label} players=${nPlayers} adminEdit → ${res}`);
  await env.cleanup();
}

for (const n of [10, 100, 300, 500]) {
  await run('WITH', withSeasons, n);
  await run('WITHOUT', without, n);
}
