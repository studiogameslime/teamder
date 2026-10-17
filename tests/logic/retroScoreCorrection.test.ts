import fs from 'fs';
import path from 'path';
import vm from 'vm';
import ts from 'typescript';
import { prepareRetroScores } from '../../functions/src/retroScores';
import { planRetroScores, recoverScoreCalibration, scoreWithCalibration } from '../../functions/src/retroScorePlan';
import { assertSeasonOpenForGame } from '../../functions/src/seasonLock';
import { correctedRoundSummary } from '../../functions/src/retroRoundSummary';
import { buildRoundSummary, type RoundSummaryInput } from '../../functions/src/roundSummary';

const basis={goalsFor10:4,assistsFor10:2};
const originalStats={goals:0,assists:0,wins:1,rounds:2};
const originalScore=scoreWithCalibration(originalStats,basis);
const entry=(userId='a')=>({userId,stats:{...originalStats},standing:{score:originalScore,scoreDelta:1,scoreBasis:{...basis,previousScore:originalScore-1,previousAt:10,counted:true}},cumulative:{eveningScoreSum:originalScore,eveningScoreCount:1,lastEveningScore:originalScore,lastEveningAt:100}});
test('correction replaces one score contribution while preserving the mean denominator',()=>{
 const row=entry();row.stats.goals=2;const result=planRetroScores([row],basis,100,500)[0];
 expect(result.score).toBeGreaterThan(originalScore);expect(result.cumulative.eveningScoreSum).toBe(result.score);
 expect(result.cumulative).not.toHaveProperty('eveningScoreCount');expect(result.standing.scoreDelta).toBe(Math.round((result.score-(originalScore-1))*10)/10);
 expect(row.cumulative.eveningScoreSum).toBe(originalScore);
});
test('a player with no recorded games stays unscored and does not enter the average',()=>{
 const row=entry();row.stats={goals:2,assists:1,wins:0,rounds:0};row.standing.score=6;row.standing.scoreBasis.counted=false;
 expect(planRetroScores([row],basis,100,500)[0].cumulative).not.toHaveProperty('eveningScoreSum');
});
test('older corrections do not overwrite the latest score; rounded tied scores keep the existing uid tie-break',()=>{
 const a=entry('a'),b=entry('b');a.cumulative.lastEveningAt=300;
 b.stats.goals=1;a.stats.assists=1;
 const equalA=entry('a'),equalB=entry('b');equalB.stats.goals=1;equalB.standing.score=scoreWithCalibration(equalB.stats,basis);
 const result=planRetroScores([a,b],basis,100,500);expect(result[0].cumulative).not.toHaveProperty('lastEveningScore');
 const ties=planRetroScores([equalB,equalA],{goalsFor10:1000,assistsFor10:1000},100,500);
 expect(ties.find(r=>r.userId==='a')?.standing.scoreRank).toBe(1);
});
test('legacy calibration is verified against all pre-correction inputs and refuses a mismatched benchmark',()=>{
 const e=entry();e.stats.goals=1;const old={...e,standing:{score:originalScore}};
 expect(recoverScoreCalibration([old],{kingGoalsSum:4,kingGoalsCount:1,kingAssistsSum:2,kingAssistsCount:1},[{scorerId:'a',at:300}],200)).toEqual(basis);
 old.standing.score=9;expect(()=>recoverScoreCalibration([old],{},[],200)).toThrow('SCORE_CALIBRATION_MISSING');
});

