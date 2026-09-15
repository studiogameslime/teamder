import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc } from 'firebase/firestore';
import fs from 'node:fs';
const withS = fs.readFileSync('/Users/matan/Projects/soccer/firestore.rules', 'utf8');
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
async function scenario(label, rules, nPlayers) {
  const e = await initializeTestEnvironment({ projectId: 'p4-' + (++n),
    firestore: { rules, host: '127.0.0.1', port: 8080 } });
  await e.clearFirestore();
  const players = Array.from({length: nPlayers}, (_, i) => 'u' + i);
  players.push('coadmin', 'creator');
  const admins = ['creator', 'coadmin'];
  await e.withSecurityRulesDisabled(async (c) => {
    await setDoc(doc(c.firestore(), 'groups', 'g1'), {
      name: 'club', adminIds: admins, creatorId: 'creator',
      playerIds: players, pendingPlayerIds: [], createdAt: 1,
      seasons: { enabled: true, currentNo: 1, currentId: 's1', count: 0 },
    });
  });
  const db = e.authenticatedContext('creator').firestore();
  try {
    await updateDoc(doc(db, 'groups', 'g1'), {
      adminIds: ['coadmin'],
      playerIds: players.filter(p => p !== 'creator'),
      creatorId: 'coadmin', updatedAt: 2 });
    console.log(`${label} players=${nPlayers} creator-handoff → ALLOWED`);
  } catch (err) {
    console.log(`${label} players=${nPlayers} creator-handoff → DENIED: ${String(err.message).replace(/\s+/g,' ').slice(0,130)}`);
  }
  await e.cleanup();
}
for (const np of [5, 100, 300, 498]) { await scenario('WITH   ', withS, np); await scenario('WITHOUT', without, np); }
