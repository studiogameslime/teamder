// Actual lifecycle and sweep bodies, isolated from index.ts trigger registration.
// Only notification delivery/error reporting are substituted; all database work is real.
const {test,after,afterEach}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs');
const {createRequire}=require('node:module');
const requireFunctions=createRequire(require('node:path').resolve(__dirname,'../../functions/package.json'));
const ts=require('../../node_modules/typescript');
const PROJECT='demo-teamder-season-lifecycle',HOST='127.0.0.1:8185';
process.env.FIRESTORE_EMULATOR_HOST=HOST;
const admin=requireFunctions('firebase-admin');
const app=admin.initializeApp({projectId:PROJECT},'season-lifecycle-local');
const db=admin.firestore(app);db.settings({host:HOST,ssl:false});
assert.equal(db.projectId,PROJECT);
const source=fs.readFileSync(require('node:path').resolve(__dirname,'../../functions/src/index.ts'),'utf8');
const parsed=ts.createSourceFile('index.ts',source,ts.ScriptTarget.Latest,true);
const names=['archNum','TONIGHT_MS','REOPEN_GRACE_MS','PENDING_CLOSE_MS','STALE_SEAL_MS','STARTING_SOON_MS',
 'SEASON_SCAN_PAGE','MAX_CLOSES_PER_SWEEP','DUE_BLOCKED_STUCK_MS','rebaseCadence','currentPendingClose',
 'openPendingClose','clearPendingClose','clubIsQuiet','sealedEveningsOf','completedRoundsOf','addMonthsClampedServer',
 'performSeasonClose','closeSeasonIfRoundsTargetMet','runSeasonRollovers','requireClubAdmin','playedEveningsFromGames',
 'enableClubSeasons','disableClubSeasons'];
