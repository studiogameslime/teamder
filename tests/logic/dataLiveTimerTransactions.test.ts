import {roundSaveError} from '@/utils/roundSaveError';
import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';
import {roundDecisionContext} from '@/utils/roundDecision';
import { roundCommitKey } from '@/services/rotationEngine';
import { tallyWithout } from '@/utils/goalTally';

const source = fs.readFileSync('src/services/gameService.ts', 'utf8');
const file = ts.createSourceFile('gameService.ts', source, ts.ScriptTarget.Latest, true);
const helpers: string[] = [], methods: string[] = [];
function visit(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && ['changedTimerRound', 'timerMutationFields', 'mutateSharedTimer'].includes(node.name?.getText(file) ?? '')) helpers.push(node.getText(file));
  if (ts.isMethodDeclaration(node) && ['startTimer', 'pauseTimer', 'resetTimer'].includes(node.name.getText(file))) methods.push(node.getText(file));
  ts.forEachChild(node, visit);
}
visit(file);
const compiled = ts.transpileModule(helpers.join('\n') + '\nmodule.exports={' + methods.join(',') + '};', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const clone = <T>(value: T): T => structuredClone(value);
function initial() {
  return {id:'evening',status:'active',rotation:{roundInstanceId:'round-one',round:1},lastCommittedRoundId:undefined,
    liveMatch:{scoreA:1,scoreB:0,goals:[{id:'goal-one',team:'A',scorerId:'a'}],goalTally:{a:1,past:2},
      timerRunning:false,timerLastStartedAt:null,timerAccumulatedMs:0,timerEvents:[],activeIntervals:[]}} as any;
}
function harness(mock=false, value=initial()) {
  const state=clone(value), writes:any[]=[];
  let version=0,attempts=0,now=5000,beforeCommit:(()=>void)|undefined;
  const mutate=(change:(value:any)=>void)=>{change(state);version+=1;};
  const apply=(patch:Record<string,any>)=>{
    for(const [key,value] of Object.entries(patch)) {
      const parts=key.split('.');let target=state;
      for(const part of parts.slice(0,-1))target=target[part]??={};
      target[parts[parts.length-1]]=clone(value);
    }
  };
  const transaction=jest.fn(async(_db:any,callback:any)=>{
    for(let retry=0;retry<6;retry++) {
      attempts+=1;let readVersion=-1,patch:Record<string,any>|undefined;
      const result = await callback({get:async()=>{readVersion=version;const captured=clone(state);return{exists:()=>!!captured.id,data:()=>captured};},update:(_ref:any,next:Record<string,any>)=>{patch=next;}});
      if(beforeCommit&&patch){const hook=beforeCommit;beforeCommit=undefined;hook();}
      if(readVersion!==version)continue;
      if(patch){writes.push(clone(patch));apply(patch);version+=1;}
      return result;
    }
    throw new Error('Test transaction retry limit');
  });
  const directRead=jest.fn(()=>{throw new Error('Timer must read inside its transaction');});
  const directWrite=jest.fn(()=>{throw new Error('Timer must not use an unconditional write');});
  const context:any={module:{exports:{}},USE_MOCK_DATA:mock,mockGamesV2:[state],mockGame:{id:'another'},
    Date:{now:()=>now},serverNow:()=>now,roundCommitKey,tallyWithout,getFirebase:()=>({db:{}}),docs:{game:(id:string)=>({id})},
    runTransaction:transaction,getDoc:directRead,updateDoc:directWrite,logError:jest.fn(),__DEV__:false};
  vm.runInNewContext(compiled,context);
  return {state,writes,transaction,directRead,directWrite,service:context.module.exports,mutate,
    setNow:(value:number)=>{now=value;},beforeCommit:(hook:()=>void)=>{beforeCommit=hook;},attempts:()=>attempts};
}

test('timer mutations use the actual transaction path and retain the three-argument legacy API',async()=>{
  const h=harness();await h.service.startTimer('evening','manager','מנהל');
  expect(h.transaction).toHaveBeenCalledTimes(1);expect(h.directRead).not.toHaveBeenCalled();expect(h.directWrite).not.toHaveBeenCalled();
  expect(h.state.liveMatch).toMatchObject({timerRunning:true,timerLastStartedAt:5000,timerAccumulatedMs:0,timerEvents:[{type:'start',at:5000,byName:'מנהל'}]});
  expect(h.state.liveMatch.goals).toHaveLength(1);expect(h.state.liveMatch.scoreA).toBe(1);
});

test('two simultaneous starts create only one anchor and one event',async()=>{
  const h=harness();await Promise.all([h.service.startTimer('evening','one','אחד','round-one'),h.service.startTimer('evening','two','שניים','round-one')]);
  expect(h.writes).toHaveLength(1);expect(h.state.liveMatch.timerEvents).toHaveLength(1);expect(h.state.liveMatch.timerLastStartedAt).toBe(5000);
  expect(h.attempts()).toBe(3);
});

test.each([false,true])('timer returns the committed clock without another read, including idempotent writes (mock=%s)',async mock=>{
  const h=harness(mock);
  const started=await h.service.startTimer('evening','manager','מנהל','round-one');
  expect(started).toEqual(h.state.liveMatch);expect(started.timerLastStartedAt).toBe(5000);
  expect(await h.service.startTimer('evening','manager','מנהל','round-one')).toEqual(started);
  h.setNow(8000);const stopped=await h.service.pauseTimer('evening','manager','מנהל','round-one');
  expect(stopped).toEqual(h.state.liveMatch);expect(stopped.timerAccumulatedMs).toBe(3000);
  expect(await h.service.pauseTimer('evening','manager','מנהל','round-one')).toEqual(stopped);
  expect(h.directRead).not.toHaveBeenCalled();
});

test('two simultaneous pauses count the elapsed window once',async()=>{
  const g=initial();g.liveMatch={...g.liveMatch,timerRunning:true,timerLastStartedAt:1000,timerEvents:[{type:'start',at:1000}]};const h=harness(false,g);
  await Promise.all([h.service.pauseTimer('evening','one','אחד','round-one'),h.service.pauseTimer('evening','two','שניים','round-one')]);
  expect(h.writes).toHaveLength(1);expect(h.state.liveMatch.timerAccumulatedMs).toBe(4000);expect(h.state.liveMatch.activeIntervals).toEqual([{s:1000,e:5000}]);
  expect(h.state.liveMatch.timerEvents.filter((event:any)=>event.type==='pause')).toHaveLength(1);
});

test('a retried pause recalculates after another manager paused and resumed, without overlapping windows',async()=>{
  const g=initial();g.liveMatch={...g.liveMatch,timerRunning:true,timerLastStartedAt:1000,timerEvents:[{type:'start',at:1000}]};const h=harness(false,g);
  h.beforeCommit(()=>h.mutate(current=>{Object.assign(current.liveMatch,{timerRunning:true,timerLastStartedAt:4000,timerAccumulatedMs:1000,
    activeIntervals:[{s:1000,e:2000}],timerEvents:[{type:'start',at:1000},{type:'pause',at:2000},{type:'resume',at:4000}]});}));
  await h.service.pauseTimer('evening','manager','מנהל','round-one');
  expect(h.attempts()).toBe(2);expect(h.state.liveMatch.timerAccumulatedMs).toBe(2000);
  expect(h.state.liveMatch.activeIntervals).toEqual([{s:1000,e:2000},{s:4000,e:5000}]);
});

test('a retried start respects another start instead of overwriting its anchor',async()=>{
  const h=harness();h.beforeCommit(()=>h.mutate(current=>{Object.assign(current.liveMatch,{timerRunning:true,timerLastStartedAt:3000,timerEvents:[{type:'start',at:3000}]});}));
  await h.service.startTimer('evening','manager','מנהל','round-one');
  expect(h.writes).toHaveLength(0);expect(h.state.liveMatch.timerLastStartedAt).toBe(3000);expect(h.state.liveMatch.timerEvents).toHaveLength(1);
});

test.each(['startTimer','pauseTimer','resetTimer'])('%s rejects an outdated round before its first read',async method=>{
  const h=harness();h.state.rotation.roundInstanceId='round-next';
  await expect(h.service[method]('evening','manager','מנהל','round-one')).rejects.toMatchObject({code:'TIMER_CHANGED'});
  expect(h.writes).toHaveLength(0);expect(h.state.liveMatch.scoreA).toBe(1);
});

test.each([undefined,'round-one'])('a transaction retry cannot carry the previous round clock into the next round (expected=%s)',async expected=>{
  const g=initial();g.liveMatch.timerAccumulatedMs=7000;g.liveMatch.timerEvents=[{type:'pause',at:3000}];const h=harness(false,g);
  h.beforeCommit(()=>h.mutate(current=>{current.rotation={roundInstanceId:'round-next',round:2};current.liveMatch={...initial().liveMatch,scoreA:0,goals:[],timerAccumulatedMs:0};}));
  await expect(h.service.startTimer('evening','manager','מנהל',expected)).rejects.toMatchObject({code:'TIMER_CHANGED'});
  expect(h.writes).toHaveLength(0);expect(h.state.liveMatch.timerAccumulatedMs).toBe(0);expect(h.state.liveMatch.timerEvents).toEqual([]);
});

test('reset retries against newly added goals, clearing only the current-round badges and preserving earlier rounds',async()=>{
  const h=harness();h.beforeCommit(()=>h.mutate(current=>{current.liveMatch.goals.push({id:'goal-two',team:'B',scorerId:'b'});current.liveMatch.scoreB=1;current.liveMatch.goalTally.b=1;}));
  await h.service.resetTimer('evening','manager','מנהל','round-one');
  expect(h.attempts()).toBe(2);expect(h.state.liveMatch).toMatchObject({scoreA:0,scoreB:0,goals:[],goalTally:{past:2},timerAccumulatedMs:0,timerRunning:false});
  expect(h.state.liveMatch.goalTally.a??0).toBe(0);expect(h.state.liveMatch.goalTally.b??0).toBe(0);
});

test('reset closes the running window once and duplicate resets preserve the earlier activity',async()=>{
  const g=initial();g.liveMatch={...g.liveMatch,timerRunning:true,timerLastStartedAt:1000,activeIntervals:[{s:100,e:200}]};const h=harness(false,g);
  await h.service.resetTimer('evening','manager','מנהל','round-one');await h.service.resetTimer('evening','manager','מנהל','round-one');
  expect(h.writes).toHaveLength(1);expect(h.state.liveMatch.activeIntervals).toEqual([{s:100,e:200},{s:1000,e:5000}]);
});

test('a pause before the clock was started is a successful no-op',async()=>{
  const h=harness();await h.service.pauseTimer('evening','manager','מנהל','round-one');expect(h.writes).toHaveLength(0);
  expect(h.state.liveMatch.scoreA).toBe(1);expect(h.state.liveMatch.goals).toHaveLength(1);
});

test.each(['finished','cancelled'])('terminal evenings preserve legacy no-op behavior and reject a strict round action (%s)',async status=>{
  const g=initial();g.status=status;const h=harness(false,g);
  await h.service.startTimer('evening','manager','מנהל');
  await expect(h.service.resetTimer('evening','manager','מנהל','round-one')).rejects.toMatchObject({code:'TIMER_CHANGED'});
  expect(h.writes).toHaveLength(0);
});

test('the committed round cannot restart before its next lineup is prepared',async()=>{
  const g=initial();g.lastCommittedRoundId='round-one';const h=harness(false,g);
  await expect(h.service.startTimer('evening','manager','מנהל','round-one')).rejects.toMatchObject({code:'TIMER_CHANGED'});
  await h.service.startTimer('evening','manager','מנהל');expect(h.writes).toHaveLength(0);
});

test('the plain timer route works without rotation',async()=>{
  const g=initial();delete g.rotation;const h=harness(false,g);
  await h.service.startTimer('evening','manager','מנהל');h.setNow(6000);await h.service.pauseTimer('evening','manager','מנהל');
  expect(h.state.liveMatch.timerAccumulatedMs).toBe(1000);expect(h.state.liveMatch.timerEvents.map((event:any)=>event.type)).toEqual(['start','pause']);
});

test('demo and real timer calculations share the same fields and round guard',async()=>{
  const h=harness(true);await h.service.startTimer('evening','manager','מנהל','round-one');h.setNow(6000);await h.service.pauseTimer('evening','manager','מנהל','round-one');
  expect(h.state.liveMatch.timerAccumulatedMs).toBe(1000);expect(h.state.liveMatch.activeIntervals).toEqual([{s:5000,e:6000}]);expect(h.transaction).not.toHaveBeenCalled();
  h.state.rotation.roundInstanceId='round-next';await expect(h.service.resetTimer('evening','manager','מנהל','round-one')).rejects.toMatchObject({code:'TIMER_CHANGED'});
});

test.each(['pauseTimer','resetTimer'])('%s cannot alter a new round after a transaction conflict',async method=>{
  const g=initial();g.liveMatch.timerRunning=true;g.liveMatch.timerLastStartedAt=1000;const h=harness(false,g);
  h.beforeCommit(()=>h.mutate(current=>{current.rotation={roundInstanceId:'round-next',round:2};current.liveMatch={...initial().liveMatch,scoreA:0,scoreB:1,goals:[{id:'new-round-goal',team:'B',scorerId:'b'}],timerRunning:true,timerLastStartedAt:4000};}));
  await expect(h.service[method]('evening','manager','מנהל','round-one')).rejects.toMatchObject({code:'TIMER_CHANGED'});
  expect(h.writes).toHaveLength(0);expect(h.state.liveMatch.scoreB).toBe(1);expect(h.state.liveMatch.goals[0].id).toBe('new-round-goal');expect(h.state.liveMatch.timerLastStartedAt).toBe(4000);
});

test.each(['finished','cancelled'])('a round closed during a transaction retry is never restarted (%s)',async status=>{
  const h=harness();h.beforeCommit(()=>h.mutate(current=>{current.status=status;}));
  await expect(h.service.startTimer('evening','manager','מנהל','round-one')).rejects.toMatchObject({code:'TIMER_CHANGED'});
  expect(h.writes).toHaveLength(0);expect(h.state.liveMatch.timerRunning).toBe(false);
});

test('a failed offline transaction leaves data untouched and a later retry starts once',async()=>{
  const h=harness(),before=clone(h.state),failure=Object.assign(new Error('offline'),{code:'unavailable'});
  h.transaction.mockRejectedValueOnce(failure);
  await expect(h.service.startTimer('evening','manager','מנהל','round-one')).rejects.toBe(failure);
  expect(h.state).toEqual(before);expect(h.writes).toHaveLength(0);
  await h.service.startTimer('evening','manager','מנהל','round-one');
  expect(h.writes).toHaveLength(1);expect(h.state.liveMatch.timerEvents).toHaveLength(1);
});

test('missing documents cannot be created by a timer action',async()=>{
  const g=initial();g.id='';const h=harness(false,g);
  await h.service.startTimer('evening','manager','מנהל');
  await expect(h.service.startTimer('evening','manager','מנהל','round-one')).rejects.toMatchObject({code:'TIMER_CHANGED'});
  expect(h.writes).toHaveLength(0);
});

function endRoundContext(pause:jest.Mock) {
  const screen=ts.createSourceFile('AdvancedLiveMatchScreen.tsx',fs.readFileSync('src/screens/AdvancedLiveMatchScreen.tsx','utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  let callback='';function find(node:ts.Node){if(ts.isVariableDeclaration(node)&&node.name.getText(screen)==='onEndRound')callback=node.initializer!.getText(screen);ts.forEachChild(node,find);}find(screen);
  const context:any={module:{exports:{}},pendingSavedRound:false,fillFlowRef:{current:null},gameId:'evening',currentRoundKey:'round-one',me:{id:'manager',name:'מנהל'},
    timerFeedback:{isPending:()=>false},
    finalizingRef:{current:false},committingRef:{current:false},winnerOpen:false,decisionOpen:false,shootoutOpen:false,
    markBusy:jest.fn(),gameService:{pauseTimer:pause,prepareRoundResult:jest.fn().mockResolvedValue({outcome:null}),startTimer:jest.fn()},
    game:{id:'evening',status:'open',players:[],guests:[]},roundDecisionContext,
    rotation:{roundInstanceId:'round-one',playing:[0,1],waiting:[],loans:[]},live:{scoreA:0,scoreB:0,goals:[]},draftTeams:{teams:[]},captureRoundForResult:jest.fn(),setDecisionOpen:jest.fn(),
    roundSaveError,logError:jest.fn(),toast:{error:jest.fn()},he:{roundFinalizeFailed:'השמירה נכשלה'},__DEV__:false};
  vm.runInNewContext(ts.transpileModule('module.exports='+callback,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
  return{context,run:context.module.exports};
}

test('ending a stale round stops after the timer identity rejection instead of finalizing another round',async()=>{
  const failure=Object.assign(new Error('המשחק התחלף'),{code:'TIMER_CHANGED'});
  const {context,run}=endRoundContext(jest.fn().mockRejectedValue(failure));await run();
  expect(context.gameService.pauseTimer).toHaveBeenCalledWith('evening','manager','מנהל','round-one');
  expect(context.gameService.prepareRoundResult).not.toHaveBeenCalled();expect(context.toast.error).toHaveBeenCalled();
  expect(context.finalizingRef.current).toBe(false);expect(context.markBusy.mock.calls).toEqual([[1],[-1]]);
});

test('ending a current untimed round still reaches tie selection without starting the clock',async()=>{
  const {context,run}=endRoundContext(jest.fn().mockResolvedValue(undefined));await run();
  expect(context.gameService.prepareRoundResult).toHaveBeenCalledWith('evening','manager',undefined,undefined,false,undefined,
    expect.objectContaining({gameId:'evening',roundId:'round-one',playing:'0:1',fingerprint:expect.any(String)}));expect(context.setDecisionOpen).toHaveBeenCalledWith(true);
  expect(context.gameService.startTimer).not.toHaveBeenCalled();expect(context.finalizingRef.current).toBe(false);
});
