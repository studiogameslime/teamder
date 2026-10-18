// Real callable bodies + their real context/season guards, unwrapped from
// HTTP transport. Only a hard-bound loopback demo Firestore receives writes.
const {test,after}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),ts=require('typescript');
const PROJECT='demo-teamder-night-audit',HOST='127.0.0.1:8185';
process.env.FIRESTORE_EMULATOR_HOST=HOST;
const admin=require('../../functions/node_modules/firebase-admin');
const app=admin.initializeApp({projectId:PROJECT},'retro-night-integration'),db=admin.firestore(app);
db.settings({host:HOST,ssl:false});
if(db.projectId!==PROJECT||!PROJECT.startsWith('demo-'))throw Error('Isolated demo database required');
const runtimeRequire=require('node:module').createRequire(require('node:path').resolve(__dirname,'../../functions/package.json'));
const {HttpsError}=runtimeRequire('firebase-functions/v2/https');
const {assertSeasonOpenForGame}=require('../../functions/lib/seasonLock');
after(async()=>{await db.terminate();await app.delete();});
const source=ts.createSourceFile('index.ts',fs.readFileSync('functions/src/index.ts','utf8'),ts.ScriptTarget.Latest,true);
const names=new Set(['loadRetroGameContext','guardFinishSeasonBatch','isAlreadyExists','GUEST_PREFIX','RAW_GUEST_RE','isReal','addRetroGoal','removeRetroGoal','saveGamePhysical']);
const selected=source.statements.filter(s=>ts.isFunctionDeclaration(s)?names.has(s.name?.text):ts.isVariableStatement(s)&&s.declarationList.declarations.some(d=>ts.isIdentifier(d.name)&&names.has(d.name.text)));
if(selected.length!==names.size)throw Error('Actual callable dependency boundary changed');
const code=ts.transpileModule(selected.map(s=>s.getText(source)).join('\n'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
function handlers(database=db){const exported={};new Function('exports','db','admin','onCall','ENFORCE_APP_CHECK','HttpsError','assertSeasonOpenForGame',code)(exported,database,admin,(_,handler)=>handler,false,HttpsError,assertSeasonOpenForGame);return exported;}
const api=handlers(),RUN='retro-'+Date.now()+'-'+process.pid;let sequence=0;
async function fixture(){
 const groupId=RUN+'-'+(++sequence),gameId=groupId+'-game',a=groupId+'-a',b=groupId+'-b',uid=groupId+'-manager',retroGoalId='local-marker';
 const group=db.collection('groups').doc(groupId),game=db.collection('games').doc(gameId),marker=game.collection('retroGoals').doc(retroGoalId);
 const batch=db.batch();batch.set(group,{adminIds:[uid],seasons:{enabled:true,currentId:'s1',currentNo:1,count:0}});batch.set(game,{groupId,createdBy:uid,status:'finished',seasonId:'s1',players:[a,b]});await batch.commit();
 const request={auth:{uid},data:{gameId,scorerId:a,assisterId:b,retroGoalId}};
 return {groupId,gameId,a,b,uid,group,game,marker,request};
}
async function counters(f,expected){
 const targets=[['users',f.a,'stats.goals'],['communityPlayerStats',f.groupId+'__'+f.a,'goals'],['gamePlayerStats',f.gameId+'__'+f.a,'goals'],['communityStats',f.groupId,'goals'],['users',f.b,'stats.assists'],['communityPlayerStats',f.groupId+'__'+f.b,'assists'],['gamePlayerStats',f.gameId+'__'+f.b,'assists']];
 const snapshots=await db.getAll(...targets.map(([collection,id])=>db.collection(collection).doc(id)));
 snapshots.forEach((snapshot,i)=>assert.equal(snapshot.get(targets[i][2])??0,expected,targets[i].join('/')));
}
function injected({failCommit=false,beforeCommit,beforeTransaction}={}){
 return {collection:name=>db.collection(name),batch:()=>{const batch=db.batch();return new Proxy(batch,{get(target,key){if(key==='commit')return async()=>{if(failCommit)throw Error('injected batch failure');if(beforeCommit)await beforeCommit();return target.commit();};const v=target[key];return typeof v==='function'?v.bind(target):v;}});},runTransaction:async fn=>{if(beforeTransaction)await beforeTransaction();return db.runTransaction(fn);}};
}
test('duplicate add and duplicate undo keep all seven counters reconciled',{timeout:60000},async()=>{
 const f=await fixture();await api.addRetroGoal(f.request);await counters(f,1);
 assert.equal((await api.addRetroGoal(f.request)).duplicate,true);await counters(f,1);
 await api.removeRetroGoal(f.request);await api.removeRetroGoal(f.request);await counters(f,0);assert.equal((await f.marker.get()).exists,false);
});
test('simultaneous adds count once; simultaneous undo decrements once',{timeout:60000},async()=>{
 const f=await fixture();const results=await Promise.allSettled([api.addRetroGoal(f.request),api.addRetroGoal(f.request)]);
 assert.ok(results.some(x=>x.status==='fulfilled'));await counters(f,1);
 // A precondition conflict may reject a transport attempt; retry is safe.
 await api.addRetroGoal(f.request);await counters(f,1);
 await Promise.all([api.removeRetroGoal(f.request),api.removeRetroGoal(f.request)]);await counters(f,0);
});
test('failed batch leaves no marker or increments, then retry succeeds',{timeout:60000},async()=>{
 const f=await fixture();await assert.rejects(handlers(injected({failCommit:true})).addRetroGoal(f.request),/injected batch failure/);
 assert.equal((await f.marker.get()).exists,false);await counters(f,0);await api.addRetroGoal(f.request);await counters(f,1);
});
test('season change after the last read rejects the entire add batch',{timeout:60000},async()=>{
 const f=await fixture();const beforeCommit=()=>f.group.update({'seasons.currentId':'s2','seasons.currentNo':2,'seasons.count':1});
 await assert.rejects(handlers(injected({beforeCommit})).addRetroGoal(f.request));
 assert.equal((await f.marker.get()).exists,false);await counters(f,0);
 await assert.rejects(api.addRetroGoal(f.request),error=>error.code==='failed-precondition'&&/closedSeasonGame/.test(error.message));
});
test('season change before undo transaction preserves the old marker and counts',{timeout:60000},async()=>{
 const f=await fixture();await api.addRetroGoal(f.request);
 const beforeTransaction=()=>f.group.update({'seasons.currentId':'s2','seasons.currentNo':2,'seasons.count':1});
 await assert.rejects(handlers(injected({beforeTransaction})).removeRetroGoal(f.request),error=>error.code==='failed-precondition');
 assert.equal((await f.marker.get()).exists,true);await counters(f,1);
});
test('unauthenticated, outsider, guest and unregistered scorer cannot write',{timeout:60000},async()=>{
 const f=await fixture();
 for(const [request,expected] of [
  [{data:f.request.data},'unauthenticated'],
  [{...f.request,auth:{uid:'outsider'}},'permission-denied'],
  [{...f.request,data:{...f.request.data,scorerId:'guest:local'}},'invalid-argument'],
  [{...f.request,data:{...f.request.data,scorerId:'not-on-roster'}},'invalid-argument'],
 ])await assert.rejects(api.addRetroGoal(request),error=>error.code===expected);
 await counters(f,0);assert.equal((await f.marker.get()).exists,false);
});
test('self-assist is ignored without crediting an assist',{timeout:60000},async()=>{
 const f=await fixture();await api.addRetroGoal({...f.request,data:{...f.request.data,assisterId:f.a}});
 assert.equal((await f.marker.get()).get('assisterId'),null);
 assert.equal((await db.collection('users').doc(f.a).get()).get('stats.assists'),undefined);
 assert.equal((await db.collection('communityStats').doc(f.groupId).get()).get('goals'),1);
});
test('concurrent physical saves preserve maxima with real Firestore transactions',{timeout:60000},async()=>{
 const f=await fixture();
 await Promise.all([1000,500].map(distanceM=>api.saveGamePhysical({auth:{uid:f.a},data:{gameId:f.gameId,metrics:{distanceM,steps:distanceM*2}}})));
 const saved=await f.game.collection('physical').doc(f.a).get();
 assert.equal(saved.get('distanceM'),1000);assert.equal(saved.get('steps'),2000);
 await api.saveGamePhysical({auth:{uid:f.a},data:{gameId:f.gameId,metrics:{distanceM:0,steps:0}}});
 assert.equal((await f.game.collection('physical').doc(f.a).get()).get('distanceM'),1000);
});
test('physical metrics stay bounded by recorded active time and caller identity',{timeout:60000},async()=>{
 const f=await fixture();await f.game.update({'liveMatch.activeIntervals':[{s:1000,e:11000}]});
 await api.saveGamePhysical({auth:{uid:f.a},data:{gameId:f.gameId,metrics:{distanceM:500,steps:1000,sprints:50,topSpeedKmh:100,source:'invalid'}}});
 const saved=await f.game.collection('physical').doc(f.a).get();
 assert.equal(saved.get('distanceM'),120);assert.equal(saved.get('steps'),40);assert.equal(saved.get('sprints'),2);assert.equal(saved.get('topSpeedKmh'),45);assert.equal(saved.get('source'),'wear');
 await assert.rejects(api.saveGamePhysical({auth:{uid:'outsider'},data:{gameId:f.gameId,metrics:{distanceM:1}}}),error=>error.code==='permission-denied');
 assert.equal((await f.game.collection('physical').doc('outsider').get()).exists,false);
});
