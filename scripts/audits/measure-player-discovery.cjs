// Run against a local Firestore emulator after compiling functions/tsconfig.json.
// Fixtures live in their own demo namespace. No authentication accounts are created.
'use strict';
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { createRequire } = require('node:module');
const fs = require('node:fs');
const path = require('node:path');
const projectId = 'demo-teamder-discovery-audit';
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = projectId;
process.env.FIREBASE_CONFIG = JSON.stringify({ projectId });
const load = createRequire(path.resolve(__dirname, '../../functions/package.json'));
const admin = load('firebase-admin');
admin.initializeApp({ projectId });
const db = admin.firestore();
const { searchSocialPlayers, getSocialPlayerProfile } = load('./lib/socialPlayers');
const viewer = '000-viewer';
const auth = { uid: viewer, token: { firebase: { sign_in_provider: 'password' } } };
const early = 'p001', late = 'p395';
async function seed() {
  const batch = db.batch();
  batch.set(db.doc('users/' + viewer), { name: 'צופה', friends: [late] });
  for (let i = 1; i < 400; i++) {
    const id = 'p' + String(i).padStart(3, '0');
    const name = id === early ? 'שחקן ראשון' : id === late ? 'שחקן אחרון' : 'שחקן ' + i;
    batch.set(db.doc('users/' + id), { name, friends: id === late ? [viewer] : [] });
  }
  for (let i = 0; i < 4; i++) {
    batch.set(db.doc('groups/g' + i), { name: 'מועדון ' + i, playerIds: [viewer, late] });
  }
  for (let i = 0; i < 60; i++) {
    batch.set(db.doc('games/g' + i), { startsAt: i + 1, status: 'finished', participantIds: [viewer, late], players: [viewer, late] });
  }
  await batch.commit();
}
async function search(data, expectedId, expectedPages) {
  let cursor = null, pages = 0;
  const examined = new Set();
  do {
    const result = await searchSocialPlayers.run({ auth, data: { ...data, cursor } });
    pages++;
    if (result.players.length) {
      assert(expectedId && result.players.some(p => p.id === expectedId));
      assert.equal(pages, expectedPages);
      return { pages, rows: result.players.length };
    }
    cursor = result.cursor;
    assert(!cursor || !examined.has(cursor));
    examined.add(cursor);
  } while (cursor);
  assert.equal(expectedId, null);
  assert.equal(pages, expectedPages);
  return { pages, rows: 0 };
}
async function profile(id, statistics) {
  const result = await getSocialPlayerProfile.run({ auth, data: { userId: id } });
  assert.equal(result.canSeeStatistics, statistics);
  return { sharedRounds: result.player.sharedRounds };
}
const cases = [
  ['open', () => search({}, early, 1)],
  ['earlyName', () => search({ text: 'ראשון' }, early, 1)],
  ['lateName', () => search({ text: 'אחרון' }, late, 10)],
  ['absent', () => search({ text: 'בלתי קיים' }, null, 11)],
  ['friendsOnly', () => search({ friendsOnly: true }, late, 10)],
  ['privateStatistics', () => profile(early, false)],
  ['friendStatistics', () => profile(late, true)],
];
async function main() {
  await seed();
  const records = [];
  // One unmeasured warm-up pass. Rotate the order across measured passes.
  for (let pass = -1; pass < 7; pass++) {
    // Each pass models an independent minute, so the test itself cannot consume
    // another pass's 90-page allowance. Never touch another project's counters.
    await db.doc('serverRateLimits/' + viewer + '_social_search').set({ start: 0, count: 0 });
    const order = cases.slice();
    if (pass >= 0) order.push(...order.splice(0, pass % cases.length));
    for (const [name, fn] of order) {
      const start = performance.now();
      const result = await fn();
      if (pass >= 0) records.push({ pass, name, ...result, ms: Math.round(performance.now() - start) });
    }
  }
  const output = path.resolve(__dirname, '../../artifacts/discovery-audit-2026-11-04');
  fs.mkdirSync(output, { recursive: true });
  const summary = cases.map(([name]) => {
    const rows = records.filter(row => row.name === name);
    const times = rows.map(row => row.ms).sort((a, b) => a - b);
    return { name, pages: rows[0].pages, medianMs: times[3], minMs: times[0], maxMs: times[6] };
  });
  fs.writeFileSync(path.join(output, 'measurements.json'), JSON.stringify({ projectId, accounts: 400, clubs: 4, rounds: 60, summary, records }, null, 2));
  console.table(summary);
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => admin.app().delete());
