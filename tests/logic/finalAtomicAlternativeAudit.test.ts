import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';
import * as rotationEngine from '@/services/rotationEngine';
import {rosterOf as effectiveRosterOf} from '@/services/rotationEngine';
import {toGuestRosterId} from '@/types';
import {rotationWriteSource} from '@/services/rotationWriteSource';
import {roundDecisionContext,matchesRoundDecision} from '@/utils/roundDecision';
import {alternativeRoundFingerprint as clientFingerprint} from '@/utils/alternativeRoundDecision';
import {shootoutFingerprint} from '@/utils/shootoutDecision';
import {liveLineupFingerprint} from '@/utils/liveLineupFingerprint';
import {buildShootoutPenaltyPayload} from '@/utils/penaltyStats';
import {roundParticipantSides} from '../../functions/src/roundParticipants';
import {saveMockRoundHistory} from '@/utils/mockRoundHistory';
import {alternativeRoundFingerprint as serverFingerprint,liveRoundKey,matchesLiveRound} from '../../functions/src/liveRoundCommit';
import {buildRoundSides} from '../../functions/src/roundSides';
import {StatBatch,MAX_ROUND_BATCH_OPS} from '../../functions/src/statBatch';
import {commitRoundInOrder} from '../../functions/src/commitProtocol';
import {liveSeasonStamp} from '../../functions/src/liveSeasonStamp';
import {assertSeasonOpenForGame} from '../../functions/src/seasonLock';

const parse=(path:string)=>ts.createSourceFile(path,fs.readFileSync(path,'utf8'),ts.ScriptTarget.Latest,true);
const serviceTree=parse('src/services/gameService.ts'),screenTree=parse('src/screens/AdvancedLiveMatchScreen.tsx'),serverTree=parse('functions/src/index.ts');
function find(root:ts.Node,predicate:(node:ts.Node)=>boolean):ts.Node {
 let result:ts.Node|undefined;const visit=(node:ts.Node)=>{if(predicate(node))result=node;if(!result)ts.forEachChild(node,visit);};visit(root);if(!result)throw Error('Missing source node');return result;
}
const compile=(code:string)=>ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const method=(name:string)=>find(serviceTree,node=>ts.isMethodDeclaration(node)&&node.name.getText(serviceTree)===name).getText(serviceTree);
const arrow=(name:string)=>(find(screenTree,node=>ts.isVariableDeclaration(node)&&node.name.getText(screenTree)===name) as ts.VariableDeclaration).initializer!.getText(screenTree);
const serverExpression=(find(serverTree,node=>ts.isVariableDeclaration(node)&&node.name.getText(serverTree)==='commitRoundStats') as ts.VariableDeclaration).initializer!.getText(serverTree);
const clone=<T,>(value:T):T=>structuredClone(value);
function gameConverter() {
 const exports:any={};vm.runInNewContext(compile(fs.readFileSync('src/firebase/firestore.ts','utf8')),{exports,Date,
 require:(id:string)=>{if(id.endsWith('/joinDiagnosticId'))return require('@/utils/joinDiagnosticId');if(id.endsWith('/diagnosticJournal'))return require('@/services/diagnosticJournal');if(id==='@/services/diagnosticCallable')id='firebase/functions';return ({'firebase/firestore':{collection:()=>({withConverter:(converter:unknown)=>({converter})}),doc:(c:any,id:string)=>({...c,id})},'./config':{getFirebase:()=>({db:{}})},'@/types':{TEAM_SIZE_MIN:2,TEAM_SIZE_MAX:11}} as any)[id]??{};}});
 return exports.docs.game('g').converter;
}
function board(size=4) {
 return {id:'g',createdBy:'manager',groupId:'club',status:'open',format:`${size}v${size}`,players:Array.from({length:size*4},(_,i)=>`p${i}`),guests:[{id:'visitor',name:'אורח',addedBy:'manager',createdAt:1}],
 rotation:{round:3,roundInstanceId:'r3',roundInstanceRound:3,playing:[1,2],waiting:[0,3],loans:[],wins:{},updatedAt:1},
 draftTeams:{teams:[0,1,2,3].map(index=>({index,captainId:`p${index*size}`,playerIds:Array.from({length:size},(_,i)=>`p${index*size+i}`),colorKey:['red','blue','green','white'][index]}))},
 liveMatch:{phase:'roundReady',scoreA:0,scoreB:0,goals:[],timerRunning:false,timerAccumulatedMs:0,shootout:{firstTeam:'A',keeperA:null,keeperB:`p${size*2}`,kicks:[{id:'kick1',team:'A',kickerId:`p${size}`,keeperId:`p${size*2}`,scored:true,outcome:'goal',at:1}]}},
 } as any;
}