const selected=parsed.statements.filter(node=>{
 if(ts.isFunctionDeclaration(node))return names.includes(node.name?.text);
 return ts.isVariableStatement(node)&&node.declarationList.declarations.some(d=>names.includes(d.name.getText(parsed)));
});
assert.equal(selected.length,names.length,'All lifecycle dependencies must come from current source');
const code=ts.transpileModule(selected.map(n=>n.getText(parsed)).join('\n'),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText;
const DAY=86400000,clock={now:Date.now()},errors=[],announcements=[];
class LocalDate extends Date{static now(){return clock.now;}}
let failAnnouncement=false;
async function announceSeasonClosed(args){
 announcements.push(args);
 if(failAnnouncement){failAnnouncement=false;throw Error('injected notification failure');}
 await db.collection('seasonSummary').doc(args.groupId+'__'+args.seasonId).update({notificationPending:false});
}
const deps={db,admin,Date:LocalDate,exports:{},onCall:(_options,handler)=>handler,ENFORCE_APP_CHECK:false,HttpsError:requireFunctions('firebase-functions/v2/https').HttpsError,
 ...require('../../functions/lib/seasonCounters'),...require('../../functions/lib/seasonDates'),
 ...require('../../functions/lib/seasonActivation'),...require('../../functions/lib/eveningPlayed'),
 ...require('../../functions/lib/seasonOperation'),...require('../../functions/lib/seasonRollover'),
 ...require('../../functions/lib/seasonSeed'),
 announceSeasonClosed,reportServerError:async e=>{errors.push(e);}};
function harness(database=db){const values={...deps,db:database,exports:{}};return new Function(...Object.keys(values),code+'\nreturn {performSeasonClose,closeSeasonIfRoundsTargetMet,runSeasonRollovers,clubIsQuiet,enableClubSeasons:exports.enableClubSeasons,disableClubSeasons:exports.disableClubSeasons};')(...Object.values(values));}
const actual=harness();
const owned=[];let seq=0;
async function fixture(patch={}){
 const groupId='local-'+process.pid+'-'+String(++seq).padStart(4,'0'),ref=db.collection('groups').doc(groupId);
 owned.push(ref);
 const seasons={enabled:true,currentId:'s1',currentNo:1,count:0,startedAt:clock.now-30*DAY,roundsAtStart:7,playedRounds:5,
  cadence:{type:'rounds',targetRounds:5},targetHistory:[],pendingClose:{seasonId:'s1',dueAt:clock.now-DAY-1,closeAt:clock.now-1,reason:'rounds'},...patch};
 const uid='player-'+groupId,player=db.collection('communityPlayerStats').doc(groupId+'__'+uid);
 const archive=db.collection('seasonSummary').doc(groupId+'__'+seasons.currentId);
 const batch=db.batch();batch.set(ref,{name:'בדיקה מקומית',adminIds:['local-admin'],seasons});
 batch.set(player,{groupId,userId:uid,goals:10,games:5,rounds:6,eveningScoreSum:40,eveningScoreCount:5});
 batch.set(db.collection('communityStats').doc(groupId),{groupId,goals:10,rounds:6});
 batch.set(db.collection('clubRecords').doc(groupId),{eveningsSealed:12});await batch.commit();
 return {groupId,ref,player,archive,seasons,args:{groupId,groupName:'בדיקה מקומית',seasonId:seasons.currentId,seasonNo:seasons.currentNo,
  startedAt:seasons.startedAt,played:999,roundsAtStart:7,cadence:seasons.cadence,count:999,now:clock.now}};
}
afterEach(async()=>{const batch=db.batch();for(const ref of owned.splice(0))batch.update(ref,{'seasons.enabled':false});await batch.commit();failAnnouncement=false;clock.now=Date.now();errors.length=0;announcements.length=0;});
after(async()=>{await db.terminate();await app.delete();});
async function advanced(f,no=2,count=1){const sea=(await f.ref.get()).get('seasons');assert.equal(sea.currentId,'s'+no);assert.equal(sea.currentNo,no);assert.equal(sea.count,count);assert.equal(sea.roundsAtStart,12);assert.equal(sea.playedRounds,0);assert.equal(sea.operation,undefined);assert.equal(sea.pendingClose,undefined);assert.equal((await f.archive.get()).get('completedRounds'),5);assert.equal((await f.archive.get()).get('totals.goals'),10);assert.equal((await f.player.get()).get('goals'),0);}

test('outer close archives fresh counters, advances once and clears lifecycle state',async()=>{
 const f=await fixture({targetMovedToClose:{by:'local-admin',byName:'מנהל',at:clock.now},dueBlockedSince:clock.now-DAY});
 assert.equal(await actual.performSeasonClose(f.args),true);await advanced(f);
 assert.equal((await f.ref.get()).get('seasons.targetMovedToClose'),undefined);
 assert.equal((await f.ref.get()).get('seasons.dueBlockedSince'),undefined);
 assert.equal((await f.archive.get()).get('endedEarly'),true);
 assert.equal(await actual.performSeasonClose(f.args),false);await advanced(f);
});
for(const patch of [{enabled:false},{currentId:'s2'}])test('stale caller cannot close '+JSON.stringify(patch),async()=>{
 const f=await fixture();await f.ref.update(Object.fromEntries(Object.entries(patch).map(([k,v])=>['seasons.'+k,v])));
 assert.equal(await actual.performSeasonClose(f.args),false);assert.equal((await f.archive.get()).exists,false);assert.equal((await f.player.get()).get('goals'),10);
});
test('extended target clears a stale correction window without archiving',async()=>{
 const f=await fixture({cadence:{type:'rounds',targetRounds:10}});await actual.runSeasonRollovers();
 assert.equal((await f.ref.get()).get('seasons.pendingClose'),undefined);assert.equal((await f.archive.get()).exists,false);
});
test('seal opens exactly one 24-hour window; sweep waits then advances',async()=>{
 const f=await fixture({pendingClose:null});
 const seal=()=>actual.closeSeasonIfRoundsTargetMet(f.groupId,'local-seal',{name:'בדיקה',seasons:f.seasons,played:5});
 await seal();const initial=(await f.ref.get()).get('seasons.pendingClose');assert.equal(initial.closeAt-clock.now,DAY);
 clock.now+=3600000;await seal();assert.deepEqual((await f.ref.get()).get('seasons.pendingClose'),initial);
 await actual.runSeasonRollovers();assert.equal((await f.archive.get()).exists,false);
 clock.now=initial.closeAt+1;await actual.runSeasonRollovers();await advanced(f);
});
test('reopened season receives 48 hours before its correction window',async()=>{
 const f=await fixture({pendingClose:null,reopenedAt:clock.now});await actual.runSeasonRollovers();
 assert.equal((await f.ref.get()).get('seasons.pendingClose'),null);
 clock.now+=2*DAY+1;await actual.runSeasonRollovers();const window=(await f.ref.get()).get('seasons.pendingClose');assert.equal(window.closeAt-clock.now,DAY);
 clock.now+=DAY+1;await actual.runSeasonRollovers();await advanced(f);
});
test('active evening blocks closure and releasing it resumes the same pending window',async()=>{
 const f=await fixture(),game=db.collection('games').doc(f.groupId+'-game');
 await game.set({groupId:f.groupId,status:'active',startsAt:clock.now+60000});
 await actual.runSeasonRollovers();assert.equal((await f.archive.get()).exists,false);assert.equal((await f.ref.get()).get('seasons.dueBlockedSince'),clock.now);
 await game.update({status:'cancelled'});await actual.runSeasonRollovers();await advanced(f);
});
test('date cadence is rebased and the next sweep does not reopen a closing window',async()=>{
 const f=await fixture({cadence:{type:'date',months:3,endsAt:clock.now-DAY,endsOn:'2020-01-01'}});
 await actual.runSeasonRollovers();await advanced(f);const sea=(await f.ref.get()).get('seasons');
 assert.ok(sea.cadence.endsAt>clock.now);assert.equal(sea.cadence.startsOn,deps.todayIn(undefined,clock.now));assert.equal(sea.cadence.endsOn,deps.seasonEndDate(sea.cadence.startsOn,3));
 await actual.runSeasonRollovers();assert.equal((await f.ref.get()).get('seasons.pendingClose'),undefined);
});
test('fresh archive count wins over stale caller count',async()=>{
 const f=await fixture({currentId:'s8',currentNo:8,count:7,pendingClose:{seasonId:'s8',dueAt:clock.now-DAY-1,closeAt:clock.now-1,reason:'rounds'}});
 await actual.performSeasonClose(f.args);await advanced(f,9,8);
});
test('concurrent outer closes advance and subtract at most once',async()=>{
 const f=await fixture();const outcomes=await Promise.allSettled([actual.performSeasonClose(f.args),actual.performSeasonClose(f.args)]);
 assert.ok(outcomes.some(x=>x.status==='fulfilled'&&x.value===true));await advanced(f);
 for(const x of outcomes)if(x.status==='rejected')assert.match(String(x.reason),/season-operation/);
});
test('failure after archive and wipe resumes without duplicating count or subtraction',async()=>{
 const f=await fixture();let fail=true;
 const wrapped=new Proxy(db,{get(target,key){if(key==='runTransaction')return fn=>target.runTransaction(tx=>fn(new Proxy(tx,{get(t,k){if(k==='set')return (ref,data,...rest)=>{if(fail&&ref.path===f.ref.path&&data.seasons?.currentId==='s2'){fail=false;throw Error('injected lifecycle failure');}return t.set(ref,data,...rest);};const v=t[k];return typeof v==='function'?v.bind(t):v;}})));const v=target[key];return typeof v==='function'?v.bind(target):v;}});
 await assert.rejects(harness(wrapped).performSeasonClose(f.args),/injected lifecycle failure/);
 assert.equal((await f.archive.get()).get('totals.goals'),10);assert.equal((await f.player.get()).get('goals'),0);assert.equal((await f.ref.get()).get('seasons.operation.failed'),true);
 await actual.performSeasonClose(f.args);await advanced(f);await actual.runSeasonRollovers();assert.equal((await f.archive.get()).get('notificationPending'),false);
});
test('delivery failure keeps the completed lifecycle and retries its notification inbox',async()=>{
 const f=await fixture();failAnnouncement=true;
 await assert.rejects(actual.performSeasonClose(f.args),/injected notification failure/);
 await advanced(f);assert.equal((await f.archive.get()).get('notificationPending'),true);
 await actual.runSeasonRollovers();await advanced(f);assert.equal((await f.archive.get()).get('notificationPending'),false);
});
test('sweep closes at most five clubs and resumes the sixth on the next pass',async()=>{
 const fixtures=[];for(let i=0;i<6;i++)fixtures.push(await fixture());await actual.runSeasonRollovers();
 const first=await db.getAll(...fixtures.map(f=>f.ref));assert.equal(first.filter(x=>x.get('seasons.currentId')==='s2').length,5);
 await actual.runSeasonRollovers();for(const f of fixtures)await advanced(f);
});
test('scan cursor reaches a due club beyond its first 200 rows',async()=>{
 const batch=db.batch();for(let i=0;i<200;i++){const ref=db.collection('groups').doc('a-page-'+process.pid+'-'+String(i).padStart(3,'0'));owned.push(ref);batch.set(ref,{name:'מקומי',seasons:{enabled:true,currentId:'s1',playedRounds:0,cadence:{type:'rounds',targetRounds:99}}});}await batch.commit();
 const f=await fixture();await actual.runSeasonRollovers();await advanced(f);
});
test('a season below the two-evening minimum remains live even after its deadline',async()=>{
 const f=await fixture({playedRounds:1,cadence:{type:'rounds',targetRounds:1}});
 assert.equal(await actual.performSeasonClose(f.args),false);await actual.runSeasonRollovers();
 assert.equal((await f.archive.get()).exists,false);assert.equal((await f.player.get()).get('goals'),10);
 assert.equal((await f.ref.get()).get('seasons.currentId'),'s1');
});
test('recent played evening waits for its summary; an unplayed evening does not block',async()=>{
 const f=await fixture(),game=db.collection('games').doc(f.groupId+'-finished');
 await game.set({groupId:f.groupId,status:'finished',endedBy:'admin',startsAt:clock.now-60000});
 assert.deepEqual(await actual.clubIsQuiet(f.groupId),{ok:false,blocker:'unsealedGame'});
 await actual.runSeasonRollovers();assert.equal((await f.archive.get()).exists,false);
 await db.collection('roundSummaries').doc(game.id).set({localFixture:true});
 assert.deepEqual(await actual.clubIsQuiet(f.groupId),{ok:true});await actual.runSeasonRollovers();await advanced(f);
 const other=await fixture();await db.collection('games').doc(other.groupId+'-unplayed').set({groupId:other.groupId,status:'finished',endedBy:'auto',startsAt:clock.now});
 await actual.runSeasonRollovers();await advanced(other);
});
test('a blocker lasting 24 hours reports a fault without starving a healthy club',async()=>{
 const f=await fixture(),game=db.collection('games').doc(f.groupId+'-stuck');
 await game.set({groupId:f.groupId,status:'active',startsAt:clock.now});await actual.runSeasonRollovers();
 const since=(await f.ref.get()).get('seasons.dueBlockedSince');clock.now+=DAY+1;
 await game.update({startsAt:clock.now});const healthy=await fixture();await actual.runSeasonRollovers();
 assert.equal((await f.ref.get()).get('seasons.dueBlockedSince'),since);assert.equal((await f.archive.get()).exists,false);
 assert.ok(errors.some(e=>e.operation==='seasonRolloverBlocked'&&e.context.groupId===f.groupId));await advanced(healthy);
});
test('reactivation after a short first season preserves history separately and starts at zero',async()=>{
 const f=await fixture({playedRounds:1,pendingClose:null});
 const game=db.collection('games').doc(f.groupId+'-short');
 await game.set({groupId:f.groupId,status:'finished',endedBy:'admin',startsAt:clock.now-2*DAY,seasonId:'s1'});
 await actual.disableClubSeasons({auth:{uid:'local-admin'},data:{groupId:f.groupId}});
 const disabled=(await f.ref.get()).get('seasons');assert.equal(disabled.enabled,false);assert.equal(disabled.count,0);
 assert.equal((await f.player.get()).get('goals'),10);assert.equal((await f.archive.get()).exists,false);
 clock.now+=60000;
 // An older client may still ask to seal history: reactivation must not award it.
 await actual.enableClubSeasons({auth:{uid:'local-admin'},data:{groupId:f.groupId,cadenceType:'rounds',targetRounds:2,historyChoice:'sealNow'}});
 const sea=(await f.ref.get()).get('seasons');assert.equal(sea.enabled,true);assert.equal(sea.playedRounds,0);assert.equal(sea.count,0);assert.equal(sea.roundsAtStart,12);assert.equal(sea.hasArchivedPeriods,true);assert.equal(sea.operation,undefined);
 const period='off_0_'+disabled.disabledAt,archive=await db.collection('seasonSummary').doc(f.groupId+'__'+period).get();
 assert.equal(archive.get('nonSeason'),true);assert.equal(archive.get('completedRounds'),1);assert.equal(archive.get('totals.goals'),10);assert.equal(archive.get('notificationPending'),false);
 assert.equal((await f.player.get()).get('goals'),0);assert.equal((await game.get()).get('seasonId'),period);
 assert.deepEqual((await db.collection('seasonCards').doc(f.groupId+'__'+period).get()).get('winners'),[]);
});
test('first short reactivation combines the off-period without losing lifetime counters',async()=>{
 const f=await fixture({enabled:false,disabledAt:clock.now-DAY,playedRounds:1,pendingClose:null});
 const earlier=db.collection('games').doc(f.groupId+'-earlier'),later=db.collection('games').doc(f.groupId+'-later');
 await earlier.set({groupId:f.groupId,status:'finished',endedBy:'admin',startsAt:clock.now-3*DAY,seasonId:'s1'});
 await later.set({groupId:f.groupId,status:'finished',endedBy:'admin',startsAt:clock.now-2*DAY});
 const lifetime=db.collection('users').doc('local-user-'+f.groupId);await lifetime.set({stats:{goals:13}});
 await f.player.update({goals:13});await db.collection('communityStats').doc(f.groupId).update({goals:13});
 await actual.enableClubSeasons({auth:{uid:'local-admin'},data:{groupId:f.groupId,cadenceType:'rounds',targetRounds:2}});
 const period='off_0_'+f.seasons.disabledAt;
 const archive=await db.collection('seasonSummary').doc(f.groupId+'__'+period).get();
 assert.equal(archive.get('totals.goals'),13);assert.equal(archive.get('completedRounds'),2);assert.equal((await f.player.get()).get('goals'),0);
 assert.equal((await lifetime.get()).get('stats.goals'),13);assert.equal((await earlier.get()).get('seasonId'),period);assert.equal((await later.get()).get('seasonId'),period);
 assert.equal((await f.ref.get()).get('seasons.playedRounds'),0);
});
test('date reactivation ignores an old first-season end date and uses the new length',async()=>{
 const f=await fixture({enabled:false,disabledAt:clock.now-DAY,playedRounds:1,pendingClose:null});
 await actual.enableClubSeasons({auth:{uid:'local-admin'},data:{groupId:f.groupId,cadenceType:'date',months:3,season1EndsOn:'2020-01-01'}});
 const sea=(await f.ref.get()).get('seasons');assert.equal(sea.playedRounds,0);assert.equal(sea.cadence.startsOn,deps.todayIn(undefined,clock.now));assert.equal(sea.cadence.endsOn,deps.seasonEndDate(sea.cadence.startsOn,3));assert.ok(sea.cadence.endsAt>clock.now);
});
