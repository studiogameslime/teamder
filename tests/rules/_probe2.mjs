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
async function env(rules) {
  const e = await initializeTestEnvironment({ projectId: 'p2-' + (++n),
    firestore: { rules, host: '127.0.0.1', port: 8080 } });
  await e.clearFirestore();
  await e.withSecurityRulesDisabled(async (c) => {
    await setDoc(doc(c.firestore(), 'groups', 'g1'), {
      name: 'club', adminIds: ['admin'], creatorId: 'admin',
      playerIds: ['admin','m'], pendingPlayerIds: [], createdAt: 1,
      seasons: { enabled: true, currentNo: 4, currentId: 's4', count: 3, startedAt: 1 },
    });
  });
  return e;
}
async function attempt(label, rules, payload) {
  const e = await env(rules);
  const db = e.authenticatedContext('admin').firestore();
  try { await updateDoc(doc(db, 'groups', 'g1'), payload); console.log(label, '→ ALLOWED'); }
  catch (err) { console.log(label, '→ DENIED:', String(err.message).replace(/\s+/g,' ').slice(0,200)); }
  await e.cleanup();
}
await attempt('WITH   rewind seasons', withS, { seasons: { enabled: true, currentNo: 3, currentId: 's3', count: 2, startedAt: 1 } });
await attempt('WITHOUT rewind seasons', without, { seasons: { enabled: true, currentNo: 3, currentId: 's3', count: 2, startedAt: 1 } });
await attempt('WITH   nested field seasons.currentNo', withS, { 'seasons.currentNo': 1 });
await attempt('WITHOUT nested field seasons.currentNo', without, { 'seasons.currentNo': 1 });
await attempt('WITH   identical seasons rewrite', withS, { seasons: { enabled: true, currentNo: 4, currentId: 's4', count: 3, startedAt: 1 } });
await attempt('WITH   description only', withS, { description: 'ok' });
