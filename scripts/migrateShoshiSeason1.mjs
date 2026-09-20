// Migrate מועדון שכחת שושי, season 1, to the award rules of 20.09.2026.
//
//   node scripts/migrateShoshiSeason1.mjs            # dry run, writes nothing
//   node scripts/migrateShoshiSeason1.mjs --apply    # writes, after a backup
//
// SCOPE, deliberately narrow. This script exists to correct three titles that
// were decided under rules that have since changed, and the rating input one
// of them was computed from. It touches nothing else:
//
//   • it does NOT change goals, assists, wins, clean sheets, penalties or
//     attendance — those were collected in full and are correct;
//   • it does NOT change any lifetime counter, achievement or streak;
//   • it does NOT fix any other historical defect. Several are known and none
//     of them is in scope here.
//
// Idempotent. Every write is derived from the archive as it stands plus the
// reconstructed ratings, so running it twice produces the same documents; the
// second run reports "no change" rather than compounding anything.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = 'soccer-app-52b6b';
const GID = 'HhzIwmjMl1i5HSOGHt3p';
const SID = 's1';
const APPLY = process.argv.includes('--apply');
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

const token = () =>
  execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8' }).trim();
const TOKEN = token();
const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

async function get(p) {
  const r = await fetch(`${BASE}/${p}`, { headers: H });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GET ${p} → ${r.status}`);
  return r.json();
}

/** Firestore REST value → plain JS. */
function V(v) {
  if (v == null) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) return (v.arrayValue.values ?? []).map(V);
  if ('mapValue' in v) {
    const o = {};
    for (const [k, x] of Object.entries(v.mapValue.fields ?? {})) o[k] = V(x);
    return o;
  }
  return null;
}
/** plain JS → Firestore REST value. */
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


// ── The award rules, imported from the code that runs them ──────────────
//
// NOT restated here. The whole point of the dry run is that its answer is the
// one the app would give, and a second copy of the rules is a second set of
// answers. `functions/src/seasonAwards.ts` is the server's copy and is pinned
// byte-identical to the client's by tests/logic/seasonAwardsMirror.
const { computeSeasonAwards, SEASON_TITLE_KEYS } = await import(
  pathToFileURL(path.join(HERE, '..', 'functions', 'lib', 'seasonAwards.js')).href
).catch(async () => {
  throw new Error(
    'functions/lib/seasonAwards.js not built — run `npm --prefix functions run build` first',
  );
});

// ── Read everything, write nothing yet ──────────────────────────────────

const archDoc = await get(`seasonSummary/${GID}__${SID}`);
if (!archDoc) throw new Error('no archive for that season');
const A = Object.fromEntries(Object.entries(archDoc.fields).map(([k, v]) => [k, V(v)]));

const cardDoc = await get(`seasonCards/${GID}__${SID}`);
const CARD = cardDoc
  ? Object.fromEntries(Object.entries(cardDoc.fields).map(([k, v]) => [k, V(v)]))
  : null;

// Reconstructed real ratings, per player, from the evidence file the dry run
// already produced and the report was written from. Read rather than
// recomputed so the migration cannot silently disagree with the report that
// was approved.
const EV = JSON.parse(
  fs.readFileSync(path.join(HERE, '..', 'tests', 'fixtures', 'shoshiSeason1.json'), 'utf8'),
);
if (EV.groupId !== GID || EV.seasonId !== SID) throw new Error('evidence is for another season');

const num = (x) => (typeof x === 'number' ? x : 0);
const ROUNDS = num(A.completedRounds);

const rows = Object.entries(A.players).map(([uid, r]) => {
  const real = EV.realRatings[uid];
  return {
    uid,
    games: num(r.games),
    rounds: num(r.rounds),
    goals: num(r.goals),
    assists: num(r.assists),
    wins: num(r.wins),
    cleanSheets: num(r.cleanSheets),
    // THE one input this migration corrects: the mean over evenings that were
    // really rated, instead of over attendances including the 6.0 sentinel.
    mvpAvg: real && real.count > 0 ? real.sum / real.count : 0,
    penTaken: num(r.penTaken),
    penScored: num(r.penScored),
    penFaced: num(r.penFaced),
    penSaved: num(r.penSaved),
  };
});
const pairs = Object.values(A.pairs ?? {}).map((p) => ({
  a: String(p.a),
  b: String(p.b),
  score: num(p.assistsAToB) + num(p.assistsBToA),
  together: num(p.sameTeam),
}));

const fresh = computeSeasonAwards(rows, pairs, ROUNDS);

// ── Work out the document changes ───────────────────────────────────────

const titleDocs = (awards) => {
  const out = new Map();
  for (const key of SEASON_TITLE_KEYS) {
    const a = awards[key];
    if (!a) continue;
    for (const w of a.winners) {
      for (const uid of String(w).split('__')) {
        if (!uid || uid.startsWith('guest:')) continue;
        out.set(`${uid}|${key}`, { uid, key, value: a.value });
      }
    }
  }
  return out;
};
const before = titleDocs(A.awards ?? {});
const after = titleDocs(fresh);

const creates = [...after.values()].filter((d) => !before.has(`${d.uid}|${d.key}`));
const deletes = [...before.values()].filter((d) => !after.has(`${d.uid}|${d.key}`));
const updates = [...after.values()].filter((d) => {
  const b = before.get(`${d.uid}|${d.key}`);
  return b && b.value !== d.value;
});

// The MVP's coverage: how many evenings its average is really built from.
//
// ⚠️ NOT `partialData`. That flag marks the WHOLE season as partial and would
// put "נתונים חלקיים" beside goals, assists, wins and attendance, every one of
// which was collected in full. Only the rating is short, and only the rating
// says so.
const mvpUid = fresh.mvp?.winners?.[0];
const mvpCoverage = mvpUid
  ? { rated: EV.realRatings[mvpUid]?.count ?? 0, of: ROUNDS }
  : null;

// The per-player rating counters, corrected to the evenings really rated.
const ratingFixes = Object.keys(A.players).map((uid) => {
  const real = EV.realRatings[uid] ?? { sum: 0, count: 0 };
  const cur = A.players[uid];
  return {
    uid,
    name: String(cur.displayName ?? uid.slice(0, 8)),
    from: { sum: num(cur.eveningScoreSum), count: num(cur.eveningScoreCount) },
    to: { sum: Number(real.sum.toFixed(4)), count: real.count },
  };
});

const nameOf = (u) => String(A.players[u]?.displayName ?? u.slice(0, 8));
const show = (a) => (!a ? '— not awarded' : `${a.winners.map(nameOf).join(' + ')} (${a.value})`);

console.log('');
console.log('═'.repeat(76));
console.log(`  ${APPLY ? 'APPLY' : 'DRY RUN'} · מועדון שכחת שושי · season 1 · ${ROUNDS} evenings`);
console.log('═'.repeat(76));
console.log('');
console.log('  TITLE              BEFORE                          →  AFTER');
console.log('  ' + '─'.repeat(72));
for (const key of SEASON_TITLE_KEYS) {
  const b = show(A.awards?.[key]);
  const a = show(fresh[key]);
  console.log(`  ${key.padEnd(16)} ${b.padEnd(30).slice(0, 30)} ${b === a ? '   ' : ' ≠ '} ${a}`);
}
console.log('');
console.log(`  seasonTitles documents:  +${creates.length} created  ~${updates.length} updated  −${deletes.length} deleted`);
for (const d of deletes) console.log(`    DELETE  ${nameOf(d.uid).padEnd(16)} ${d.key.padEnd(15)} was ${d.value}`);
for (const d of creates) console.log(`    CREATE  ${nameOf(d.uid).padEnd(16)} ${d.key.padEnd(15)} → ${d.value}`);
for (const d of updates) {
  const b = before.get(`${d.uid}|${d.key}`);
  console.log(`    UPDATE  ${nameOf(d.uid).padEnd(16)} ${d.key.padEnd(15)} ${b.value} → ${Number(d.value.toFixed(3))}`);
}
console.log('');
console.log('  rating counters (eveningScoreSum / eveningScoreCount):');
for (const f of ratingFixes) {
  console.log(
    `    ${f.name.padEnd(16)} ${String(f.from.sum).padStart(7)}/${String(f.from.count).padEnd(3)}` +
      ` → ${String(f.to.sum).padStart(7)}/${f.to.count}`,
  );
}
console.log('');
console.log(`  MVP coverage marker: ${mvpCoverage ? `${nameOf(mvpUid)} rated on ${mvpCoverage.rated} of ${mvpCoverage.of} evenings` : 'n/a'}`);
console.log('  partialData flag:    NOT set — goals, assists, wins and attendance are complete');
console.log('═'.repeat(76));

if (!APPLY) {
  console.log('\n  Dry run. Nothing was written.\n');
  process.exit(0);
}

// ── APPLY ───────────────────────────────────────────────────────────────
//
// Everything below runs only under --apply.

// 1) BACK UP FIRST, and refuse to write if the backup fails.
//
// The backup is the whole recovery plan: six seasonTitles documents are
// DELETED by this migration, and a deleted document cannot be recovered from
// anywhere else — Firestore PITR is off on this project. If the backup cannot
// be written, there is no way back and the migration must not start.
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupDir = path.join(HERE, '..', 'backups');
const backupFile = path.join(backupDir, `shoshi-s1-${stamp}.json`);

const affectedUids = new Set([...before.values(), ...after.values()].map((d) => d.uid));
const titleBackup = {};
for (const uid of affectedUids) {
  for (const key of SEASON_TITLE_KEYS) {
    const id = `${GID}__${SID}__${key}`;
    const doc = await get(`users/${uid}/seasonTitles/${id}`);
    if (doc) {
      titleBackup[`${uid}/${id}`] = Object.fromEntries(
        Object.entries(doc.fields).map(([k, v]) => [k, V(v)]),
      );
    }
  }
}

const backup = {
  takenAt: new Date().toISOString(),
  groupId: GID,
  seasonId: SID,
  note: 'Pre-migration snapshot. scripts/restoreShoshiSeason1.mjs writes it back.',
  seasonSummary: A,
  seasonCards: CARD,
  seasonTitles: titleBackup,
};
fs.mkdirSync(backupDir, { recursive: true });
fs.writeFileSync(backupFile, JSON.stringify(backup, null, 1));
const readBack = JSON.parse(fs.readFileSync(backupFile, 'utf8'));
if (
  !readBack.seasonSummary?.players ||
  Object.keys(readBack.seasonTitles).length !== Object.keys(titleBackup).length
) {
  throw new Error('backup did not read back intact — refusing to write');
}
console.log(`  backup written and verified: ${backupFile}`);
console.log(`    ${Object.keys(titleBackup).length} seasonTitles documents, the archive and the card`);

// 2) ONE atomic commit.
//
// A partial failure here is the outcome with no good recovery: a fresh archive
// beside a stale trophy cabinet, with each player's profile disagreeing with
// the hall of fame. Firestore's :commit applies every write or none.
const writes = [];
const docPath = (p) => `projects/${PROJECT}/databases/(default)/documents/${p}`;

// 2a) the archive: awards, the corrected rating counters, and nothing else.
const nextPlayers = { ...A.players };
for (const f of ratingFixes) {
  nextPlayers[f.uid] = {
    ...nextPlayers[f.uid],
    eveningScoreSum: f.to.sum,
    eveningScoreCount: f.to.count,
  };
}
// The coverage note rides on the MVP award as well as on the card: the hall of
// fame reads `seasonCards.winners` and the personal summary reads
// `seasonSummary.awards`, and a note on one and not the other is worse than
// none. Same shape `closeSeason` now writes for future seasons.
const freshWithCoverage =
  mvpCoverage && fresh.mvp
    ? { ...fresh, mvp: { ...fresh.mvp, coverage: mvpCoverage } }
    : fresh;
writes.push({
  update: {
    name: docPath(`seasonSummary/${GID}__${SID}`),
    fields: { awards: F(freshWithCoverage), players: F(nextPlayers) },
  },
  updateMask: { fieldPaths: ['awards', 'players'] },
});

// 2b) the card's winners, plus the MVP's coverage marker.
//
// `partialData` is deliberately NOT set: it marks the whole season partial and
// would put "נתונים חלקיים" beside goals, assists, wins and attendance, all of
// which were collected in full. Only the rating is short of the season, and
// only the rating carries the note.
if (CARD) {
  const nextWinners = [];
  for (const key of SEASON_TITLE_KEYS) {
    const a = fresh[key];
    if (!a) continue;
    const row = {
      key,
      names: a.winners.map((w) => String(w).split('__').map(nameOf).join(' + ')),
      value: a.value,
    };
    if (key === 'mvp' && mvpCoverage) row.coverage = mvpCoverage;
    nextWinners.push(row);
  }
  writes.push({
    update: { name: docPath(`seasonCards/${GID}__${SID}`), fields: { winners: F(nextWinners) } },
    updateMask: { fieldPaths: ['winners'] },
  });
}

// 2c) the trophy cabinets.
const titleBody = (d) => ({
  groupId: GID,
  groupName: String(A.groupName ?? ''),
  seasonId: SID,
  seasonNo: num(A.no),
  titleKey: d.key,
  value: d.value,
  at: num(A.closedAt),
});
for (const d of [...creates, ...updates]) {
  writes.push({
    update: {
      name: docPath(`users/${d.uid}/seasonTitles/${GID}__${SID}__${d.key}`),
      fields: F(titleBody(d)).mapValue.fields,
    },
  });
}
for (const d of deletes) {
  writes.push({ delete: docPath(`users/${d.uid}/seasonTitles/${GID}__${SID}__${d.key}`) });
}

console.log(`  committing ${writes.length} writes atomically…`);
const res = await fetch(`${BASE.replace(/\/documents$/, '')}/documents:commit`, {
  method: 'POST',
  headers: H,
  body: JSON.stringify({ writes }),
});
if (!res.ok) {
  throw new Error(`commit failed ${res.status}: ${(await res.text()).slice(0, 400)}`);
}
console.log('  committed.');
console.log('');
console.log('  Verify by re-running this script with no flag: a second dry run');
console.log('  over the migrated data must report +0 ~0 −0, which is both the');
console.log('  proof it landed and the proof it is idempotent.');
console.log(`  To undo: node scripts/restoreShoshiSeason1.mjs ${path.basename(backupFile)}`);
console.log('');
