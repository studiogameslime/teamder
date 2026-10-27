import fs from 'fs';
import ts from 'typescript';
import vm from 'vm';

const source = fs.readFileSync('src/services/useTimerFeedback.ts', 'utf8');
const compiled = ts.transpileModule(source.replace(/^import .*;\r?\n/gm, ''), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const paused = () => ({ phase: 'roundReady', assignments: {}, benchOrder: [], scoreA: 2, scoreB: 1,
  timerRunning: false, timerLastStartedAt: null, timerAccumulatedMs: 3000, timerEvents: [] });
function deferred<T=any>() {
  let resolve!: (value:T)=>void, reject!: (error:Error)=>void;
  const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});
  return {promise,resolve,reject};
}
function harness() {
  let ref:any,cleanup:(()=>void)|undefined,now=10000;
  const context:any={exports:{},serverNow:()=>now,observeCaughtError:jest.fn(),useState:()=>[0,jest.fn()],
    useRef:(value:any)=>ref??={current:value},useEffect:(effect:()=>any)=>{cleanup??=effect();}};
  vm.runInNewContext(compiled,context);
  return {render:(live:any,owner:string|null='game:owner:round')=>context.exports.useTimerFeedback(live,owner),
    setNow:(value:number)=>{now=value;},unmount:()=>cleanup?.()};
}

test('start responds before the delayed write; duplicate tap is synchronously blocked',async()=>{
  const h=harness(),live=paused(),d=deferred();const write=jest.fn(()=>d.promise);
  const view=h.render(live),work=view.run('start',write);
  expect(h.render(live)).toMatchObject({pending:true,visibleLive:{timerRunning:true,timerLastStartedAt:10000,timerAccumulatedMs:3000,scoreA:2}});
  expect(await view.run('pause',write)).toBe(false);expect(write).toHaveBeenCalledTimes(1);
  d.resolve({...live,timerRunning:true,timerLastStartedAt:10500});await expect(work).resolves.toBe(true);
  expect(h.render(live)).toMatchObject({pending:false,visibleLive:{timerRunning:true,timerLastStartedAt:10500}});
});

test('pause freezes immediately and reconciles to the committed accumulator without a stale-listener blink',async()=>{
  const h=harness(),live={...paused(),timerRunning:true,timerLastStartedAt:5000},d=deferred();
  const work=h.render(live).run('pause',()=>d.promise);
  h.setNow(12000);expect(h.render(live).visibleLive).toMatchObject({timerRunning:false,timerAccumulatedMs:8000});
  const confirmed={...live,timerRunning:false,timerLastStartedAt:null,timerAccumulatedMs:8500,timerEvents:[{type:'pause',at:10500}]};
  d.resolve(confirmed);await work;
  expect(h.render(live).visibleLive).toMatchObject({timerRunning:false,timerAccumulatedMs:8500});
  expect(h.render(confirmed).visibleLive).toBe(confirmed);
});

test('write failure restores the latest authoritative state and unlocks retry',async()=>{
  const h=harness(),live=paused(),d=deferred();const work=h.render(live).run('start',()=>d.promise);
  const failure=new Error('offline');d.reject(failure);await expect(work).rejects.toBe(failure);
  expect(h.render(live)).toMatchObject({pending:false,visibleLive:live});
  const retry=h.render(live).run('start',async()=>null);await expect(retry).rejects.toThrow('השעון אינו זמין');
  expect(h.render(live).pending).toBe(false);
});

test('a failed second action retains the earlier confirmed clock while the listener is delayed',async()=>{
  const h=harness(),live=paused();await h.render(live).run('start',async()=>({...live,timerRunning:true,timerLastStartedAt:10000}));
  const work=h.render(live).run('pause',async()=>{throw Error('offline');});await expect(work).rejects.toThrow();
  expect(h.render(live).visibleLive).toMatchObject({timerRunning:true,timerLastStartedAt:10000});
});

test('external timer changes win over preview and a late acknowledgement',async()=>{
  const h=harness(),live=paused(),d=deferred();const work=h.render(live).run('start',()=>d.promise);
  const external={...live,timerAccumulatedMs:7000,timerControlledBy:'other',timerEvents:[{type:'pause',at:10100}]};
  expect(h.render(external).visibleLive).toBe(external);
  d.resolve({...live,timerRunning:true,timerLastStartedAt:10000});await work;
  expect(h.render(external).visibleLive).toBe(external);
});

