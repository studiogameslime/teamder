#!/usr/bin/env node
// Compare team-balance models on a real roster and real history.
//
//   node scripts/simulateTeamBalance.mjs
//
// Compiles the current core (and the pre-variety algorithm, pulled from git) to
// JS, then plays out many simulated seasons: each week the model produces a
// split, that split becomes history for the next week, and everything the
// product cares about is measured — how fair the teams were, how much of last
// week got rebuilt, and whether the same little cliques keep reappearing.
//
// Models:
//   old — the shipped algorithm: balance only, no memory between nights.
//   A   — one continuous score: progressive balance penalty + repeat weight.
//   B   — balance as a pure constraint, then fewest repeats wins.

import { execSync } from 'child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OLD_REF = process.env.OLD_REF ?? '697b992';
const work = mkdtempSync(join(tmpdir(), 'balance-sim-'));

// ── build: current core + the old algorithm from git ──────────────────────
// Tunables can be overridden per run so the constants can be swept without
// editing the shipped source: FINALISTS=10 node scripts/simulateTeamBalance.mjs
let coreSrc = readFileSync(join(ROOT, 'src/utils/teamBalanceCore.ts'), 'utf8');
for (const knob of [
  'FINALISTS',
  'SELECT_MAX_TRADE',
  'SEARCH_JITTER',
  'CANDIDATES',
  'REPEAT_SCALE_PER_PAIR',
]) {
  const v = process.env[knob];
  if (v === undefined) continue;
  const re = new RegExp(`(const ${knob} = )[0-9.]+;`);
  if (!re.test(coreSrc)) throw new Error(`knob not found: ${knob}`);
  coreSrc = coreSrc.replace(re, `$1${v};`);
  console.log(`[sweep] ${knob} = ${v}`);
}
writeFileSync(join(work, 'core.ts'), coreSrc);
const oldSrc = execSync(`git -C ${ROOT} show ${OLD_REF}:src/utils/draft.ts`, {
  encoding: 'utf8',
  maxBuffer: 1 << 24,
})
  // The old file imports app types purely for annotations; strip the import and
  // the annotations that need it so it compiles standalone.
  .replace(/^import type .*$/m, '')
  .replace(/: DraftTeamsResult\b/g, '')
  .replace(/: GameFormat\b/g, ': string')
  .replace(/: UserId\b/g, ': string');
writeFileSync(join(work, 'old.ts'), oldSrc);
execSync(
  `npx tsc ${join(work, 'core.ts')} ${join(work, 'old.ts')} --outDir ${work} --target es2020 --module commonjs --skipLibCheck --noEmitOnError false`,
  { cwd: ROOT, stdio: 'pipe' },
);
const core = await import(join(work, 'core.js'));
const old = await import(join(work, 'old.js'));

// ── the real roster (כדורגל אנשים טובים, 12.08) ───────────────────────────
const REAL = {
  name: 'real roster (15, one 1.0 outlier)',
  ratings: [4.5, 4, 3.6, 3.2, 4, 3.3, 3, 3.5, 3.2, 4.3, 2.7, 3.4, 3, 4, 1],
  numTeams: 3,
  perTeam: 5,
};
// The same club without the extreme guest, so the measurements aren't dominated
// by the one arithmetic constraint that pins a strong core to the 1.0 player.
const EVEN = {
  name: 'even roster (15, no outlier)',
  ratings: [4.5, 4, 3.6, 3.2, 4, 3.3, 3, 3.5, 3.2, 4.3, 2.7, 3.4, 3, 4, 3.1],
  numTeams: 3,
  perTeam: 5,
};

const ids = (n) => Array.from({ length: n }, (_, i) => `p${i}`);
const ratingMap = (rs) => Object.fromEntries(rs.map((r, i) => [`p${i}`, r]));

// ── metrics ───────────────────────────────────────────────────────────────
const key = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const pairsOf = (teams) => {
  const out = [];
  for (const t of teams)
    for (let i = 0; i < t.length; i++)
      for (let j = i + 1; j < t.length; j++) out.push(key(t[i], t[j]));
  return out;
};
const triplesOf = (teams) => {
  const out = [];
  for (const t of teams) {
    const s = [...t].sort();
    for (let i = 0; i < s.length; i++)
      for (let j = i + 1; j < s.length; j++)
        for (let k = j + 1; k < s.length; k++)
          out.push(`${s[i]}|${s[j]}|${s[k]}`);
  }
  return out;
};
const teamKeys = (teams) => teams.map((t) => [...t].sort().join(','));
const overlap = (a, b) => a.filter((x) => b.includes(x)).length;