// Execute the real callable bodies and transaction helper. A write is applied
// only after the callback succeeds, and reads after any write are forbidden.
function world(withNext=false){
 const rows=new Map<string,any>();
 const put=(name:string,data:any)=>rows.set(name,JSON.parse(JSON.stringify(data)));
 put('games/g',{status:'finished',groupId:'c',startsAt:100,endedAt:200,players:['a','b']});put('groups/c',{});
 put('games/g/finishStages/standings',{at:200,scoreCalibration:basis});put('communityStats/c',{goals:0,kingGoalsSum:1000,kingGoalsCount:1});
 for(const uid of ['a','b']){const e=entry(uid);put('gamePlayerStats/g__'+uid,{...e.stats,gameId:'g',userId:uid});put('eveningStandings/g__'+uid,{...e.standing,gameId:'g',groupId:'c',userId:uid,at:100});put('communityPlayerStats/c__'+uid,{...e.cumulative,userId:uid,groupId:'c'});}
 if(withNext){put('eveningStandings/next__a',{gameId:'next',groupId:'c',userId:'a',at:300,score:8,scoreDelta:8-originalScore,scoreBasis:{...basis,previousScore:originalScore,previousAt:100}});put('communityPlayerStats/c__a',{eveningScoreSum:originalScore+8,eveningScoreCount:2,lastEveningScore:8,lastEveningAt:300});}
 const ref=(name:string):any=>({path:name,id:name.split('/').pop(),collection:(s:string)=>collection(name+'/'+s)});
 const collection=(name:string,filters:any[]=[],limit=10000):any=>({path:name,filters,cap:limit,doc:(id:string)=>ref(name+'/'+id),where:(f:string,_op:string,v:any)=>collection(name,[...filters,[f,v]],limit),limit:(n:number)=>collection(name,filters,n)});
 const snap=(r:any):any=>({ref:ref(r.path),id:r.id??r.path.split('/').pop(),exists:rows.has(r.path),data:()=>rows.get(r.path)?JSON.parse(JSON.stringify(rows.get(r.path))):undefined,get:(k:string)=>rows.get(r.path)?.[k]});
 const merge=(old:any,patch:any):any=>{const next={...old};for(const [k,v] of Object.entries(patch) as any){if(k.includes('.')){const [head,...tail]=k.split('.');next[head]=merge(next[head]??{},{[tail.join('.')]:v});}else if(v?.increment!==undefined)next[k]=(next[k]??0)+v.increment;else if(v&&typeof v==='object'&&!Array.isArray(v))next[k]=merge(next[k]??{},v);else next[k]=v;}return next;};
 const db:any={doc:ref,collection,runTransaction:async(fn:any)=>{
  const writes:any[]=[];
  const tx:any={get:async(r:any)=>{if(writes.length)throw Error('READ_AFTER_WRITE');if(r.filters){const docs=[...rows.keys()].filter(k=>k.startsWith(r.path+'/')&&k.split('/').length===r.path.split('/').length+1).filter(k=>r.filters.every(([f,v]:any)=>rows.get(k)?.[f]===v)).slice(0,r.cap).map(k=>snap(ref(k)));return{docs,size:docs.length};}return snap(r);},
   getAll:async(...refs:any[])=>{if(writes.length)throw Error('READ_AFTER_WRITE');return refs.map(snap);},
   update:(r:any,p:any)=>writes.push(['update',r.path,p]),set:(r:any,p:any)=>writes.push(['set',r.path,p]),create:(r:any,p:any)=>writes.push(['create',r.path,p]),delete:(r:any)=>writes.push(['delete',r.path])};
  const result=await fn(tx);for(const [kind,name,p] of writes){if(kind==='delete')rows.delete(name);else{if(kind==='create'&&rows.has(name))throw Error('DUPLICATE');if(kind==='update'&&!rows.has(name))throw Error('MISSING_DOC');put(name,merge(rows.get(name)??{},p));}}return result;
 }};
 const src=ts.createSourceFile('index.ts',fs.readFileSync(path.resolve(__dirname,'../../functions/src/index.ts'),'utf8'),ts.ScriptTarget.Latest,true);
 const context:any={module:{exports:{}},db,prepareRetroScores,assertSeasonOpenForGame,ENFORCE_APP_CHECK:false,
  HttpsError:class extends Error{constructor(_code:string,msg:string){super(msg);}},isReal:(id:string)=>!id.startsWith('guest:'),
  loadRetroGameContext:async()=>({game:rows.get('games/g'),groupId:'c'}),admin:{firestore:{FieldValue:{increment:(increment:number)=>({increment})}}},onCall:(_opts:any,fn:any)=>fn};
 for(const name of ['addRetroGoal','removeRetroGoal']){let code='';const visit=(n:ts.Node)=>{if(ts.isVariableDeclaration(n)&&n.name.getText(src)===name)code=n.initializer!.getText(src);ts.forEachChild(n,visit);};visit(src);vm.runInNewContext(ts.transpileModule('module.exports='+code,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);context[name]=context.module.exports;}
 const request=(id='one')=>({auth:{uid:'admin'},data:{gameId:'g',scorerId:'a',assisterId:'b',retroGoalId:id}});
 return {rows,put,request,add:context.addRetroGoal,remove:context.removeRetroGoal};
}
test('add, duplicate retry, second add and undo atomically update goals, scores and averages exactly once',async()=>{
 const w=world();await w.add(w.request());const score=w.rows.get('eveningStandings/g__a').score;
 expect(score).toBeGreaterThan(originalScore);expect(w.rows.get('gamePlayerStats/g__a').goals).toBe(1);
 await w.add(w.request());expect(w.rows.get('gamePlayerStats/g__a').goals).toBe(1);expect(w.rows.get('communityPlayerStats/c__a').eveningScoreSum).toBe(score);
 await w.add(w.request('two'));expect(w.rows.get('communityPlayerStats/c__a').eveningScoreCount).toBe(1);
 await w.remove(w.request('two'));await w.remove(w.request('two'));await w.remove(w.request());
 expect(w.rows.get('gamePlayerStats/g__a').goals).toBe(0);expect(w.rows.get('eveningStandings/g__a').score).toBe(originalScore);
 expect(w.rows.get('communityPlayerStats/c__a').eveningScoreSum).toBe(originalScore);expect(w.rows.get('communityPlayerStats/c__b').eveningScoreSum).toBe(originalScore);
});
test('correction updates the next comparison but preserves that later score and latest-evening pointer',async()=>{
 const w=world(true);await w.add(w.request());const score=w.rows.get('eveningStandings/g__a').score;
 expect(w.rows.get('eveningStandings/next__a').score).toBe(8);expect(w.rows.get('eveningStandings/next__a').scoreDelta).toBe(Math.round((8-score)*10)/10);
 expect(w.rows.get('communityPlayerStats/c__a').lastEveningScore).toBe(8);
});
test('missing finish stage or a closed season never leaves a half-applied goal or score',async()=>{
 const w=world();w.rows.delete('games/g/finishStages/standings');await expect(w.add(w.request())).rejects.toThrow('score-summary:pending');
 expect(w.rows.has('games/g/retroGoals/one')).toBe(false);expect(w.rows.get('gamePlayerStats/g__a').goals).toBe(0);
 const closed=world();closed.put('groups/c',{seasons:{enabled:true,currentId:'s2',currentNo:2,count:1}});
 await expect(closed.add(closed.request())).rejects.toThrow('closedSeasonGame');expect(closed.rows.has('games/g/retroGoals/one')).toBe(false);
});

test('general summary, stars and direct pair refresh in the same transaction and restore on undo',async()=>{
 const w=world();
 w.put('roundSummaries/g',{gameId:'g',groupId:'c',at:100,stats:{goals:0,assists:0,rounds:1},events:[],basis:{since:0,eveningsCompared:5}});
 w.put('games/g/roundHistory/one',{teamAIndex:0,teamBIndex:1,winnerSide:'A',goals:[],penalties:[]});
 await w.add(w.request());const summary=w.rows.get('roundSummaries/g');
 expect(summary.stats).toMatchObject({goals:1,assists:1,rounds:1});expect(summary.leaders.topScorers).toEqual({userIds:['a'],value:1});
 expect(summary.leaders.topAssisters).toEqual({userIds:['b'],value:1});expect(summary.pairHighlight).toBeNull();
 await w.add(w.request());expect(w.rows.get('roundSummaries/g').stats.goals).toBe(1);
 await w.add(w.request('two'));expect(w.rows.get('roundSummaries/g').pairHighlight.goals).toBe(2);await w.remove(w.request('two'));
 await w.remove(w.request());expect(w.rows.get('roundSummaries/g').stats).toMatchObject({goals:0,assists:0,rounds:1});expect(w.rows.get('roundSummaries/g').pairHighlight).toBeNull();
 expect(w.rows.get('games/g/roundHistory/one').winnerSide).toBe('A');
});

test('summary counts guests and own goals once, excludes guests from titles, and does not invent a game for a retro pass',()=>{
 const stats=[{userId:'a',goals:2,assists:0},{userId:'guest:x',goals:4,assists:1}];
 const history=[{teamAIndex:0,teamBIndex:1,winnerSide:'B',goals:[{ownGoal:true}],penalties:[{}]}];
 const result=correctedRoundSummary({gameId:'g',groupId:'c',at:100,events:[{type:'club_record',metric:'goals',userIds:['a'],value:1,previousValue:0},{type:'club_milestone',metric:'rounds',threshold:100,total:100}]},stats,history,[{scorerId:'a',assisterId:'guest:x'},{scorerId:'a',assisterId:'guest:x'}],[],500);
 expect(result.stats).toEqual({goals:7,assists:1,rounds:1,ties:0,shootouts:1});expect(result.leaders.topScorers).toEqual({userIds:['a'],value:2});expect(result.pairHighlight?.goals).toBe(2);
 expect(result.events).toEqual([{type:'club_milestone',metric:'rounds',threshold:100,total:100}]);
});

test('newly sealed summaries rebuild records and milestones against the original comparison inputs, not later club totals',()=>{
 const input:RoundSummaryInput={gameId:'g',groupId:'c',at:100,now:200,players:[{userId:'a',goals:0,assists:0,rounds:2,wins:1,cleanSheets:0}],rounds:[],career:[{userId:'a',goals:9,assists:0,rounds:20,wins:10,cleanSheets:0,games:10}],club:{goals:49,assists:0,rounds:20,cleanSheets:0,shootoutRounds:0,evenings:10},records:{goals:{value:2,userIds:['b']}},personalBests:{a:{goals:1}},standings:[],basis:{since:0,eveningsCompared:9}};
 const sealed={...buildRoundSummary(input),correctionBasis:input};const stats=[{...input.players[0],goals:3}];
 const result=correctedRoundSummary(sealed,stats,[],[],[],500);
 expect(result.events).toContainEqual(expect.objectContaining({type:'club_record',metric:'goals',value:3,previousValue:2}));
 expect(result.correctionCoverage).toBe('full');
 const undo=correctedRoundSummary({...sealed,...result},input.players,[],[],[],600);expect(undo.events).toEqual(sealed.events);expect(undo.stats.goals).toBe(0);
});

test.each([['guest:x','b'],['a','guest:x'],['guest:x','guest:y']])('guest corrections credit only the evening and real participants, then undo exactly once: %s / %s',async(scorer,assister)=>{
 const w=world();w.put('games/g',{status:'finished',groupId:'c',startsAt:100,endedAt:200,players:['a','b'],guests:[{id:'x'},{id:'y'}]});
 w.put('roundSummaries/g',{gameId:'g',groupId:'c',at:100,events:[],basis:{since:0,eveningsCompared:5}});
 for(const id of ['guest:x','guest:y'])w.put('gamePlayerStats/g__'+id,{gameId:'g',userId:id,isGuest:true,goals:0,assists:0,rounds:1});
 const request={...w.request(),data:{...w.request().data,scorerId:scorer,assisterId:assister}};
 await w.add(request);await w.add(request);
 expect(w.rows.get('gamePlayerStats/g__'+scorer).goals).toBe(1);expect(w.rows.get('gamePlayerStats/g__'+assister).assists).toBe(1);
 expect(w.rows.get('roundSummaries/g').stats).toMatchObject({goals:1,assists:1});
 for(const id of ['guest:x','guest:y']){expect(w.rows.has('users/'+id)).toBe(false);expect(w.rows.has('communityPlayerStats/c__'+id)).toBe(false);expect(w.rows.has('eveningStandings/g__'+id)).toBe(false);}
 await w.remove(request);await w.remove(request);expect(w.rows.get('gamePlayerStats/g__'+scorer).goals).toBe(0);expect(w.rows.get('gamePlayerStats/g__'+assister).assists).toBe(0);expect(w.rows.get('communityStats/c').goals).toBe(0);
});

test('a fabricated or waitlisted guest cannot receive a retro correction',async()=>{
 const w=world();w.put('games/g',{status:'finished',groupId:'c',startsAt:100,players:['a','b'],guests:[{id:'waiting',waitlisted:true}]});
 for(const scorerId of ['guest:waiting','guest:unknown'])await expect(w.add({...w.request(),data:{...w.request().data,scorerId}})).rejects.toThrow('scorer is not on this game roster');
 expect(w.rows.get('communityStats/c').goals).toBe(0);
});
