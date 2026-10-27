import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';
function load(file:string,deps:Record<string,any>={}) {
 const source=fs.readFileSync(file,'utf8');
 const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const module={exports:{} as any};
 vm.runInNewContext(js,{module,exports:module.exports,require:(name:string)=>deps[name]??{},console,__DEV__:false});
 return module.exports;
}
const evening=load('src/utils/eveningPlayed.ts');
const played=load('src/utils/playedGames.ts',{'@/utils/eveningPlayed':evening});
const personal=load('src/utils/personalStatistics.ts');
const partnerResults=load('src/utils/personalPartnerStats.ts');
function service(games:any[],highlight:any) {
 return load('src/services/playerStatsService.ts',{
  'firebase/firestore':{query:(collection:any)=>collection,where(){},getDocs:async (collection:string)=>({docs:collection==='games'?games.map((g,i)=>({id:String(i),data:()=>g})):[]})},
  '@/firebase/firestore':{col:{games:()=> 'games',pairStats:()=> 'pairs'}},
  '@/firebase/config':{USE_MOCK_DATA:false},'@/services/errorLog':{logError(){}},
  '@/utils/playedGames':played,'@/utils/eveningPlayed':evening,'./personalHighlightsService':{loadPersonalHighlights:highlight},'@/utils/personalPartnerStats':partnerResults,
 }).playerStatsService;
}
const held={status:'finished',startsAt:1,players:['u'],endedBy:'admin'};

test('attendance insight uses the full ordered registered history, not just five enriched rounds', async () => {
 const rows=Array.from({length:10},(_,i)=>({...held,startsAt:i+1,...(i===5?{arrivals:{u:'no_show'}}:{})})).reverse();
 const highlight=jest.fn(async(_uid:string,_rounds:any[])=>personal.personalHighlights([],{},{}));
 const result=await service([...rows,{...held,startsAt:Date.now()+100000},{...held,startsAt:40,status:'cancelled'},
  {...held,startsAt:41,players:['other']},{...held,startsAt:42,endedBy:'auto'}],highlight).compute('u',{recentHighlightsOnly:true});
 expect(result.attendanceStreak).toEqual({current:4,best:5});
 expect(result.attendedGames).toBe(9);expect(result.totalRegistered).toBe(10);
 expect(highlight.mock.calls[0][1]).toHaveLength(5);
});
test('a missing round date hides record claims without changing historical totals', async () => {
 const result=await service([{...held,startsAt:undefined},held],async()=>personal.personalHighlights([],{},{})).compute('u');
 expect(result.attendanceStreak).toBeUndefined();expect(result.attendedGames).toBe(2);
});
test('the most recent no-show breaks the current attendance streak', async () => {
 const result=await service([held,{...held,startsAt:2,arrivals:{u:'no_show'}}],async()=>personal.personalHighlights([],{},{})).compute('u');
 expect(result.attendanceStreak).toEqual({current:0,best:1});
});

test.each(['a','b'])('regular partner results use same-team record when viewer is %s',async(side)=>{
 const row={a:side==='a'?'u':'p',b:side==='b'?'u':'p',sameTeam:8,winsTogether:4,lossesTogether:3,winsA:90,winsB:70};
 const s=load('src/services/playerStatsService.ts',{
  'firebase/firestore':{query:(collection:string,...filters:any[])=>({collection,filters}),where:(field:string,_op:string,value:string)=>({field,value}),getDocs:async(q:any)=>({docs:q.collection==='games'?[{id:'g',data:()=>({...held,players:['u','p']})}]:q.filters[0].field===side?[{data:()=>row}]:[]})},
  '@/firebase/firestore':{col:{games:()=> 'games',pairStats:()=> 'pairs'}},'@/firebase/config':{USE_MOCK_DATA:false},'@/services/errorLog':{logError(){}},
  '@/utils/playedGames':played,'@/utils/eveningPlayed':evening,'@/utils/personalPartnerStats':partnerResults,'./personalHighlightsService':{loadPersonalHighlights:async()=>personal.personalHighlights([],{},{} )},
 }).playerStatsService;
 const result=await s.compute('u');
 expect(result.mostPlayedWith).toEqual({uid:'p',count:1});
 expect(result.regularPartnerResults).toEqual({games:8,wins:4,losses:3,ties:1,winRate:50});
});