function gapOf(teams, rates) {
  const avgs = teams.map(
    (t) => t.reduce((s, id) => s + rates[id], 0) / t.length,
  );
  return Math.max(...avgs) - Math.min(...avgs);
}

// ── models ────────────────────────────────────────────────────────────────
function runModel(model, roster, weeks, rng) {
  const playerIds = ids(roster.ratings.length);
  const ratings = ratingMap(roster.ratings);
  const rates = Object.fromEntries(
    playerIds.map((id) => [id, core.normalizeRating(ratings[id])]),
  );

  let history = [];
  const m = {
    gaps: [],
    zones: { A: 0, B: 0, C: 0, over: 0 },
    repeatedFromLastWeek: [],
    repeatWeights: [],
    pairCounts: {},
    tripleCounts: {},
    teamCounts: {},
    fourOfFive: 0,
    identicalTeams: 0,
    ms: 0,
  };

  let prev = null;
  for (let week = 0; week < weeks; week++) {
    const t0 = process.hrtime.bigint();
    let teams;
    if (model === 'old') {
      teams = old
        .balanceTeams({
          playerIds,
          ratings,
          numTeams: roster.numTeams,
          format: '5v5',
          createdBy: 'sim',
        })
        .result.teams.map((t) => t.playerIds);
    } else {
      teams = core.balanceCore({
        playerIds,
        ratings,
        numTeams: roster.numTeams,
        perTeam: roster.perTeam,
        pairWeights: history.length
          ? core.buildPairRepeatWeights(history)
          : undefined,
        strategy: model,
        rng,
      }).teams;
    }
    m.ms += Number(process.hrtime.bigint() - t0) / 1e6;

    const gap = gapOf(teams, rates);
    m.gaps.push(gap);
    if (gap <= 0.1) m.zones.A += 1;
    else if (gap <= 0.15) m.zones.B += 1;
    else if (gap <= 0.2 + 1e-9) m.zones.C += 1;
    else m.zones.over += 1;

    const ps = pairsOf(teams);
    for (const p of ps) m.pairCounts[p] = (m.pairCounts[p] ?? 0) + 1;
    for (const t of triplesOf(teams))
      m.tripleCounts[t] = (m.tripleCounts[t] ?? 0) + 1;
    for (const t of teamKeys(teams))
      m.teamCounts[t] = (m.teamCounts[t] ?? 0) + 1;

    if (prev) {
      const prevPairs = new Set(pairsOf(prev));
      m.repeatedFromLastWeek.push(ps.filter((p) => prevPairs.has(p)).length);
      for (const t of teams) {
        for (const pt of prev) {
          const o = overlap(t, pt);
          if (o >= 4 && t.length === pt.length) m.fourOfFive += 1;
          if (o === t.length && t.length === pt.length) m.identicalTeams += 1;
        }
      }
      // How much history weight this split carried, on the shared scale.
      const w = core.buildPairRepeatWeights(history);
      m.repeatWeights.push(ps.reduce((s, p) => s + (w[p] ?? 0), 0));
    }

    history = [{ startsAt: week, teams }, ...history].slice(
      0,
      core.HISTORY_GAMES,
    );
    prev = teams;
  }
  return m;
}

const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
const pct = (n, d) => `${((100 * n) / d).toFixed(0)}%`;
const f2 = (x) => x.toFixed(2);

