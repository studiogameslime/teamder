#!/usr/bin/env node
// Backfill the per-club pair rollup from the mini-game history we already hold.
//
//   node scripts/backfillClubPairs.mjs              # dry run
//   node scripts/backfillClubPairs.mjs --live       # writes
//   node scripts/backfillClubPairs.mjs --club <id>
//
// Only evenings that carry a FULL mini-game history are folded in. An evening
// without one is not "an evening where nobody played together" — it is an
// evening we cannot see, and counting it as zero would understate every pair
// who was there. The window that IS covered is recorded on the club so the pair
// card can say which date its numbers start from.
//
// Uses the same core as the Cloud Function (functions/lib/clubChemistry.js,
// generated from src/utils/clubChemistry.ts), so a backfilled pair and a live
// one cannot be counted differently.
import { execSync } from 'child_process';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { pairsFromRounds, mergePairs, pairMembers } = require('../functions/lib/clubChemistry.js');

const PROJECT = 'soccer-app-52b6b';
const FS = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const LIVE = process.argv.includes('--live');
const ci = process.argv.indexOf('--club');
const ONLY = ci > -1 ? process.argv[ci + 1] : null;

const token = execSync('gcloud auth print-access-token', { encoding: 'utf8' }).trim();
const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

const get = async (p) => {
  const r = await fetch(`${FS}/${p}`, { headers: H });
  return r.status === 404 ? null : r.json();
};
const runQuery = async (b) => {
  const r = await fetch(`${FS}:runQuery`, { method: 'POST', headers: H, body: JSON.stringify(b) });
  if (!r.ok) throw new Error(`runQuery ${r.status} ${await r.text()}`);
  return (await r.json()).filter((x) => x.document).map((x) => x.document);
};
const V = (f, k, d = null) => {
  const v = f?.[k];
  if (!v) return d;
  const kk = Object.keys(v)[0];
  if (kk === 'integerValue' || kk === 'doubleValue') return Number(v[kk]);
  if (kk === 'booleanValue') return v[kk];
  if (kk === 'nullValue') return null;
  if (kk === 'arrayValue') return v[kk].values ?? [];
  if (kk === 'mapValue') return v[kk].fields ?? {};
  return v[kk];
};
const num = (x) => ({ integerValue: String(x) });
const str = (x) => ({ stringValue: x });

async function commit(writes) {
  const r = await fetch(`${FS}:commit`, { method: 'POST', headers: H, body: JSON.stringify({ writes }) });
  if (!r.ok) throw new Error(`commit ${r.status} ${await r.text()}`);
}