test('home limits detailed history to the latest five while preserving lifetime counters', async () => {
 const highlight=jest.fn(async(_uid:string,_rounds:any[])=>personal.personalHighlights([],{},{}));
 const s=service(Array.from({length:12},(_,i)=>({...held,startsAt:i+1})),highlight);
 const home=await s.compute('u',{recentHighlightsOnly:true});
 expect(home.attendedGames).toBe(12);
 expect(highlight.mock.calls[0][1].map((r:any)=>r.gameId)).toEqual(['11','10','9','8','7']);
 await s.compute('u');
 expect(highlight.mock.calls[1][1]).toHaveLength(12);
});
test('unverified and explicitly unplayed evenings do not reduce attendance; no-show does',async()=>{
 const s=service([held,{...held,endedBy:'auto'},{...held,playVerified:false},{...held,arrivals:{u:'no_show'}}],async()=> personal.personalHighlights([],{},{}));
 const result=await s.compute('u');
 expect(result.attendedGames).toBe(1);expect(result.totalRegistered).toBe(2);expect(result.attendanceRate).toBe(50);
});
test('base statistics are published before a slow history read finishes',async()=>{
 let finish:(value:any)=>void=()=>{};
 const delayed=new Promise(resolve=>{finish=resolve});
 const onBase=jest.fn();let completed=false;
 const request=service([held],()=>delayed).compute('u',{onBase}).then((value:any)=>{completed=true;return value});
 await new Promise(setImmediate);
 expect(onBase).toHaveBeenCalledWith(expect.objectContaining({attendedGames:1}));expect(completed).toBe(false);
 finish(personal.personalHighlights([],{},{}));expect((await request).attendedGames).toBe(1);
});
test('canceled history stops scheduling batches; latest chart is published before old records',async()=>{
 const queried:string[]=[];let active=true;
 const progress:any[]=[];
 const h=load('src/services/personalHighlightsService.ts',{
  'firebase/firestore':{collection:(_db:any,name:string)=>name,where:(key:string,_op:string,value:any)=>({key,value}),query:(name:string,...clauses:any[])=>({name,clauses}),getDocs:async(q:any)=>{
   if(q.name==='eveningStandings')return {docs:[{data:()=>({gameId:'g9',score:8})}]};
   queried.push(q.clauses.find((x:any)=>x.key==='gameId').value);return {docs:[]};
  }},'@/firebase/config':{getFirebase:()=>({db:{}})},'./errorLog':{logError(){}},'@/utils/personalStatistics':personal,
 });
 const rounds=Array.from({length:10},(_,i)=>({gameId:'g'+i,at:i}));
 await h.loadPersonalHighlights('u',rounds,{isCurrent:()=>active,onProgress:(v:any)=>{progress.push(v);if(queried.length)active=false;}});
 expect(queried).toEqual(['g9','g8','g7','g6']);expect(progress[0].points[0].score).toBe(8);
 expect(progress[0].bestGoals).toBeNull();
});

function parallelFixture() {
 const waiting = new Map<string, { resolve: (value:any)=>void; reject: (reason:Error)=>void }>();
 const getDocs = jest.fn((q:any) => new Promise((resolve,reject) => waiting.set(q.collection==='games'?'games':q.field,{resolve,reject})));
 const logError=jest.fn(),highlight=jest.fn(async()=>personal.personalHighlights([],{},{}));
 const s=load('src/services/playerStatsService.ts',{
  'firebase/firestore':{query:(collection:string,filter:any)=>({collection,...filter}),where:(field:string)=>({field}),getDocs},
  '@/firebase/firestore':{col:{games:()=> 'games',pairStats:()=> 'pairs'}},'@/firebase/config':{USE_MOCK_DATA:false},'@/services/errorLog':{logError},
  '@/utils/playedGames':played,'@/utils/eveningPlayed':evening,'@/utils/personalPartnerStats':partnerResults,'./personalHighlightsService':{loadPersonalHighlights:highlight},
 }).playerStatsService;
 const resolve=(key:string,rows:any[]=[])=>waiting.get(key)!.resolve({docs:rows.map((row,i)=>({id:String(i),data:()=>row}))});
 return {s,waiting,getDocs,logError,highlight,resolve};
}

test('all three base queries start together, and base totals wait for complete sources',async()=>{
 const f=parallelFixture(),onBase=jest.fn();
 const pending=f.s.compute('u',{goals:6,assists:2,onBase});
 expect([...f.waiting.keys()]).toEqual(['games','a','b']);
 f.resolve('games',[{...held,players:['u','p']}]);await new Promise(setImmediate);
 expect(onBase).not.toHaveBeenCalled();
 f.resolve('b');f.resolve('a',[{b:'p',sameTeam:5,winsTogether:3,lossesTogether:1}]);
 const result=await pending;
 expect(result).toMatchObject({attendedGames:1,goals:6,assists:2,attendanceRate:100,mostPlayedWith:{uid:'p',count:1},mostWinsWith:{uid:'p',count:3},regularPartnerResults:{games:5,wins:3,losses:1,ties:1,winRate:60}});
 expect(onBase).toHaveBeenCalledTimes(1);
});

test.each(['games','a','b'])('a failed %s query rejects promptly with its source while other reads remain pending',async key=>{
 const f=parallelFixture(),onBase=jest.fn(),error=Error('offline');
 const pending=f.s.compute('u',{onBase});
 f.waiting.get(key)!.reject(error);
 await expect(pending).rejects.toBe(error);
 expect(f.logError).toHaveBeenCalledWith(key==='games'?'playerStats.games':'playerStats.pairs',error,{userId:'u'});
 expect(onBase).not.toHaveBeenCalled();expect(f.highlight).not.toHaveBeenCalled();
});

test('leaving during base queries does not start historical enrichment or publish late callbacks',async()=>{
 const f=parallelFixture(),onBase=jest.fn();let active=true;
 const pending=f.s.compute('u',{isCurrent:()=>active,onBase});
 active=false;
 f.resolve('games',[held]);f.resolve('a');f.resolve('b');
 expect((await pending).attendedGames).toBe(1);
 expect(f.highlight).not.toHaveBeenCalled();expect(onBase).not.toHaveBeenCalled();
});