/** Complete callable, actual client methods and converter. Only transports are
 * replaced. The fake batch applies NOTHING until all preconditions pass. */
function world(mock=false,legacyServer=false,size=4) {
 const documents=new Map<string,any>([['games/g',board(size)],['groups/club',{adminIds:['manager']}]]),versions=new Map<string,number>();
 let failBatch=false,loseAck=false,mutateBeforeBatch:((game:any)=>void)|undefined,throwMockHistory=false;
 const history:any={};const commits:any[][]=[];const payloads:any[]=[];const converter=gameConverter();
 const state=()=>documents.get('games/g');
 const read=()=>({...converter.fromFirestore({id:'g',data:()=>clone(state())}),matches:[]});
 function merge(target:any,patch:any) {for(const [key,value] of Object.entries(patch) as [string,any][]) {
  const parts=key.split('.');let parent=target;for(const part of parts.slice(0,-1))parent=parent[part]??={};const last=parts.at(-1)!;
  if(value?.__delete)delete parent[last];else if(value?.__increment!==undefined)parent[last]=(parent[last]??0)+value.__increment;
  else if(value&&typeof value==='object'&&!Array.isArray(value))merge(parent[last]??={},value);else parent[last]=clone(value);
 }}
 const ref=(path:string):any=>({path,collection:(name:string)=>collection(`${path}/${name}`),
  get:async()=>{const value=clone(documents.get(path));const version=versions.get(path)??1;return {exists:documents.has(path),ref:ref(path),updateTime:version,createTime:{toMillis:()=>2000},data:()=>value,get:(key:string)=>value?.[key]};},
  update:async(patch:any)=>{merge(documents.get(path),patch);versions.set(path,(versions.get(path)??1)+1);},
  create:async(data:any)=>{if(documents.has(path))throw Object.assign(Error('exists'),{code:6});documents.set(path,clone(data));},
 });
 const collection=(path:string):any=>({doc:(id:string)=>ref(`${path}/${id}`)});
 const db={collection,batch:()=>{const writes:any[]=[];const batch:any={
  create:(reference:any,data:any)=>{writes.push({kind:'create',reference,data});return batch;},
  set:(reference:any,data:any)=>{writes.push({kind:'set',reference,data});return batch;},
  update:(reference:any,data:any,precondition:any)=>{writes.push({kind:'update',reference,data,precondition});return batch;},
  commit:async()=>{
   if(mutateBeforeBatch){mutateBeforeBatch(state());versions.set('games/g',(versions.get('games/g')??1)+1);mutateBeforeBatch=undefined;}
   if(failBatch)throw Error('unavailable before atomic commit');
   for(const write of writes){if(write.kind==='create'&&documents.has(write.reference.path))throw Object.assign(Error('exists'),{code:6});
    if(write.precondition&&write.precondition.lastUpdateTime!==(versions.get(write.reference.path)??1))throw Object.assign(Error('stale version'),{code:9});}
   for(const write of writes){const value=documents.get(write.reference.path)??{};merge(value,write.data);documents.set(write.reference.path,value);versions.set(write.reference.path,(versions.get(write.reference.path)??1)+1);}
   commits.push(writes);
  }};return batch;}};
 class HttpsError extends Error{constructor(public code:string,message:string){super(message);}}
 const server=vm.runInNewContext(compile(`(${serverExpression})`),{onCall:(_:unknown,handler:any)=>handler,ENFORCE_APP_CHECK:false,db,HttpsError,
 admin:{firestore:{FieldValue:{increment:(n:number)=>({__increment:n}),delete:()=>({__delete:true})}}},
 liveRoundKey,matchesLiveRound,buildRoundSides,roundParticipantSides,StatBatch,MAX_ROUND_BATCH_OPS,commitRoundInOrder,liveSeasonStamp,assertSeasonOpenForGame,
 isReal:(id:string)=>!id.startsWith('guest:'),console:{log(){},error(){}},Date});
 const call=async(input:any)=>{payloads.push(clone(input));const request=clone(input);if(legacyServer)delete request.alternativeDecision;
  const data=await server({auth:{uid:'manager'},data:request});if(loseAck){loseAck=false;throw Error('lost acknowledgement');}return {data};};
 const mockGame=state();const context:any={module:{exports:{}},...rotationEngine,effectiveRosterOf,toGuestRosterId,rotationWriteSource,matchesRoundDecision,roundDecisionContext,shootoutFingerprint,
 alternativeRoundFingerprint:clientFingerprint,liveLineupFingerprint,buildShootoutPenaltyPayload,roundParticipantSides,
 USE_MOCK_DATA:mock,mockGamesV2:[mockGame],mockGame:{id:'other'},mockRoundHistory:history,
 saveMockRoundHistory:(...args:any[])=>{if(throwMockHistory)throw Error('history unavailable');return (saveMockRoundHistory as any)(...args);},
 getFirebase:()=>({functions:{}}),require:(name:string)=>{if(name.endsWith('/joinDiagnosticId'))return require('@/utils/joinDiagnosticId');if(name.endsWith('/diagnosticJournal'))return require('@/services/diagnosticJournal');if(name==='@/services/diagnosticCallable')name='firebase/functions';return name==='firebase/functions'?{httpsCallable:()=>call}:{};},
 playersPerTeamFor:()=>size,effFillMode:()=> 'off',logError:jest.fn(),__DEV__:false,Date,console,setTimeout,clearTimeout};
 vm.runInNewContext(compile(`module.exports={${method('_commitRoundStatsAndClear')},${method('prepareRoundResult')}};`),context);
 const service=context.module.exports;service.getGameById=jest.fn(async()=>read());service.clearShootout=jest.fn(()=>{throw Error('must not pre-clear');});
 const original=read();const decision:any={gameId:'g',roundId:'r3',playing:'1:2',fingerprint:shootoutFingerprint(original.liveMatch.shootout),roundDecision:roundDecisionContext(original),alternativeFingerprint:clientFingerprint(original)};
 const scope:any={module:{exports:{}},gameId:'g',me:{id:'manager'},game:original,rotation:original.rotation,draftTeams:original.draftTeams,live:original.liveMatch,
 roundDecisionContext,roundCommitKey:rotationEngine.roundCommitKey,shootoutFingerprint,alternativeRoundFingerprint:clientFingerprint,roundBusy:false,pendingSavedRound:false,
 shootoutDecision:decision,setShootoutDecision:jest.fn(),setShootoutOpen:jest.fn(),gameService:service,finalizingRef:{current:false},committingRef:{current:false},fillFlowRef:{current:null},
 markBusy:jest.fn(),captureRoundForResult:jest.fn(),beginFillFlow:jest.fn(),setWinnerOpen:jest.fn(),setDecisionOpen:jest.fn(),logEvent:jest.fn(),logError:jest.fn(),AnalyticsEvent:{},
 toast:{error:jest.fn()},roundSaveError:(error:Error)=>error.message,he:{roundFinalizeFailed:'כשל'},__DEV__:false,timerMs:0};
 function callback(name:'onTieWinner'|'resolveTie'){vm.runInNewContext(compile(`module.exports=${arrow(name)};`),scope);return scope.module.exports;}
 const invoke=(mode:'manual'|'bothOut'='manual')=>callback(mode==='manual'?'onTieWinner':'resolveTie')(mode==='manual'?2:'bothOut');
 return {state,read,documents,versions,history,payloads,commits,service,decision,scope,invoke,
  rawCall:(data:any)=>server({auth:{uid:'manager'},data}),
  reconsider:()=>{vm.runInNewContext(compile(`module.exports=${arrow('onChangeShootoutDecision')};`),scope);scope.module.exports();},
  legacyClear:async()=>{const c={...context,module:{exports:{} as any}};vm.runInNewContext(compile(`module.exports={${method('clearShootout')}};`),c);await c.module.exports.clearShootout('g',decision);},
  fail:(on=true)=>{failBatch=on;throwMockHistory=on;},lostAck:()=>{loseAck=true;},mutate:(fn:(game:any)=>void)=>{mutateBeforeBatch=fn;},
  prepare:(side:'A'|'B'='B',mode?:'bothOut'|'veteranOut')=>service.prepareRoundResult('g','manager',mode?undefined:side,mode,false,decision,decision.roundDecision),
 };
}

