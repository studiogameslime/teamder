'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { performance } = require('node:perf_hooks');
const [phase, sizeArg = '400'] = process.argv.slice(2);
const size = Number(sizeArg);
assert(['before', 'after'].includes(phase) && [400, 4000].includes(size));
const projectId = 'demo-discovery-speed-' + size;
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = projectId;
process.env.FIREBASE_CONFIG = JSON.stringify({projectId});
const load = createRequire(path.resolve(__dirname,'../../functions/package.json'));
const admin = load('firebase-admin');
admin.initializeApp({projectId});
const db = admin.firestore();
function baseline(){
  const ts=require('typescript'), Module=require('node:module');
  const file=path.resolve('functions/lib/discoveryBaseline.js');
  const source=fs.readFileSync(path.resolve(__dirname,'../../artifacts/discovery-speed-2026-11-04/before/functions/src/socialPlayers.ts'),'utf8');
  const m=new Module(file,module);m.filename=file;m.paths=Module._nodeModulePaths(path.dirname(file));
  m._compile(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,file);
  return m.exports;
}
const api=phase==='before'?baseline():load('./lib/socialPlayers');
const viewer = '000-viewer', id = i=>'p'+String(i).padStart(4,'0'), late=id(size-5);
const call = (fn,data,uid=viewer)=>api[fn].run({auth:{uid,token:{firebase:{sign_in_provider:'password'}}},data});
async function seed() {
  const writes=[['users/'+viewer,{name:'צופה',friends:[late]}]];
  for(let i=1;i<size;i++) {
    const name=i===1?'שחקן ראשון':id(i)===late?'שחקן אחרון':'שחקן '+i;
    writes.push(['users/'+id(i),{name,friends:id(i)===late?[viewer]:[],availability:{homeCity:'חיפה',preferredDays:[],preferredTimes:[]}}]);
  }
  for(let i=0;i<4;i++)writes.push(['groups/g'+i,{name:'מועדון',city:'חיפה',playerIds:[viewer,late],adminIds:[viewer]}]);
  for(let i=0;i<60;i++){
    writes.push(['games/g'+i,{startsAt:i+1,status:'finished',participantIds:[viewer,late],players:[viewer,late]}],
      ['gamePlayerStats/s'+i,{gameId:'g'+i,userId:late,goals:1,assists:0}]);
  }
  writes.push(['games/recruit',{title:'מחזור פתוח',createdBy:'other-manager',groupId:'g0',startsAt:Date.now()+86400000,status:'open',players:[],participantIds:[]}]);
  for(let i=0;i<writes.length;i+=400){
    const batch=db.batch(); for(const [p,v] of writes.slice(i,i+400))batch.set(db.doc(p),v);
    await batch.commit();
  }
  if(phase==='after')await load('./lib/socialDirectory').buildSocialDirectory(db);
}
async function search(data,expectedId) {
  let cursor=null,pages=0;
  do{
    const page=await call('searchSocialPlayers',{...data,cursor,searchVersion:2});pages++;
    if(page.players.length){assert(expectedId && page.players.some(p=>p.id===expectedId));return {pages,rows:page.players.length};}
    assert(!page.cursor||page.cursor!==cursor);cursor=page.cursor;
  }while(cursor);
  assert.equal(expectedId,null);return {pages,rows:0};
}
const cases=[
  ['open',()=>search({},phase==='after'?late:id(1))],
  ['earlyName',()=>search({text:'ראשון'},id(1))],
  ['lateName',()=>search({text:'אחרון'},late)],
  ['absent',()=>search({text:'בלתי קיים'},null)],
  ['friendsOnly',()=>search({friendsOnly:true},late)],
  ['card',async()=>{const r=await call('getSocialPlayerProfile',{userId:late,view:'card'});assert.equal(r.player.id,late);assert(r.canSeeStatistics);return {pages:1,rows:1};}],
  ['recruit',async()=>{const r=await call('findAvailableSocialPlayers',{gameId:'recruit'});assert.equal(r.players.length,50);return {pages:1,rows:r.players.length};}],
];
async function main(){
  await seed();
  const records=[],first=[];
  for(let pass=-1;pass<7;pass++){
    await db.doc('serverRateLimits/'+viewer+'_social_search').set({start:0,count:0});
    for(let i=0;i<cases.length;i++){
      const [name,run]=cases[(i+Math.max(0,pass))%cases.length];
      const start=performance.now(),result=await run(),ms=Math.round(performance.now()-start);
      (pass>=0?records:first).push({name,pass,ms,...result});
    }
  }
  const summary=cases.map(([name])=>{
    const rows=records.filter(r=>r.name===name),times=rows.map(r=>r.ms).sort((a,b)=>a-b);
    return {name,median:times[3],min:times[0],max:times[6],pages:rows[0].pages};
  });
  const out=path.resolve(__dirname,'../../artifacts/discovery-speed-2026-11-04');
  fs.mkdirSync(out,{recursive:true});
  fs.writeFileSync(path.join(out,phase+'-'+size+'.json'),JSON.stringify({phase,size,summary,records,first},null,2));
  console.table(summary);
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>admin.app().delete());