async function club(groupId, name) {
  const games = await runQuery({
    structuredQuery: {
      from: [{ collectionId: 'games' }],
      where: { fieldFilter: { field: { fieldPath: 'groupId' }, op: 'EQUAL', value: str(groupId) } },
      orderBy: [{ field: { fieldPath: 'startsAt' }, direction: 'ASCENDING' }],
    },
  });
  let totals = {};
  let since = null;
  let usable = 0;
  let skipped = 0;
  const done = [];

  for (const g of games) {
    const gameId = g.name.split('/').pop();
    if (V(g.fields, 'status', '') !== 'finished') continue;
    const rh = (await get(`games/${gameId}/roundHistory?pageSize=80`))?.documents ?? [];
    if (rh.length === 0) { skipped += 1; continue; }
    // Already folded in by the live path — leave it alone.
    if (await get(`communityPairRollups/${groupId}__${gameId}`)) { skipped += 1; continue; }

    const at = V(g.fields, 'startsAt', 0) ?? 0;
    since = since === null ? at : Math.min(since, at);
    const rounds = rh
      .map((d) => d.fields)
      .sort((a, b) => (V(a, 'at', 0) ?? 0) - (V(b, 'at', 0) ?? 0))
      .map((r) => ({
        teamA: (V(r, 'teamA', []) ?? []).map((x) => x.stringValue).filter(Boolean),
        teamB: (V(r, 'teamB', []) ?? []).map((x) => x.stringValue).filter(Boolean),
        scoreA: V(r, 'scoreA', 0) ?? 0,
        scoreB: V(r, 'scoreB', 0) ?? 0,
        winnerSide: ['A', 'B'].includes(V(r, 'winnerSide')) ? V(r, 'winnerSide') : 'tie',
        goals: (V(r, 'goals', []) ?? []).map((gv) => {
          const gf = gv.mapValue.fields;
          return {
            scorerId: V(gf, 'scorerId'),
            assisterId: V(gf, 'assisterId'),
            ownGoal: V(gf, 'ownGoal', false) === true,
          };
        }),
      }));
    totals = mergePairs(totals, pairsFromRounds(rounds));
    usable += 1;
    done.push({ gameId, at, rounds: rounds.length });
  }

  const entries = Object.entries(totals);
  console.log(`\n── ${name}`);
  console.log(`   ${usable} evening(s) with a full history, ${skipped} without · ${entries.length} pair(s)`);
  for (const d of done) {
    console.log(`     ${new Date(d.at).toISOString().slice(0, 10)}  ${d.rounds} mini-games`);
  }
  if (!LIVE || entries.length === 0) return { name, usable, pairs: entries.length, wrote: 0 };

  const CHUNK = 400;
  for (let i = 0; i < entries.length; i += CHUNK) {
    const writes = entries.slice(i, i + CHUNK).map(([key, v]) => {
      const [a, b] = pairMembers(key);
      return {
        update: {
          name: `projects/${PROJECT}/databases/(default)/documents/communityPairStats/${groupId}__${key}`,
          fields: {
            groupId: str(groupId), a: str(a), b: str(b),
            sameTeam: num(v.sameTeam), winsTogether: num(v.winsTogether),
            lossesTogether: num(v.lossesTogether), cleanSheetsTogether: num(v.cleanSheetsTogether),
            against: num(v.against), winsA: num(v.winsA), winsB: num(v.winsB),
            assistsAToB: num(v.assistsAToB), assistsBToA: num(v.assistsBToA),
            updatedAt: num(Date.now()),
          },
        },
        updateMask: {
          fieldPaths: ['groupId','a','b','sameTeam','winsTogether','lossesTogether',
            'cleanSheetsTogether','against','winsA','winsB','assistsAToB','assistsBToA','updatedAt'],
        },
      };
    });
    await commit(writes);
  }
  // Markers, so the live path never re-adds an evening this script already folded in.
  for (let i = 0; i < done.length; i += CHUNK) {
    await commit(done.slice(i, i + CHUNK).map((d) => ({
      update: {
        name: `projects/${PROJECT}/databases/(default)/documents/communityPairRollups/${groupId}__${d.gameId}`,
        fields: { groupId: str(groupId), gameId: str(d.gameId), at: num(d.at),
                  pairs: num(entries.length), backfilledAt: num(Date.now()) },
      },
      updateMask: { fieldPaths: ['groupId','gameId','at','pairs','backfilledAt'] },
    })));
  }
  if (since !== null) {
    await commit([{
      update: {
        name: `projects/${PROJECT}/databases/(default)/documents/communityStats/${groupId}`,
        fields: { chemistrySince: num(since), updatedAt: num(Date.now()) },
      },
      updateMask: { fieldPaths: ['chemistrySince', 'updatedAt'] },
    }]);
  }
  console.log(`   wrote ${entries.length} pair(s); window opens ${new Date(since).toISOString().slice(0,10)}`);
  return { name, usable, pairs: entries.length, wrote: entries.length };
}

const clubs = ONLY
  ? [ONLY]
  : (await runQuery({ structuredQuery: { from: [{ collectionId: 'communityStats' }] } })).map((d) =>
      d.name.split('/').pop());

console.log(LIVE ? '⚠️  LIVE — writing' : 'dry run — nothing will be written');
const out = [];
for (const id of clubs) {
  const g = await get(`groups/${id}`);
  out.push(await club(id, g ? V(g.fields, 'name', id) : id));
}
console.log('\n════ summary');
for (const r of out) console.log(`  ${r.name}: ${r.usable} evening(s), ${r.pairs} pair(s), ${r.wrote} written`);
if (!LIVE) console.log('\nnothing was written — re-run with --live');