test('the retained legacy two-write sequence reproduces the original loss when the following result fails',async()=>{
 const x=world(true);expect(x.state().liveMatch.shootout.kicks).toHaveLength(1);await x.legacyClear();x.fail();
 await expect(x.service.prepareRoundResult('g','manager','B')).rejects.toThrow('history unavailable');
 expect(x.state().liveMatch.shootout).toBeUndefined();expect(x.history.g??[]).toHaveLength(0);
});

test('the actual return-to-choice callback captures the whole decision without deleting or committing a kick',()=>{
 const x=world();const before=clone(x.state());x.reconsider();expect(x.state()).toEqual(before);expect(x.payloads).toHaveLength(0);
 expect(x.scope.setShootoutDecision).toHaveBeenCalledWith(x.decision);expect(x.scope.setDecisionOpen).toHaveBeenCalledWith(true);
});
test('two simultaneous confirmations share the screen latch and write one atomic result',async()=>{
 const x=world();await Promise.all([x.invoke(),x.invoke()]);expect(x.payloads).toHaveLength(1);expect(x.commits).toHaveLength(1);
 expect(x.scope.beginFillFlow).toHaveBeenCalledTimes(1);expect(x.service.clearShootout).not.toHaveBeenCalled();
});

test.each([false,true])('a confirmed alternative keeps all kicks until its whole result succeeds (mock %s)',async mock=>{
 const x=world(mock);const before=clone(x.state());x.fail();await x.invoke();
 expect(x.service.clearShootout).not.toHaveBeenCalled();expect(x.state()).toEqual(before);expect(x.commits).toHaveLength(0);expect(x.scope.toast.error).toHaveBeenCalledTimes(1);
 x.fail(false);await x.invoke();expect(x.scope.beginFillFlow).toHaveBeenCalledTimes(1);expect(x.state().liveMatch.shootout).toBeUndefined();
 const saved=mock?x.history.g[0]:x.documents.get('games/g/roundHistory/r3');expect(saved.penalties).toEqual([]);expect(saved.winnerSide).toBe('B');
 if(!mock){expect(x.commits).toHaveLength(1);expect(x.payloads[0].penalties).toEqual([]);expect(x.documents.get('users/p8').stats.penSaved??0).toBe(0);}
});
test.each([false,true])('both-out preserves the same atomic contract (mock %s)',async mock=>{
 const x=world(mock);await x.invoke('bothOut');expect(x.scope.toast.error).not.toHaveBeenCalled();expect(x.scope.beginFillFlow).toHaveBeenCalledTimes(1);
 const saved=mock?x.history.g[0]:x.documents.get('games/g/roundHistory/r3');expect(saved.winnerSide).toBe('tie');expect(saved.penalties).toEqual([]);
});
test.each([4,7,11])('a %s-a-side alternative fits one atomic server batch with no penalty credit',async size=>{
 const x=world(false,false,size);await x.prepare();const history=x.documents.get('games/g/roundHistory/r3');
 expect(history.teamA).toHaveLength(size);expect(history.teamB).toHaveLength(size);expect(history.penalties).toEqual([]);
 expect(x.commits).toHaveLength(1);expect(x.commits[0].length).toBeLessThanOrEqual(MAX_ROUND_BATCH_OPS);
 for(const id of [...history.teamA,...history.teamB]){const row=x.documents.get(`gamePlayerStats/g__${id}`);expect(row.rounds).toBe(1);expect(row.penFaced??0).toBe(0);expect(row.penScored??0).toBe(0);}
});
test.each(['missing-goals','missing-lineup','not-empty','missing-fingerprint','conflicting-resolution'])('the actual callable rejects %s in an alternative without writing',async invalid=>{
 const source=world();await source.prepare();const payload=clone(source.payloads[0]);const x=world();
 if(invalid==='missing-goals')delete payload.liveGoalIds;if(invalid==='missing-lineup')delete payload.liveLineupFingerprint;
 if(invalid==='not-empty')payload.penalties=[{kickerId:'p4',scored:true}];if(invalid==='missing-fingerprint')payload.alternativeDecision.fingerprint=null;
 if(invalid==='conflicting-resolution')payload.tieResolution='bothOut';
 await expect(x.rawCall(payload)).rejects.toMatchObject({code:'invalid-argument'});expect(x.commits).toHaveLength(0);expect(x.state().liveMatch.shootout.kicks).toHaveLength(1);
});
test.each(['first-side','keeper','kick-id','kick-time','base','guest'])('the actual callable independently refuses a changed %s behind the client snapshot',async change=>{
 const source=world();await source.prepare();const payload=clone(source.payloads[0]);const x=world(),g=x.state();
 if(change==='first-side')g.liveMatch.shootout.firstTeam='B';if(change==='keeper')g.liveMatch.shootout.keeperB='p9';
 if(change==='kick-id')g.liveMatch.shootout.kicks[0].id='another';if(change==='kick-time')g.liveMatch.shootout.kicks[0].at=99;
 if(change==='base')g.rotation.baseTeams=[{index:1,playerIds:['p4']}];if(change==='guest')g.guests[0].waitlisted=true;
 const before=clone(g);await expect(x.rawCall(payload)).rejects.toMatchObject({code:'failed-precondition'});expect(x.state()).toEqual(before);expect(x.commits).toHaveLength(0);
});
test('a lost acknowledgement retries the original receipt once, without resurrecting kicks or duplicating statistics',async()=>{
 const x=world();x.lostAck();await expect(x.prepare()).rejects.toThrow('lost acknowledgement');expect(x.commits).toHaveLength(1);
 expect(x.state().liveMatch.shootout).toBeUndefined();await expect(x.prepare()).resolves.toMatchObject({outcome:'B'});
 expect(x.commits).toHaveLength(1);expect(x.documents.get('gamePlayerStats/g__p8').rounds).toBe(1);
 await expect(x.prepare('A')).rejects.toThrow('הכרעה אחרת');expect(x.commits).toHaveLength(1);
});
test.each([false,true])('a different fingerprint or tie decision cannot reuse an alternative receipt (mock %s)',async mock=>{
 const x=world(mock);await x.prepare(undefined,'bothOut');const before=clone(x.state());
 await expect(x.prepare(undefined,'veteranOut')).rejects.toThrow('הכרעה אחרת');
 x.decision.alternativeFingerprint+='changed';await expect(x.prepare(undefined,'bothOut')).rejects.toThrow('הכרעה אחרת');
 expect(x.state()).toEqual(before);expect(mock?x.history.g:x.commits).toHaveLength(1);
});
test('a completed both-out demo resumes from its saved resolution after the original screen is lost',async()=>{
 const x=world(true);await x.prepare(undefined,'bothOut');
 await expect(x.service.prepareRoundResult('g','manager','A',undefined,true)).resolves.toMatchObject({outcome:'tie'});
 expect(x.history.g).toHaveLength(1);
});
test('a retry after another round starts does not erase its series or commit it under the old decision',async()=>{
 const x=world();x.lostAck();await expect(x.prepare()).rejects.toThrow();x.state().rotation.roundInstanceId='r4';x.state().rotation.round=4;
 x.state().liveMatch.shootout={firstTeam:'B',kicks:[{id:'new',team:'B',kickerId:'p8',keeperId:'p4',scored:false,outcome:'miss',at:2}]};
 const before=clone(x.state());await expect(x.prepare()).rejects.toThrow();expect(x.state()).toEqual(before);expect(x.commits).toHaveLength(1);
});
test.each([false,true])('even a direct writer retry after advancing returns its old receipt without clearing the new series (mock %s)',async mock=>{
 const x=world(mock);await x.prepare();x.state().rotation.roundInstanceId='r4';x.state().rotation.round=4;
 x.state().liveMatch.shootout={firstTeam:'B',kicks:[{id:'new',team:'B',kickerId:'p8',keeperId:'p4',scored:false,outcome:'miss',at:2}]};
 const before=clone(x.state());await expect(x.service._commitRoundStatsAndClear('g',x.scope.live,x.scope.rotation,x.scope.draftTeams,'B',undefined,
  {fingerprint:x.decision.alternativeFingerprint,emptySeries:false})).resolves.toMatchObject({winnerSide:'B'});
 expect(x.state()).toEqual(before);expect(mock?x.history.g:x.commits).toHaveLength(1);
});
test.each(['kick','score','player','guest','lineup','captain','waiting','playing','round','terminal','base','fill-policy'])('a changed %s before confirmation refuses the original decision without deletion',async change=>{
 const x=world();const g=x.state();if(change==='kick')g.liveMatch.shootout.kicks[0].outcome='miss';if(change==='score')g.liveMatch.scoreA=1;
 if(change==='player')g.players.pop();if(change==='guest')g.guests[0].waitlisted=true;if(change==='lineup')g.draftTeams.teams[1].playerIds.reverse();
 if(change==='captain')g.draftTeams.teams[1].captainId='p5';if(change==='waiting')g.rotation.waiting.reverse();if(change==='playing')g.rotation.playing.reverse();
 if(change==='round')g.rotation.roundInstanceId='r4';if(change==='terminal')g.status='finished';
 if(change==='base')g.rotation.baseTeams=[{index:0,playerIds:['p0']}];if(change==='fill-policy')g.draftTeams.fillMode='permanent';
 const before=clone(g);
 await expect(x.prepare()).rejects.toThrow();expect(x.state()).toEqual(before);expect(x.commits).toHaveLength(0);
});
test.each(['goal','lineup','kick','clock'])('a concurrent %s after the server read rejects the entire batch',async change=>{
 const x=world();x.mutate(g=>{if(change==='goal'){g.liveMatch.scoreA=1;g.liveMatch.goals=[{id:'late',team:'A'}];}
 if(change==='lineup')g.draftTeams.teams[1].playerIds.reverse();if(change==='kick')g.liveMatch.shootout.kicks.push({id:'late',team:'B',scored:false});
 if(change==='clock')g.liveMatch.timerAccumulatedMs=2;});await expect(x.prepare()).rejects.toThrow('stale version');
 expect(x.commits).toHaveLength(0);expect(x.documents.has('games/g/committedRounds/r3')).toBe(false);expect(x.state().liveMatch.shootout).toBeDefined();
});
test('clock progress before the authoritative read leaves the decision valid and never requires a running timer',async()=>{
 const x=world();x.state().status='active';Object.assign(x.state().liveMatch,{timerRunning:false,timerAccumulatedMs:90000});
 await expect(x.prepare()).resolves.toMatchObject({outcome:'B'});expect(x.commits).toHaveLength(1);
});
test('an old server refuses a non-empty alternative without clearing the series',async()=>{
 const x=world(false,true);await expect(x.prepare()).rejects.toThrow();expect(x.commits).toHaveLength(0);expect(x.state().liveMatch.shootout.kicks).toHaveLength(1);
});
test('an old server that committed an empty series without an echo is accepted only with its real receipt',async()=>{
 const x=world(false,true);x.state().liveMatch.shootout.kicks=[];const current=x.read();Object.assign(x.decision,{fingerprint:shootoutFingerprint(current.liveMatch.shootout),roundDecision:roundDecisionContext(current),alternativeFingerprint:clientFingerprint(current)});
 await expect(x.prepare()).resolves.toMatchObject({outcome:'B'});expect(x.commits).toHaveLength(1);
 expect(x.state().lastCommittedRoundId).toBe('r3');expect(x.documents.get('games/g/roundHistory/r3').penalties).toEqual([]);
});
test('retrying an empty-series legacy write after a lost ACK still reads its original receipt once',async()=>{
 const x=world(false,true);x.state().liveMatch.shootout.kicks=[];const current=x.read();Object.assign(x.decision,{fingerprint:shootoutFingerprint(current.liveMatch.shootout),roundDecision:roundDecisionContext(current),alternativeFingerprint:clientFingerprint(current)});
 x.lostAck();await expect(x.prepare()).rejects.toThrow('lost acknowledgement');await expect(x.prepare()).resolves.toMatchObject({outcome:'B'});
 expect(x.commits).toHaveLength(1);expect(x.documents.get('gamePlayerStats/g__p8').rounds).toBe(1);
});
test.each([{}, {keeperId:null,at:null,scored:false},{keeperId:'',at:0},{keeperId:'p8',scored:true,at:7}])('wire fingerprints match direct legacy kick fields %j and the real converter',fields=>{
 const x=world();x.state().liveMatch.shootout.kicks=[{id:'legacy',team:'A',kickerId:'p4',...fields}];
 expect(serverFingerprint(x.state())).toBe(clientFingerprint(x.state()));expect(serverFingerprint(x.state())).toBe(clientFingerprint(x.read()));
});
test('wire fingerprints ignore object key order and timer ticks while preserving all series identities',()=>{
 const g=board();const first=serverFingerprint(g);Object.assign(g.liveMatch,{timerRunning:true,timerLastStartedAt:999,timerAccumulatedMs:777});
 expect(clientFingerprint(g)).toBe(first);const reversed={...g,rotation:Object.fromEntries(Object.entries(g.rotation).reverse())};expect(serverFingerprint(reversed)).toBe(first);
 g.liveMatch.shootout.kicks[0].id='different';expect(serverFingerprint(g)).not.toBe(first);
});
test('wire parity includes normalized draft and rotation history without depending on map key order',()=>{
 const x=world();Object.assign(x.state().rotation,{baseTeams:[{index:1,playerIds:['p4','p5']}],fillUsage:{p4:{games:1,fills:0,lastRound:2}},lastRoundWinners:['p4'],lastRoundLosers:['p8'],lastRoundAt:5});
 Object.assign(x.state().draftTeams,{fillMode:'permanent',originalTeams:clone(x.state().draftTeams.teams),leftHome:[{playerId:'p2',homeTeam:0,at:3}]});
 const before=serverFingerprint(x.state());expect(clientFingerprint(x.read())).toBe(before);
 x.state().rotation.fillUsage.p4={lastRound:2,games:1,fills:0};expect(serverFingerprint(x.state())).toBe(before);
});
