#!/usr/bin/env node
// Backfill "סיכום המחזור" for evenings that finished before the feature existed.
//
//   node scripts/backfillRoundSummaries.mjs            # dry run, prints only
//   node scripts/backfillRoundSummaries.mjs --live     # writes
//   node scripts/backfillRoundSummaries.mjs --club <groupId>
//
// WHY A REPLAY, NOT A RECOMPUTE. Whether an evening set a club record depends
// entirely on what the club had done BEFORE it — and that is not a thing you
// can look up today, because every later evening has since moved the bar. So
// the only correct backfill walks the club's history in order, carrying the
// record baseline and each player's best evening forward exactly as the live
// path does. Anything else would hand the oldest evening the newest records to
// beat and quietly announce nothing.
//
// It uses the SAME core the Cloud Function uses (functions/lib/roundSummary.js,
// itself generated from src/utils/roundSummary.ts), so a backfilled summary and
// a live one cannot disagree.
//
// It never overwrites: an evening that already carries a sealed summary is
// skipped, because that summary was written against a history this script can
// no longer see.
import { readFileSync } from 'fs';
import { execSync } from 'child_process';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { buildRoundSummary, nextRecordBaseline } = require('../functions/lib/roundSummary.js');

const PROJECT = 'soccer-app-52b6b';
const FS = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const LIVE = process.argv.includes('--live');
const clubArg = process.argv.indexOf('--club');
const ONLY_CLUB = clubArg > -1 ? process.argv[clubArg + 1] : null;

const token = execSync('gcloud auth print-access-token', { encoding: 'utf8' }).trim();
const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

