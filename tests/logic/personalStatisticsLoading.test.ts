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
function service(games:any[],highlight:any) {
 return load('src/services/playerStatsService.ts',{
  'firebase/firestore':{query:(collection:any)=>collection,where(){},getDocs:async (collection:string)=>({docs:collection==='games'?games.map((g,i)=>({id:String(i),data:()=>g})):[]})},
  '@/firebase/firestore':{col:{games:()=> 'games',pairStats:()=> 'pairs'}},
  '@/firebase/config':{USE_MOCK_DATA:false},'@/services/errorLog':{logError(){}},
  '@/utils/playedGames':played,'@/utils/eveningPlayed':evening,'./personalHighlightsService':{loadPersonalHighlights:highlight},
 }).playerStatsService;
}
const held={status:'finished',startsAt:1,players:['u'],endedBy:'admin'};
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
