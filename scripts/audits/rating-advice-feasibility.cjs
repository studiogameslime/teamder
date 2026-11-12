// Offline design audit only. No network, credentials, production writes or app imports.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
const sourceDir = path.join(root, 'artifacts/score-proposal-2026-11-04');
const files = ['dynamic-ten-round-source-2026-11-06.json', 'latest-accepted-score-source-2026-11-06.json'];
const [prior, latest] = files.map(f => JSON.parse(fs.readFileSync(path.join(sourceDir, f), 'utf8')));
const rounds = [...prior.priorTenGames.map(game => ({game, history: prior.history[game.id]})), {game: latest.game, history: latest.history}];
const players = new Map();
let invalid = 0, matches = 0, guests = 0, ratedMatches = 0, penalties = 0;
const coverage = [];
const excludedMatches = [];
for (const {game, history} of rounds) {
  let valid = 0;
  for (const match of history) {
    const a = match.teamA, b = match.teamB;
    if (!Array.isArray(a) || !Array.isArray(b) || !a.length || a.length !== b.length ||
      new Set([...a, ...b]).size !== a.length + b.length ||
      !['A', 'B', 'tie'].includes(match.winnerSide)) {
      invalid++;
      excludedMatches.push({gameId:game.id,roundId:match.roundId,reason:Array.isArray(a)&&Array.isArray(b)&&a.length!==b.length?'unequal_team_sizes':'invalid_roster_or_result',sizeA:a?.length??null,sizeB:b?.length??null});
      continue;
    }
    valid++; matches++;
    if ([...a,...b].some(id => id.startsWith('guest:'))) guests++;
    if (match.penalties?.length) penalties++;
    // Proposed field. Absence is not a neutral rating or proof of equal teams.
    if ([...a,...b].every(id => Number.isFinite(match.ratingSnapshot?.[id]) && match.ratingSnapshot[id] > 0 && match.ratingSnapshot[id] <= 5)) ratedMatches++;
    for (const [side, ids] of [['A',a],['B',b]]) for (const uid of ids) {
      if (uid.startsWith('guest:')) continue;
      if (!players.has(uid)) players.set(uid, {uid, name:latest.names[uid] ?? null, nights:new Map()});
      const p = players.get(uid);
      if (!p.nights.has(game.id)) p.nights.set(game.id, {gameId:game.id, at:game.startsAt, played:0, wins:0, ties:0, rosters:new Set()});
      const night = p.nights.get(game.id);
      night.played++;
      night.wins += Number(match.winnerSide === side);
      night.ties += Number(match.winnerSide === 'tie');
      night.rosters.add(ids.filter(id=>id!==uid).sort().join('|'));
    }
  }
  coverage.push({gameId:game.id,date:new Date(game.startsAt).toISOString().slice(0,10),history:history.length,valid,committedCount:game.committedRoundCount??null});
}
const observedAt = latest.game.startsAt;
const cutoff = observedAt - 120*86400000;
const rows = [...players.values()].map(p => {
  const nights = [...p.nights.values()].filter(n=>n.at>=cutoff).sort((a,b)=>b.at-a.at).slice(0,10);
  const played = nights.reduce((s,n)=>s+n.played,0), wins = nights.reduce((s,n)=>s+n.wins,0), ties = nights.reduce((s,n)=>s+n.ties,0);
  return {uid:p.uid,name:p.name,nights:nights.length,played,wins,ties,losses:played-wins-ties,
    actualResultMean:nights.reduce((s,n)=>s+(n.wins+.5*n.ties)/n.played,0)/nights.length,
    distinctTeammateSets:new Set(nights.flatMap(n=>[...n.rosters])).size,
    enoughAppearances:nights.length>=6, recommendation:null,reason:'historical_ratings_missing'};
}).sort((a,b)=>b.nights-a.nights||a.uid.localeCompare(b.uid));
// Deliberately hypothetical formula, not fitted to these production snapshots.
const expectation = gap => 1/(1+Math.exp(-gap));
function demonstration({team, personal, nights=6, fresh=6, comparable=true, varied=true, rating=3.5}) {
  if (!comparable || !varied || nights<6 || fresh<6) return 'insufficient';
  if (team>=.10 && personal>=.75 && rating<5) return 'up';
  if (team<=-.10 && personal<=-.75 && rating>.1) return 'down';
  return 'observe';
}
const cases = [
  {name:'both_up',team:.15,personal:.9,expected:'up'},
  {name:'both_down',team:-.15,personal:-.9,expected:'down'},
  {name:'conflicting',team:.15,personal:-.9,expected:'observe'},
  {name:'personal_neutral',team:.15,personal:.2,expected:'observe'},
  {name:'too_few_nights',team:.15,personal:.9,nights:5,expected:'insufficient'},
  {name:'three_after_change',team:.15,personal:.9,fresh:3,expected:'insufficient'},
  {name:'missing_ratings',team:.15,personal:.9,comparable:false,expected:'insufficient'},
  {name:'same_teammates',team:.15,personal:.9,varied:false,expected:'insufficient'},
  {name:'rating_ceiling',team:.15,personal:.9,rating:5,expected:'observe'},
];
for (const c of cases) assert.equal(demonstration(c),c.expected,c.name);
assert.equal(expectation(0),.5);
assert.ok(Math.abs(expectation(.4)+expectation(-.4)-1)<1e-12);
assert.equal(rows.every(p=>p.recommendation===null),true);
const report = {mode:'offline-feasibility-not-player-recommendations',sourceCapturedOn:'2026-11-06',
  sourceHashes:Object.fromEntries(files.map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(path.join(sourceDir,f))).digest('hex')])),
  historicalAsOf:new Date(observedAt).toISOString(),windowDays:120,maximumNights:10,
  totals:{nights:rounds.length,matches,invalid,guestMatches:guests,shootoutMatches:penalties,ratedMatches,players:rows.length,playersWithSixNights:rows.filter(r=>r.enoughAppearances).length},
  coverage,excludedMatches,players:rows,synthetic:{parametersUncalibrated:true,expectationAtEqualStrength:expectation(0),expectationAtGap04:expectation(.4),cases:cases.map(c=>({...c,actual:demonstration(c)})),assertionsPassed:12},
  limitations:['Saved historical snapshot, not a current production query.','No per-player historical ratings, rating revision history or comparable-rating cohorts.','Raw result means are descriptive; they do not identify individual impact.','Three new appearances are insufficient if six fresh appearances are required.']};
const output = path.join(root,'artifacts/rating-advice-feasibility-2026-11-11');
fs.mkdirSync(output,{recursive:true});
fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({totals:report.totals,examples:rows.filter(r=>/איתי|Eliran/.test(r.name??'')),synthetic:report.synthetic},null,2));