function report(roster, weeks, seasons) {
  console.log(`\n${'═'.repeat(78)}\n${roster.name} — ${weeks} weeks × ${seasons} seasons\n${'═'.repeat(78)}`);
  const rows = [];
  for (const model of ['old', 'A', 'B']) {
    const agg = {
      gaps: [],
      zones: { A: 0, B: 0, C: 0, over: 0 },
      rep: [],
      repW: [],
      pairSpread: [],
      triples: [],
      four: 0,
      identical: 0,
      ms: 0,
      weeks: 0,
    };
    for (let s = 0; s < seasons; s++) {
      const m = runModel(model, roster, weeks, Math.random);
      agg.gaps.push(...m.gaps);
      for (const z of ['A', 'B', 'C', 'over']) agg.zones[z] += m.zones[z];
      agg.rep.push(...m.repeatedFromLastWeek);
      agg.repW.push(...m.repeatWeights);
      agg.pairSpread.push(Object.keys(m.pairCounts).length);
      // Triples seen 3+ times in one season = a clique that keeps reforming.
      agg.triples.push(
        Object.values(m.tripleCounts).filter((c) => c >= 3).length,
      );
      agg.four += m.fourOfFive;
      agg.identical += m.identicalTeams;
      agg.ms += m.ms;
      agg.weeks += weeks;
    }
    rows.push({ model, agg });
  }

  const pad = (s, n) => String(s).padEnd(n);
  const padL = (s, n) => String(s).padStart(n);
  console.log(
    pad('model', 7) +
      padL('gap avg', 9) +
      padL('gap max', 9) +
      padL('A/B/C/>', 18) +
      padL('rep pairs', 11) +
      padL('rep score', 11) +
      padL('pairs/season', 14) +
      padL('cliques', 9) +
      padL('4of5', 7) +
      padL('same team', 11) +
      padL('ms/split', 10),
  );
  for (const { model, agg } of rows) {
    const total = agg.weeks;
    console.log(
      pad(model, 7) +
        padL(f2(mean(agg.gaps)), 9) +
        padL(f2(Math.max(...agg.gaps)), 9) +
        padL(
          `${pct(agg.zones.A, total)}/${pct(agg.zones.B, total)}/${pct(agg.zones.C, total)}/${pct(agg.zones.over, total)}`,
          18,
        ) +
        padL(`${f2(mean(agg.rep))}/30`, 11) +
        padL(f2(mean(agg.repW)), 11) +
        padL(f2(mean(agg.pairSpread)) + '/105', 14) +
        padL(f2(mean(agg.triples)), 9) +
        padL(agg.four, 7) +
        padL(agg.identical, 11) +
        padL(f2(agg.ms / total), 10),
    );
  }
  console.log(
    '\n  rep pairs  = pairs rebuilt from last week (of 30)\n' +
      '  rep score  = history weight the split carried (lower = fresher)\n' +
      '  pairs/season = distinct pairings formed (of 105 possible)\n' +
      '  cliques    = triples that reformed 3+ times in a season\n' +
      '  4of5       = teams sharing 4 of 5 players with a team from last week\n' +
      '  same team  = fully identical 5-player teams week to week',
  );
}

// Variety between presses in the SAME week (the "regenerate" button).
function pressVariety(roster, history, model) {
  const playerIds = ids(roster.ratings.length);
  const ratings = ratingMap(roster.ratings);
  const seen = new Set();
  const gaps = [];
  for (let i = 0; i < 40; i++) {
    let teams;
    if (model === 'old') {
      teams = old
        .balanceTeams({
          playerIds,
          ratings,
          numTeams: roster.numTeams,
          format: '5v5',
          createdBy: 'sim',
        })
        .result.teams.map((t) => t.playerIds);
    } else {
      const r = core.balanceCore({
        playerIds,
        ratings,
        numTeams: roster.numTeams,
        perTeam: roster.perTeam,
        pairWeights: history.length
          ? core.buildPairRepeatWeights(history)
          : undefined,
        strategy: model,
      });
      teams = r.teams;
      gaps.push(r.gap);
    }
    seen.add(teamKeys(teams).sort().join('|'));
  }
  return { distinct: seen.size, gaps };
}

const WEEKS = Number(process.env.WEEKS ?? 12);
const SEASONS = Number(process.env.SEASONS ?? 25);
report(REAL, WEEKS, SEASONS);
report(EVEN, WEEKS, SEASONS);

console.log(`\n${'═'.repeat(78)}\nvariety between presses in one week (40 presses)\n${'═'.repeat(78)}`);
for (const roster of [REAL, EVEN]) {
  const playerIds = ids(roster.ratings.length);
  const lastWeek = {
    startsAt: 1,
    teams: [playerIds.slice(0, 5), playerIds.slice(5, 10), playerIds.slice(10)],
  };
  const line = ['old', 'A', 'B']
    .map((m) => `${m}: ${pressVariety(roster, [lastWeek], m).distinct}/40`)
    .join('   ');
  console.log(`${roster.name.padEnd(34)} ${line}`);
}