test.each(['game:other:round','game:owner:new-round',null])('context change to %s rejects late success and permits a new operation',async key=>{
  const h=harness(),live=paused(),d=deferred();const work=h.render(live).run('start',()=>d.promise);
  expect(h.render(live,key)).toMatchObject({pending:false,visibleLive:live});
  d.resolve({...live,timerRunning:true});await expect(work).resolves.toBe(false);
  expect(h.render(live,key).visibleLive).toBe(live);
});

test('unmount suppresses late errors and unconfirmed clock is not persisted',async()=>{
  const h=harness(),live=paused(),d=deferred();const work=h.render(live).run('start',()=>d.promise);
  h.unmount();d.reject(Error('offline'));await expect(work).resolves.toBe(false);
});

test('a pending first-start gate cannot start the timer after the screen context changes',async()=>{
  const h=harness(),live=paused(),gate=deferred(),write=jest.fn();
  const work=h.render(live).run('start',async(isCurrent:any)=>{
    await gate.promise;if(!isCurrent())return null;return write();
  });
  h.render(live,'different-game');gate.resolve(undefined);await expect(work).resolves.toBe(false);
  expect(write).not.toHaveBeenCalled();
});

function screenHandler(path:string,name:string) {
  const file=ts.createSourceFile(path,fs.readFileSync(path,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  let code='';function visit(n:ts.Node){if(ts.isVariableDeclaration(n)&&n.name.getText(file)===name)code=n.initializer!.getText(file);ts.forEachChild(n,visit);}visit(file);
  const feedback=jest.fn(async(_action:any,write:any)=>{await write(()=>true);return true;});
  const context:any={module:{exports:{}},gameId:'game',me:{id:'owner',name:'בעלים'},game:{status:'active'},live:{startedAt:1000},
    pendingSavedRound:false,fillFlowRef:{current:null},startingRef:{current:false},committingRef:{current:false},roundBusy:false,
    timerFeedback:{isPending:()=>false,run:feedback},gameService:{markGameStarted:jest.fn().mockResolvedValue(undefined),startTimer:jest.fn().mockResolvedValue(paused()),pauseTimer:jest.fn().mockResolvedValue(paused())},
    timerStarted:false,timerMs:0,isAdmin:true,currentRoundKey:'round',rotation:{round:2},draftTeams:null,perTeam:5,
    logEvent:jest.fn(),logError:jest.fn(),AnalyticsEvent:{},toast:{error:jest.fn()},appAlert:jest.fn(),he:{},__DEV__:false};
  vm.runInNewContext(ts.transpileModule('module.exports='+code,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
  return {context,run:context.module.exports,feedback};
}

const screens=['src/screens/LiveMatchScreen.tsx','src/screens/AdvancedLiveMatchScreen.tsx'];
test.each(screens)('later round start skips the extra evening-start request in %s',async path=>{
  const h=screenHandler(path,'onTimerStart');await h.run();
  expect(h.feedback).toHaveBeenCalled();expect(h.context.gameService.markGameStarted).not.toHaveBeenCalled();expect(h.context.gameService.startTimer).toHaveBeenCalledTimes(1);
});
test.each(screens)('first start preserves the season gate and does not start a blocked evening in %s',async path=>{
  const h=screenHandler(path,'onTimerStart');h.context.live={};const d=deferred();h.context.gameService.markGameStarted.mockReturnValue(d.promise);
  const work=h.run();expect(h.feedback).toHaveBeenCalled();expect(h.context.gameService.startTimer).not.toHaveBeenCalled();
  d.reject(Error('SEASON_CLOSING'));await work;expect(h.context.gameService.startTimer).not.toHaveBeenCalled();expect(h.context.appAlert).toHaveBeenCalled();
});
test.each(screens)('pause and resume use the responsive path and ignore pending taps in %s',async path=>{
  for(const [name,action] of [['onTimerPause','pause'],['onTimerResume','start']]){
    const h=screenHandler(path,name);await h.run();expect(h.feedback.mock.calls[0][0]).toBe(action);
    h.context.timerFeedback.isPending=()=>true;await h.run();expect(h.feedback).toHaveBeenCalledTimes(1);
  }
});
