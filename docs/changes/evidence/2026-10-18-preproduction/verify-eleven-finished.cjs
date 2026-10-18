// Current pure client/server reducers over the final scoped production source.
const fs = require('fs'), path = require('path'), vm = require('vm'), ts = require('typescript'), assert = require('assert/strict'), crypto = require('crypto');
const sourcePath = path.join(__dirname, 'data-eleven-finished.json'), snapshot = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
const receiptPath = fs.existsSync(path.join(__dirname, '..', 'identities.json')) ? path.join(__dirname, '..', 'identities.json') : path.join(__dirname, 'identities.json');
const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
const row = snapshot.games.find(item => item.game.id === receipt.roundIds[2]), uid = receipt.accountId;
function pure(file) {
  const output = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, output);
  return output.exports;
}
const clean = value => JSON.parse(JSON.stringify(value));
const { correctionBasis, ...storedSummary } = row.roundSummary.fields;
assert.deepEqual(clean(pure('src/utils/roundSummary.ts').buildRoundSummary(correctionBasis)), storedSummary);
assert.deepEqual(clean(pure('functions/src/roundSummary.ts').buildRoundSummary(correctionBasis)), storedSummary);
const qa = row.playerStats.find(item => item.fields.userId === uid).fields;
const standing = row.finishProof.qaEveningStanding.fields;
const calibration = row.finishProof.stages.find(item => item.id === 'standings').fields.scoreCalibration;
const input = { goals: qa.goals ?? 0, assists: qa.assists ?? 0, wins: qa.wins ?? 0, gamesPlayed: qa.rounds,
  ...calibration, pen: { scored: qa.penScored ?? 0, saved: qa.penSaved ?? 0, missed: qa.penMissed ?? 0, conceded: qa.penConceded ?? 0 } };
const clientScore = pure('src/utils/eveningScore.ts').eveningScore(input);
const serverScore = pure('functions/src/eveningScoreCore.ts').eveningScoreServer(input.goals, input.assists, input.wins, input.gamesPlayed, input.goalsFor10, input.assistsFor10, input.pen);
assert.equal(clientScore, 8.4); assert.equal(serverScore, 8.4); assert.equal(standing.score, clientScore);
assert.equal(standing.scoreDelta, Math.round((clientScore - standing.scoreBasis.previousScore) * 10) / 10);
const modules = ['src/utils/roundSummary.ts', 'functions/src/roundSummary.ts', 'src/utils/eveningScore.ts', 'functions/src/eveningScoreCore.ts'];
const result = { source: path.basename(sourcePath), sourceSha256: crypto.createHash('sha256').update(fs.readFileSync(sourcePath)).digest('hex'),
  moduleHashes: Object.fromEntries(modules.map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')])),
  fullSealedClientSummaryMatches: true, fullSealedServerSummaryMatches: true, sealedStats: storedSummary.stats,
  scoreInput: input, clientScore, serverScore, storedScore: standing.score, storedScoreDelta: standing.scoreDelta,
  historicalInvalidRoundSize: { round: 2, sides: [12, 11], retained: true },
  proof: 'Pure calculations over saved server correctionBasis and gamePlayerStats. The invalid second-game lineup remains included; parity does not validate that lineup.' };
fs.writeFileSync(path.join(__dirname, 'eleven-finished-derived.json'), JSON.stringify(result, null, 2) + '\n');
process.stdout.write(JSON.stringify({ fullSummaryMatches: true, clientScore, serverScore, sourceSha256: result.sourceSha256 }));
