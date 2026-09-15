import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc } from 'firebase/firestore';
import fs from 'node:fs';
const RULES_PATH = '/Users/matan/Projects/soccer/firestore.rules';
const withS = fs.readFileSync(RULES_PATH, 'utf8');
const clause = `        (
          !affectedKeys().hasAny(['seasons']) ||
          (
            'seasons' in resource.data &&
            request.resource.data.seasons == resource.data.seasons
          )
        ) &&
`;
const without = withS.replace(clause, '');
let n = 0;
async function scenario(label, rules, nPlayers, hasSeasons) {
  const e = await initializeTestEnvironment({ projectId: 'p3-' + (++n),
    firestore: { rules, host: '127.0.0.1', port: 8080 } });
  await e.clearFirestore();
  const players = Array.from({length: nPlayers}, (_, i) => 'u' + i);
  players.push('coadmin', 'creator');
  const admins = ['creator', 'coadmin'];
  await e.withSecurityRulesDisabled(async (c) => {
    await setDoc(doc(c.firestore(), 'groups', 'g1'), {
      name: 'club', adminIds: admins, creatorId: 'creator',
      playerIds: players, pendingPlayerIds: [], createdAt: 1,
      ...(hasSeasons ? { seasons: { enabled: true, currentNo: 1, currentId: 's1', count: 0 } } : {}),
    });
  });
  const db = e.authenticatedContext('coadmin').firestore();
  // co-admin self-leave: remove self from adminIds AND playerIds
  const newAdmins = admins.filter(a => a !== 'coadmin');
  const newPlayers = players.filter(p => p !== 'coadmin');
  try {
    await updateDoc(doc(db, 'groups', 'g1'),
      { adminIds: newAdmins, playerIds: newPlayers, updatedAt: 2 });
    console.log(`${label} players=${nPlayers} seasons=${hasSeasons} → ALLOWED`);
  } catch (err) {
    console.log(`${label} players=${nPlayers} seasons=${hasSeasons} → DENIED: ${String(err.message).replace(/\s+/g,' ').slice(0,120)}`);
  }
  await e.cleanup();
}
for (const np of [5, 50, 150, 300, 498]) {
  await scenario('WITH   ', withS, np, true);
  await scenario('WITHOUT', without, np, true);
}
