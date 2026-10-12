// Audit probes: actual callable bodies + actual rollover, isolated Firestore only.
// Run from repository root after `npx tsc -p functions/tsconfig.json`.
// Requires local Firestore on 127.0.0.1:8080. Uses ONLY demo-seasons-audit.
// Seeds/deletes fixtures in that isolated emulator project; never use production.
const fs = require('fs');
const assert = require('node:assert/strict');
const { acquireSeasonOperation } = require('../../functions/lib/seasonOperation');
const vm = require('vm');
const ts = require('typescript');
const admin = require('../../functions/node_modules/firebase-admin');
const { closeSeason } = require('../../functions/lib/seasonRollover');
const { planActivation, MIN_SEASON_ROUNDS } = require('../../functions/lib/seasonActivation');
const dates = require('../../functions/lib/seasonDates');
const { seasonSeed } = require('../../functions/lib/seasonSeed');
const locks = require('../../functions/lib/seasonLock');
const {countPlayedEvenings,isSeasonDue,seasonFinishLine}=require('../../functions/lib/seasonCounters');
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
admin.initializeApp({ projectId: 'demo-seasons-audit' });
const db = admin.firestore();
const sourceText = fs.readFileSync('functions/src/index.ts', 'utf8');
const source = ts.createSourceFile('index.ts', sourceText, ts.ScriptTarget.Latest, true);
const results = [];
const gid = 'audit-club';
const ref = db.collection('groups').doc(gid);
const num = x => typeof x === 'number' && Number.isFinite(x) ? x : 0;
function callable(name, overrides={}) {
  let node;
  function visit(n) {
    if (ts.isVariableDeclaration(n) && n.name.getText(source) === name) node = n.initializer;
    if (ts.isFunctionDeclaration(n) && n.name?.text === name) node = n;
    ts.forEachChild(n, visit);
  }
  visit(source);
  const context = { module: { exports: {} }, console, db:{collection:db.collection.bind(db),getAll:db.getAll.bind(db),batch:db.batch.bind(db),runTransaction:fn=>db.runTransaction(tx=>Promise.resolve(fn(tx)))}, admin, Date,
    ENFORCE_APP_CHECK: false, onCall: (_, fn) => fn,
    HttpsError: class extends Error { constructor(code,msg) { super(msg); this.code=code; } },
    requireClubAdmin: async () => ({ref, group:(await ref.get()).data()}),
    completedRoundsOf: async (_, offset=0, played) => played ?? Math.max(0,30-offset),
    sealedEveningsOf: async () => 30,
    playedEveningsFromGames: async () => 8,
    isValidSeasonMonths: dates.isValidSeasonMonths, todayIn: dates.todayIn,
    seasonEndDate: dates.seasonEndDate, isCalendarDate: dates.isCalendarDate,
    addMonthsClampedServer: (n,m) => n+m*30*86400000,
    planActivation, MIN_SEASON_ROUNDS, seasonSeed, countPlayedEvenings, isSeasonDue, seasonFinishLine,
    acquireSeasonOperation, currentPendingClose: sea => sea?.pendingClose?.seasonId === sea?.currentId ? sea.pendingClose : null, closeSeason, rebaseCadence: c=>c,
    clubIsQuiet: async ()=>({ok:true}), announceSeasonClosed: async ()=>{}, archNum:num,
    ...overrides,
  };
  vm.runInNewContext(ts.transpileModule('module.exports = '+node.getText(source),{
    compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}
  }).outputText,context);
  return context.module.exports;
}
async function seed() {
  for (const collection of ['communityStats','communityPlayerStats','communityPairStats','seasonSummary','seasonCards','users','groups']) {
    const snap=await db.collection(collection).get();
    for(const d of snap.docs) await d.ref.delete();
  }
  await ref.set({name:'Audit',adminIds:['admin'],seasons:{enabled:false,count:1,currentNo:2,currentId:'s2',roundsAtStart:20,playedRounds:0}});
  await db.collection('users').doc('a').set({name:'A'});
  await db.collection('users').doc('b').set({name:'B'});
  for(const uid of ['a','b']) await db.collection('communityPlayerStats').doc(gid+'__'+uid).set({groupId:gid,userId:uid,goals:5,games:3,rounds:3});
  await db.collection('communityStats').doc(gid).set({goals:10,rounds:3});
  await db.collection('communityPairStats').doc(gid+'__a__b').set({groupId:gid,a:'a',b:'b',sameTeam:3,winsTogether:2});
}
async function main() {
  await seed();
  await callable('enableClubSeasons')({auth:{uid:'admin'},data:{groupId:gid,cadenceType:'rounds',targetRounds:10}});
  results.push({probe:'reactivation',seasons:(await ref.get()).data().seasons,
    playerGoals:(await db.collection('communityPlayerStats').doc(gid+'__a').get()).get('goals'),
    clubGoals:(await db.collection('communityStats').doc(gid).get()).get('goals'),
    pairSameTeam:(await db.collection('communityPairStats').doc(gid+'__a__b').get()).get('sameTeam')});
  const offPeriod = (await db.collection('seasonSummary').doc(gid+'__off_1_0').get()).data();
  assert.equal(offPeriod.players.a.goals,5);
  assert.equal(offPeriod.totals.goals,10);
  assert.equal(offPeriod.pairs.a__b.sameTeam,3);
  assert.equal(offPeriod.nonSeason,true);
  assert.equal((await db.collection('seasonCards').doc(gid+'__off_1_0').get()).get('winners').length,0);
  results.push({probe:'closedCorrectionWithFeatureOff',allowed:locks.seasonIsOpenForGame({seasons:{enabled:false,currentId:'s2',currentNo:2}},{seasonId:'s1'})});
  await seed();
  // Die after player A has been wound back but before B. B then receives 2 goals.
  const realTransaction = db.runTransaction.bind(db);
  let calls=0;
  db.runTransaction = async (...args) => { if(++calls===2) throw new Error('audit injected failure'); return realTransaction(...args); };
  const args={db,groupId:gid,seasonId:'s2',seasonNo:2,startsAt:1,completedRounds:3,now:Date.now()};
  try {await closeSeason(args);} catch(e) {if(!e.message.includes('audit injected')) throw e;}
  db.runTransaction=realTransaction;
  await db.collection('communityPlayerStats').doc(gid+'__b').update({goals:admin.firestore.FieldValue.increment(2)});
  await closeSeason(args);
  results.push({probe:'resumeWithUnwipedPlayerChange',archivedGoals:(await db.collection('seasonSummary').doc(gid+'__s2').get()).get('players').b.goals,
    expectedLiveGoals:2,actualLiveGoals:(await db.collection('communityPlayerStats').doc(gid+'__b').get()).get('goals')});
  // Quiet seal can still fail midway without requiring a new game.
  await seed();
  let failed=false;
  db.runTransaction=async (...args)=>{if(!failed){failed=true;throw new Error('audit failure before first wipe');}return realTransaction(...args);};
  try {await closeSeason(args);} catch(e) {if(!e.message.includes('audit failure'))throw e;}
  db.runTransaction=realTransaction;
  await closeSeason(args);
  results.push({probe:'ordinaryResume',archivedGoals:(await db.collection('seasonSummary').doc(gid+'__s2').get()).get('players').a.goals,
    actualLiveGoals:(await db.collection('communityPlayerStats').doc(gid+'__a').get()).get('goals')});
  await seed();
  await ref.update({seasons:{enabled:false,count:0}});
  await callable('enableClubSeasons',{completedRoundsOf:async()=>3,sealedEveningsOf:async()=>3})({auth:{uid:'admin'},data:{groupId:gid,cadenceType:'rounds',targetRounds:24,historyChoice:'sealNow'}});
  results.push({probe:'firstActivationSealHistory',realHistory:8,lateSealCounter:3,archivedCompletedRounds:(await db.collection('seasonSummary').doc(gid+'__s1').get()).get('completedRounds')});
  await seed();
  for(const collection of ['communityPlayerStats','communityPairStats','communityStats']) {
    const snap=await db.collection(collection).get(); for(const d of snap.docs) await d.ref.delete();
  }
  await ref.update({'seasons.enabled':true,'seasons.playedRounds':0});
  await callable('performSeasonClose')({groupId:gid,groupName:'Audit',seasonId:'s2',seasonNo:2,startedAt:1,played:0,roundsAtStart:30,cadence:{type:'date',months:1},count:1,now:Date.now()});
  results.push({probe:'scheduledCloseWithoutRounds',archiveCreated:(await db.collection('seasonSummary').doc(gid+'__s2').get()).exists,count:(await ref.get()).get('seasons').count});
  const batch=db.batch();
  for(let i=0;i<205;i++)batch.set(db.collection('games').doc('history-'+i),{groupId:gid,status:'finished',endedBy:'admin',startsAt:i+1});
  await batch.commit();
  results.push({probe:'historyOver200',realHistory:205,returned:await callable('playedEveningsFromGames')(gid)});
  await assert.rejects(() => callable('playedEveningsFromGames',{db:{collection:()=>{throw new Error('injected unavailable');}}})(gid), /injected unavailable/);
  results.push({probe:'failedHistoryRead', rejected:true});
  await ref.update({'seasons.currentId':'s3'});
  await assert.rejects(() => callable('openPendingClose',{PENDING_CLOSE_MS:86400000})(gid,'s2','rounds',100), /stale/);
  const stale=(await ref.get()).get('seasons');
  results.push({probe:'staleCorrectionWindow',currentId:stale.currentId,pendingSeasonId:stale.pendingClose?.seasonId ?? null});
  await ref.update({'seasons.playedRounds':3,'seasons.cadence':{type:'rounds',targetRounds:14}});
  await assert.rejects(() => callable('openPendingClose',{PENDING_CLOSE_MS:86400000})(gid,'s3','rounds',100), /stale/);
  assert.equal((await ref.get()).get('seasons.pendingClose'),undefined);
  await ref.update({'seasons.cadence':{type:'rounds',targetRounds:3}});
  const firstWindow=await callable('openPendingClose',{PENDING_CLOSE_MS:86400000})(gid,'s3','rounds',100);
  const sameWindow=await callable('openPendingClose',{PENDING_CLOSE_MS:86400000})(gid,'s3','rounds',200);
  assert.equal(sameWindow.closeAt,firstWindow.closeAt);
  const advanced=await callable('performSeasonClose')({groupId:gid,seasonId:'s3',seasonNo:3,now:200});
  assert.equal(advanced,false);
  assert.equal((await db.collection('seasonSummary').doc(gid+'__s3').get()).exists,false);
  results.push({probe:'freshWindowRevalidation',notDueRefused:true,originalDeadlinePreserved:true,earlyCloseRefused:true});
  const result = name => results.find(x=>x.probe===name);
  assert.equal(result('reactivation').playerGoals,0);
  assert.equal(result('reactivation').clubGoals,0);
  assert.equal(result('reactivation').pairSameTeam,0);
  const off = await db.collection('seasonSummary').doc(gid+'__off_1_0').get();
  // Later seeds clear the fixture archives; lifetime retention is checked immediately in the scenario below.
  assert.equal(result('closedCorrectionWithFeatureOff').allowed,false);
  assert.equal(result('resumeWithUnwipedPlayerChange').actualLiveGoals,2);
  assert.equal(result('ordinaryResume').actualLiveGoals,0);
  assert.equal(result('firstActivationSealHistory').archivedCompletedRounds,8);
  assert.equal(result('scheduledCloseWithoutRounds').archiveCreated,false);
  assert.equal(result('historyOver200').returned,205);
  assert.equal(result('staleCorrectionWindow').pendingSeasonId,null);
  console.log(JSON.stringify(results,null,2));
  fs.writeFileSync('artifacts/seasons-audit-2026-10-11/probe-results.json',JSON.stringify(results,null,2));
}
main().finally(()=>admin.app().delete()).catch(e=>{console.error(e);process.exitCode=1;});
