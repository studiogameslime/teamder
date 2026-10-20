// Integration against an isolated, loopback-only Firestore emulator.
// Start it explicitly; this file cannot use an inherited production target.
const {test,after}=require('node:test');
const assert=require('node:assert/strict');
const PROJECT='demo-teamder-night-audit',HOST='127.0.0.1:8185';
process.env.FIRESTORE_EMULATOR_HOST=HOST;
const admin=require('../../functions/node_modules/firebase-admin');
const app=admin.initializeApp({projectId:PROJECT},'season-night-integration');
const db=admin.firestore(app);
db.settings({host:HOST,ssl:false});
if(db.projectId!==PROJECT||!PROJECT.startsWith('demo-'))throw Error('Isolated demo database required');
const {closeSeason}=require('../../functions/lib/seasonRollover');
const {readArchiveData}=require('../../functions/lib/seasonArchiveData');
after(async()=>{await db.terminate();await app.delete();});
let sequence=0;
const RUN='run-'+Date.now()+'-'+process.pid;
async function fixture(){
 const groupId=RUN+'-'+(++sequence),seasonId='s1';
 const a='a-'+groupId,b='b-'+groupId;
 const ra=db.collection('communityPlayerStats').doc(groupId+'__'+a);
 const rb=db.collection('communityPlayerStats').doc(groupId+'__'+b);
 const pair=db.collection('communityPairStats').doc(groupId+'__'+a+'__'+b);
 const club=db.collection('communityStats').doc(groupId);
 const archive=db.collection('seasonSummary').doc(groupId+'__'+seasonId);
 const card=db.collection('seasonCards').doc(groupId+'__'+seasonId);
 const batch=db.batch();
 batch.set(ra,{groupId,userId:a,goals:7,assists:2,games:7,rounds:12,wins:6,losses:3,ties:3,eveningScoreSum:24,eveningScoreCount:3,bestEvening:9.2});
 batch.set(rb,{groupId,userId:b,goals:3,assists:1,games:8,rounds:12,wins:6,losses:3,ties:3,eveningScoreSum:64,eveningScoreCount:8,bestEvening:9});
 batch.set(pair,{groupId,a,b,sameTeam:12,winsTogether:7,lossesTogether:3,cleanSheetsTogether:4,against:4,winsA:1,winsB:2,assistsAToB:2,assistsBToA:1});
 batch.set(club,{groupId,goals:10,rounds:12,kingGoalsSum:99,kingGoalsCount:11});
 await batch.commit();
 return {groupId,seasonId,a,b,ra,rb,pair,club,archive,card,args:{db,groupId,seasonId,seasonNo:1,startsAt:100,completedRounds:10,now:200,groupName:'נתונים מקומיים בלבד'}};
}
function injected({beforeArchive=false,failCard=false,failTransaction=0,beforeFirstTransaction}={}){
 let txCount=0,batches=0;
 return {
  collection:name=>{
   const collection=db.collection(name);if(!failCard||name!=='seasonCards')return collection;
   return new Proxy(collection,{get(target,key){if(key==='doc')return id=>{const ref=target.doc(id);return new Proxy(ref,{get(r,k){if(k==='set')return async()=>{throw Error('injected card failure');};const v=r[k];return typeof v==='function'?v.bind(r):v;}});};const value=target[key];return typeof value==='function'?value.bind(target):value;}});
  },getAll:(...refs)=>db.getAll(...refs),
  batch:()=>{const batch=db.batch();const number=++batches;
   return new Proxy(batch,{get(target,key){if(key==='commit')return async()=>{if(beforeArchive&&number===1)throw Error('injected archive failure');return target.commit();};const value=target[key];return typeof value==='function'?value.bind(target):value;}});
  },
  runTransaction:async fn=>{const number=++txCount;if(number===failTransaction)throw Error('injected transaction failure');if(number===1&&beforeFirstTransaction)await beforeFirstTransaction();return db.runTransaction(fn);},
 };
}
async function assertClosed(f,{goals=0,sameTeam=0}={}){
 const [a,b,pair,club,archive,card]=await db.getAll(f.ra,f.rb,f.pair,f.club,f.archive,f.card);
 assert.equal(a.get('goals'),goals);assert.equal(b.get('goals'),0);assert.equal(club.get('goals'),goals);assert.equal(pair.get('sameTeam'),sameTeam);
 assert.equal(a.get('bestEvening'),9.2);assert.equal(club.get('kingGoalsSum'),99);
 assert.equal(archive.get('totals.goals'),10);assert.equal(archive.get('players.'+f.a+'.goals'),7);
 assert.equal(archive.get('completedRounds'),10);assert.ok(archive.get('zeroedAt'));
 assert.equal(card.get('completedRounds'),10);assert.equal(card.get('totals.goals'),10);
 const frozen=await readArchiveData(db,archive.data());
 assert.equal(frozen.pairs[f.a+'__'+f.b].sameTeam,12);
 assert.equal(frozen.pairs[f.a+'__'+f.b].assistsAToB,2);
 assert.equal(frozen.pairs[f.a+'__'+f.b].assistsBToA,1);
 assert.deepEqual(archive.get('awards.mvp.coverageByWinner.'+f.a),{rated:3,of:10});
 assert.deepEqual(archive.get('awards.mvp.coverageByWinner.'+f.b),{rated:8,of:10});
 const mvp=card.get('winners').find(x=>x.key==='mvp');assert.equal(mvp?.coverage,undefined);
 const result=await closeSeason(f.args);assert.equal(result.archived,false);
 assert.equal((await f.ra.get()).get('goals'),goals);assert.equal((await f.pair.get()).get('sameTeam'),sameTeam);
}
test('archive failure never wipes live statistics; retry closes cleanly',{timeout:60000},async()=>{
 const f=await fixture();await assert.rejects(closeSeason({...f.args,db:injected({beforeArchive:true})}),/injected archive failure/);
 assert.equal((await f.archive.get()).exists,false);assert.equal((await f.ra.get()).get('goals'),7);
 await closeSeason(f.args);await assertClosed(f);
});
for(const failTransaction of [1,2,3,4])test('resume after failure before transaction '+failTransaction+' preserves the frozen archive',{timeout:60000},async()=>{
 const f=await fixture();await assert.rejects(closeSeason({...f.args,db:injected({failTransaction})}),/injected transaction failure/);
 const frozen=(await f.archive.get()).data();assert.equal(frozen.zeroedAt,undefined);assert.equal(frozen.totals.goals,10);
 await closeSeason(f.args);await assertClosed(f);
 assert.deepEqual((await f.archive.get()).get('awards'),frozen.awards);
});
test('contributions arriving after the archive survive the subtraction',{timeout:60000},async()=>{
 const f=await fixture();
 const beforeFirstTransaction=async()=>{const batch=db.batch();batch.update(f.ra,{goals:admin.firestore.FieldValue.increment(2)});batch.update(f.club,{goals:admin.firestore.FieldValue.increment(2)});batch.update(f.pair,{sameTeam:admin.firestore.FieldValue.increment(1)});await batch.commit();};
 await closeSeason({...f.args,db:injected({beforeFirstTransaction})});await assertClosed(f,{goals:2,sameTeam:1});
});
test('two simultaneous closes freeze once and subtract once',{timeout:60000},async()=>{
 const f=await fixture();await Promise.all([closeSeason(f.args),closeSeason(f.args)]);await assertClosed(f);
});
test('failure before the compact card resumes from the frozen archive',{timeout:60000},async()=>{
 const f=await fixture();await assert.rejects(closeSeason({...f.args,db:injected({failCard:true})}),/injected card failure/);
 assert.equal((await f.archive.get()).exists,true);assert.equal((await f.card.get()).exists,false);
 assert.equal((await f.ra.get()).get('goals'),7);
 await closeSeason(f.args);await assertClosed(f);
});
test('a resumed close keeps the archived season number, length and dates',{timeout:60000},async()=>{
 const f=await fixture();await assert.rejects(closeSeason({...f.args,db:injected({failTransaction:2})}),/injected transaction failure/);
 await closeSeason({...f.args,seasonNo:4,completedRounds:99,startsAt:999,now:9999});
 await assertClosed(f);
 const card=await f.card.get();assert.equal(card.get('no'),1);assert.equal(card.get('startsAt'),100);assert.equal(card.get('endsAt'),200);
});
test('a frozen season cannot be reopened and retries keep the same archive',{timeout:60000},async()=>{
 const f=await fixture();await closeSeason(f.args);
 assert.equal(require('../../functions/lib/seasonRollover').reopenSeason,undefined);
 const before=(await f.archive.get()).data();await closeSeason(f.args);
 assert.deepEqual((await f.archive.get()).data(),before);assert.equal((await f.ra.get()).get('goals'),0);
});
test('401 pairs archive atomically; missing page prevents a partial resume',{timeout:120000},async()=>{
 const f=await fixture();const batch=db.batch();
 for(let i=0;i<400;i++){
  const a='p'+String(i).padStart(4,'0')+'-'+f.groupId,b='q'+String(i).padStart(4,'0')+'-'+f.groupId;
  batch.set(db.collection('communityPairStats').doc(f.groupId+'__'+a+'__'+b),{groupId:f.groupId,a,b,sameTeam:1});
 }
 await batch.commit();
 await assert.rejects(closeSeason({...f.args,db:injected({beforeArchive:true})}),/injected archive failure/);
 assert.equal((await db.collection('seasonSummary').where('groupId','==',f.groupId).get()).size,0);
 await assert.rejects(closeSeason({...f.args,db:injected({failTransaction:1})}),/injected transaction failure/);
 const archive=(await f.archive.get()).data();assert.equal(Object.keys(archive.pairs).length,400);assert.equal(archive.pairPages.length,1);
 const all=await readArchiveData(db,archive);assert.equal(Object.keys(all.pairs).length,401);
 const pageRef=db.collection('seasonSummary').doc(archive.pairPages[0]),page=(await pageRef.get()).data();
 // Only this test-owned document in the hard-bound local demo database.
 await pageRef.delete();await assert.rejects(closeSeason(f.args),/Missing season pair page/);
 assert.equal((await f.ra.get()).get('goals'),7);assert.equal((await f.archive.get()).get('zeroedAt'),undefined);
 await pageRef.set(page);await closeSeason(f.args);await assertClosed(f);
 assert.equal(Object.keys((await readArchiveData(db,(await f.archive.get()).data())).pairs).length,401);
});