async function get(path) {
  const r = await fetch(`${FS}/${path}`, { headers: H });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GET ${path} → ${r.status}`);
  return r.json();
}
async function runQuery(body) {
  const r = await fetch(`${FS}:runQuery`, { method: 'POST', headers: H, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`runQuery → ${r.status} ${await r.text()}`);
  return (await r.json()).filter((x) => x.document).map((x) => x.document);
}
async function patch(path, fields, mask) {
  const q = mask.map((m) => `updateMask.fieldPaths=${m}`).join('&');
  const r = await fetch(`${FS}/${path}?${q}`, { method: 'PATCH', headers: H, body: JSON.stringify({ fields }) });
  if (!r.ok) throw new Error(`PATCH ${path} → ${r.status} ${await r.text()}`);
}
async function createDoc(collection, id, fields) {
  const r = await fetch(`${FS}/${collection}?documentId=${id}`, {
    method: 'POST', headers: H, body: JSON.stringify({ fields }),
  });
  if (!r.ok) throw new Error(`CREATE ${collection}/${id} → ${r.status} ${await r.text()}`);
}

// ── Firestore's REST value encoding, both directions ──────────────────────
const V = (f, k, d = null) => {
  const v = f?.[k];
  if (!v) return d;
  const kk = Object.keys(v)[0];
  if (kk === 'integerValue') return Number(v[kk]);
  if (kk === 'doubleValue') return Number(v[kk]);
  if (kk === 'booleanValue') return v[kk];
  if (kk === 'nullValue') return null;
  if (kk === 'arrayValue') return v[kk].values ?? [];
  if (kk === 'mapValue') return v[kk].fields ?? {};
  return v[kk];
};
function toValue(x) {
  if (x === null || x === undefined) return { nullValue: null };
  if (typeof x === 'boolean') return { booleanValue: x };
  if (typeof x === 'number')
    return Number.isInteger(x) ? { integerValue: String(x) } : { doubleValue: x };
  if (typeof x === 'string') return { stringValue: x };
  if (Array.isArray(x)) return { arrayValue: { values: x.map(toValue) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(x).map(([k, v]) => [k, toValue(v)])) } };
}

async function evenings(groupId) {
  const games = await runQuery({
    structuredQuery: {
      from: [{ collectionId: 'games' }],
      where: { fieldFilter: { field: { fieldPath: 'groupId' }, op: 'EQUAL', value: { stringValue: groupId } } },
      orderBy: [{ field: { fieldPath: 'startsAt' }, direction: 'ASCENDING' }],
    },
  });
  const out = [];
  for (const g of games) {
    const gameId = g.name.split('/').pop();
    if (V(g.fields, 'status', '') !== 'finished') continue;
    const ps = await runQuery({
      structuredQuery: {
        from: [{ collectionId: 'gamePlayerStats' }],
        where: { fieldFilter: { field: { fieldPath: 'gameId' }, op: 'EQUAL', value: { stringValue: gameId } } },
      },
    });
    const players = ps
      .map((d) => ({
        userId: V(d.fields, 'userId', ''),
        isGuest: V(d.fields, 'isGuest', false) === true,
        goals: V(d.fields, 'goals', 0) ?? 0,
        assists: V(d.fields, 'assists', 0) ?? 0,
        wins: V(d.fields, 'wins', 0) ?? 0,
        cleanSheets: V(d.fields, 'cleanSheets', 0) ?? 0,
        rounds: V(d.fields, 'rounds', 0) ?? 0,
      }))
      .filter((p) => p.userId);
    const rh = (await get(`games/${gameId}/roundHistory?pageSize=80`))?.documents ?? [];
    const rounds = rh
      .map((d) => d.fields)
      .sort((a, b) => (V(a, 'at', 0) ?? 0) - (V(b, 'at', 0) ?? 0))
      .map((r) => ({
        teamAIndex: V(r, 'teamAIndex', -1) ?? -1,
        teamBIndex: V(r, 'teamBIndex', -1) ?? -1,
        winnerSide: ['A', 'B'].includes(V(r, 'winnerSide')) ? V(r, 'winnerSide') : 'tie',
        goals: (V(r, 'goals', []) ?? []).map((gv) => {
          const gf = gv.mapValue.fields;
          return {
            scorerId: V(gf, 'scorerId'),
            assisterId: V(gf, 'assisterId'),
            ownGoal: V(gf, 'ownGoal', false) === true,
            team: V(gf, 'team', 'A'),
          };
        }),
        shootout: (V(r, 'penalties', []) ?? []).length > 0,
      }));
    const st = await runQuery({
      structuredQuery: {
        from: [{ collectionId: 'eveningStandings' }],
        where: { fieldFilter: { field: { fieldPath: 'gameId' }, op: 'EQUAL', value: { stringValue: gameId } } },
      },
    });
    out.push({
      gameId,
      at: V(g.fields, 'startsAt', 0) ?? 0,
      players,
      rounds,
      standings: st.map((d) => ({
        userId: V(d.fields, 'userId', ''),
        score: V(d.fields, 'score', 0) ?? 0,
        rank: V(d.fields, 'rank'),
        rankTotal: V(d.fields, 'rankTotal'),
        rankDelta: V(d.fields, 'rankDelta'),
      })),
    });
  }
  return out;
}

async function backfillClub(groupId, name) {
  const list = await evenings(groupId);
  if (list.length === 0) return { groupId, name, sealed: 0, skipped: 0, total: 0 };

  let records = null;
  const bests = {};
  const career = new Map();
  const club = { goals: 0, assists: 0, rounds: 0, cleanSheets: 0, shootoutRounds: 0, evenings: 0 };
  let sealed = 0;
  let written = 0;
  let skipped = 0;
  console.log(`\n── ${name} (${groupId}) — ${list.length} finished evening(s)`);

  for (const e of list) {
    for (const p of e.players) {
      const c = career.get(p.userId) ?? {
        userId: p.userId, goals: 0, assists: 0, rounds: 0, wins: 0, cleanSheets: 0, games: 0,
      };
      c.goals += p.goals; c.assists += p.assists; c.rounds += p.rounds;
      c.wins += p.wins; c.cleanSheets += p.cleanSheets; c.games += 1;
      career.set(p.userId, c);
      club.goals += p.goals; club.assists += p.assists; club.cleanSheets += p.cleanSheets;
    }
    club.rounds += e.rounds.length;
    club.shootoutRounds += e.rounds.filter((r) => r.shootout).length;
    club.evenings += 1;

    const summary = buildRoundSummary({
      gameId: e.gameId,
      groupId,
      at: e.at,
      players: e.players,
      rounds: e.rounds,
      career: Array.from(career.values()),
      club: { ...club },
      records,
      personalBests: JSON.parse(JSON.stringify(bests)),
      standings: e.standings,
      basis: { since: list[0].at, eveningsCompared: sealed },
      now: Date.now(),
    });

    const date = new Date(e.at).toISOString().slice(0, 10);
    // An evening with no goals, no assists and no mini-game history has nothing
    // to say. Sealing it anyway would put a button on the match screen that
    // opens an empty card — worse than the button leading to "no summary for
    // this evening", which is at least true. It still goes through the replay:
    // it counts as an evening attended, and skipping it there would shift every
    // later milestone by one.
    const empty =
      summary.stats.goals === 0 &&
      summary.stats.assists === 0 &&
      summary.stats.rounds === 0;
    const exists = empty ? null : await get(`roundSummaries/${e.gameId}`);
    if (empty) {
      skipped += 1;
      console.log(`  ${date}  skip (nothing recorded)`);
    } else if (exists) {
      // Already sealed — by the live path, against a history this script can no
      // longer reconstruct. Leave it exactly as it is.
      skipped += 1;
      console.log(`  ${date}  skip (already sealed)`);
    } else {
      const line =
        `${summary.stats.rounds} mini-games · ${summary.stats.goals}g · ` +
        `${summary.stats.assists}a · ${summary.stats.shootouts} shootouts → ` +
        `${summary.events.length} event(s)`;
      console.log(`  ${date}  ${line}`);
      if (LIVE) {
        await createDoc('roundSummaries', e.gameId, toValue({ ...summary, backfilled: true }).mapValue.fields);
        written += 1;
      }
    }

    records = nextRecordBaseline(records, summary, e.players);
    for (const p of e.players) {
      if (p.isGuest) continue;
      const prev = bests[p.userId] ?? {};
      bests[p.userId] = {
        goals: Math.max(prev.goals ?? 0, p.goals),
        assists: Math.max(prev.assists ?? 0, p.assists),
        involvement: Math.max(prev.involvement ?? 0, p.goals + p.assists),
        cleanSheets: Math.max(prev.cleanSheets ?? 0, p.cleanSheets),
        wins: Math.max(prev.wins ?? 0, p.wins),
      };
    }
    sealed += 1;
  }

  if (LIVE) {
    // The baseline the NEXT live evening will be measured against, plus each
    // player's high-water mark. Written last, for the same reason the live path
    // writes it last.
    await patch(
      `clubRecords/${groupId}`,
      toValue({
        groupId,
        ...records,
        eveningsSealed: sealed,
        since: list[0].at,
        updatedAt: Date.now(),
        backfilledAt: Date.now(),
      }).mapValue.fields,
      ['groupId', 'goals', 'assists', 'involvement', 'cleanSheets', 'wins',
       'firstEverSeen', 'eveningsSealed', 'since', 'updatedAt', 'backfilledAt'],
    );
    for (const [uid, be] of Object.entries(bests)) {
      await patch(
        `communityPlayerStats/${groupId}__${uid}`,
        toValue({ bestEvening: be }).mapValue.fields,
        ['bestEvening'],
      );
    }
  }
  return { groupId, name, sealed: written, skipped, total: list.length };
}

const clubs = ONLY_CLUB
  ? [{ id: ONLY_CLUB, name: ONLY_CLUB }]
  : (await runQuery({ structuredQuery: { from: [{ collectionId: 'communityStats' }] } })).map((d) => ({
      id: d.name.split('/').pop(),
      name: d.name.split('/').pop(),
    }));

console.log(LIVE ? '⚠️  LIVE — writing' : 'dry run — nothing will be written');
const results = [];
for (const c of clubs) {
  const g = await get(`groups/${c.id}`);
  const name = g ? V(g.fields, 'name', c.id) : c.id;
  results.push(await backfillClub(c.id, name));
}
console.log('\n════ summary');
for (const r of results) {
  console.log(`  ${r.name}: ${r.total} evening(s), ${r.sealed} written, ${r.skipped} skipped`);
}
if (!LIVE) console.log('\nnothing was written — re-run with --live');
