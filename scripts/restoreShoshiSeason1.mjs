// Undo scripts/migrateShoshiSeason1.mjs from its backup.
//
//   node scripts/restoreShoshiSeason1.mjs <backup-file>            # dry run
//   node scripts/restoreShoshiSeason1.mjs <backup-file> --apply    # writes
//
// The migration DELETES six seasonTitles documents, and a deleted document is
// recoverable from nowhere else — PITR is off on this project. So the backup
// is not a convenience, it is the entire recovery plan, and this script exists
// to prove the plan is executable rather than merely described.
//
// It restores by RE-CREATING everything the backup holds, including documents
// the migration deleted, and by writing the archive and card back field for
// field. One atomic commit, same as the migration.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = 'soccer-app-52b6b';
const APPLY = process.argv.includes('--apply');
const file = process.argv[2];
if (!file || file.startsWith('--')) {
  console.error('usage: node scripts/restoreShoshiSeason1.mjs <backup-file> [--apply]');
  process.exit(1);
}
const full = path.isAbsolute(file) ? file : path.join(HERE, '..', 'backups', file);
const B = JSON.parse(fs.readFileSync(full, 'utf8'));
if (!B.seasonSummary || !B.seasonTitles) throw new Error('backup is not the expected shape');

const TOKEN = execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8' }).trim();
const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)`;
const docPath = (p) => `projects/${PROJECT}/databases/(default)/documents/${p}`;

function F(x) {
  if (x === null || x === undefined) return { nullValue: null };
  if (typeof x === 'string') return { stringValue: x };
  if (typeof x === 'boolean') return { booleanValue: x };
  if (typeof x === 'number')
    return Number.isInteger(x) ? { integerValue: String(x) } : { doubleValue: x };
  if (Array.isArray(x)) return { arrayValue: { values: x.map(F) } };
  const fields = {};
  for (const [k, v] of Object.entries(x)) fields[k] = F(v);
  return { mapValue: { fields } };
}

const writes = [];
writes.push({
  update: {
    name: docPath(`seasonSummary/${B.groupId}__${B.seasonId}`),
    fields: F(B.seasonSummary).mapValue.fields,
  },
});
if (B.seasonCards) {
  writes.push({
    update: {
      name: docPath(`seasonCards/${B.groupId}__${B.seasonId}`),
      fields: F(B.seasonCards).mapValue.fields,
    },
  });
}
// Every title the backup holds is re-created, including the six the migration
// removed. Any title the migration ADDED and the backup does not hold is
// deleted, or the restore would leave the cabinet with one trophy too many.
const inBackup = new Set(Object.keys(B.seasonTitles));
for (const [key, body] of Object.entries(B.seasonTitles)) {
  const [uid, docId] = key.split('/');
  writes.push({
    update: { name: docPath(`users/${uid}/seasonTitles/${docId}`), fields: F(body).mapValue.fields },
  });
}
const uids = new Set([...inBackup].map((k) => k.split('/')[0]));
const KEYS = ['topScorer','topAssister','mvp','topWinner','mostLoyal','cleanSheetKing','penaltyKing','penaltyKeeper','deadlyDuo'];
const toDelete = [];
for (const uid of uids) {
  for (const k of KEYS) {
    const id = `${B.groupId}__${B.seasonId}__${k}`;
    if (!inBackup.has(`${uid}/${id}`)) toDelete.push({ uid, id });
  }
}

console.log('');
console.log(`  ${APPLY ? 'RESTORE' : 'DRY RUN'} from ${path.basename(full)}  (taken ${B.takenAt})`);
console.log(`    archive + card restored field for field`);
console.log(`    ${Object.keys(B.seasonTitles).length} seasonTitles re-created (including any the migration deleted)`);
console.log(`    ${toDelete.length} titles present now but absent from the backup would be removed`);
if (!APPLY) {
  console.log('\n  Dry run. Nothing was written.\n');
  process.exit(0);
}
// Only remove a title that exists now and is not in the backup — checked at
// restore time rather than assumed, so a restore run twice is harmless.
for (const d of toDelete) {
  const r = await fetch(`${BASE}/documents/users/${d.uid}/seasonTitles/${d.id}`, { headers: H });
  if (r.ok) writes.push({ delete: docPath(`users/${d.uid}/seasonTitles/${d.id}`) });
}
const res = await fetch(`${BASE}/documents:commit`, {
  method: 'POST', headers: H, body: JSON.stringify({ writes }),
});
if (!res.ok) throw new Error(`restore commit failed ${res.status}: ${(await res.text()).slice(0, 300)}`);
console.log(`  restored ${writes.length} documents atomically.\n`);
