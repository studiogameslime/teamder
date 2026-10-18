import fs from 'fs';
import path from 'path';
import vm from 'vm';
import ts from 'typescript';
import { savedRoundLive } from '../../src/utils/savedRoundView';
import { didEveningHappen } from '../../src/utils/eveningPlayed';
import type { LiveMatchState } from '../../src/types';
import type { RoundHistoryDoc } from '../../src/utils/eveningStats';

const history:RoundHistoryDoc={roundId:'game-3',teamA:['matan'],teamB:['other'],scoreA:2,scoreB:0,winnerSide:'A',at:900,
  goals:[0,1].map(()=>({scorerId:'matan',assisterId:'friend',ownGoal:false,team:'A',minute:2}))};
const cleared:LiveMatchState={phase:'roundRunning',assignments:{},benchOrder:[],scoreA:0,scoreB:0,goals:[],timerRunning:false};
const file=path.resolve(__dirname,'../../src/screens/AdvancedLiveMatchScreen.tsx');
const ast=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
function initializer(name:string){let text='';const visit=(n:ts.Node)=>{if(ts.isVariableDeclaration(n)&&n.name.getText(ast)===name)text=n.initializer!.getText(ast);ts.forEachChild(n,visit);};visit(ast);if(!text)throw Error(name);return text;}
function execute(name:string,context:any){vm.runInNewContext(ts.transpileModule('module.exports='+initializer(name),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);return context.module.exports;}

test('restores the saved score and both goals/assists without mutating cleared live data',()=>{
 const view=savedRoundLive(cleared,history);
 expect([view.scoreA,view.scoreB]).toEqual([2,0]);
 expect(view.goals?.map(g=>[g.scorerId,g.assisterId])).toEqual([['matan','friend'],['matan','friend']]);
 expect(new Set(view.goals?.map(g=>g.id)).size).toBe(2);
 expect(view.timerRunning).toBe(false);expect(cleared.scoreA).toBe(0);expect(cleared.goals).toEqual([]);
});
test.each([true,false])('closing a finished-game picker defers it without advancing identity (flow present: %s)',flow=>{
 const request={requiredCount:1},context:any={module:{exports:{}},fillFlowRef:{current:flow?{savedResult:{a:2,b:0}}:null},
  pendingSavedRound:true,setFillDeferred:jest.fn(),setBalancedRequest:jest.fn(),setFillRequest:jest.fn(),gameService:{nudgeRotationAfterFillCancel:jest.fn()}};
 context.fillRequest=request;
 execute('onFillCancel',context)();
 expect(context.setFillDeferred).toHaveBeenCalledWith(true);expect(context.setFillRequest).not.toHaveBeenCalled();
 expect(context.setBalancedRequest).not.toHaveBeenCalled();expect(context.gameService.nudgeRotationAfterFillCancel).not.toHaveBeenCalled();
});
test('closing a mid-game replacement does not manufacture a new game identity',()=>{
 const context:any={module:{exports:{}},fillFlowRef:{current:{keepClock:true}},pendingSavedRound:false,
  setFillDeferred:jest.fn(),setBalancedRequest:jest.fn(),setFillRequest:jest.fn(),gameService:{nudgeRotationAfterFillCancel:jest.fn()}};
 execute('onFillCancel',context)();expect(context.fillFlowRef.current).toBeNull();
 expect(context.gameService.nudgeRotationAfterFillCancel).not.toHaveBeenCalled();
});
test('a pending result uses only a snapshot of this exact game and round, never the cleared 0:0',()=>{
 const context:any={module:{exports:{}},pendingSavedRound:true,gameId:'evening',currentRoundKey:'game-3',live:cleared,
  savedRoundView:{gameId:'evening',key:'game-3',live:savedRoundLive(cleared,history)}};
 expect(execute('displayLive',context).scoreA).toBe(2);
 context.savedRoundView.key='game-2';expect(execute('displayLive',context)).toBeNull();
 context.savedRoundView.key='game-3';context.savedRoundView.gameId='another';expect(execute('displayLive',context)).toBeNull();
 context.pendingSavedRound=false;expect(execute('displayLive',context)).toBe(cleared);
});

test('a ready scoreboard can show 0:0 before timer creation but never replaces a pending saved result',()=>{
 const context:any={module:{exports:{}},displayLive:null,pendingSavedRound:false,rotationActive:true};
 expect(execute('scoreboardLive',context)).toMatchObject({phase:'roundReady',scoreA:0,scoreB:0});
 context.pendingSavedRound=true;expect(execute('scoreboardLive',context)).toBeNull();
 context.displayLive=savedRoundLive(cleared,history);
 expect(execute('scoreboardLive',context)).toBe(context.displayLive);
 context.displayLive=null;context.pendingSavedRound=false;context.rotationActive=false;
 expect(execute('scoreboardLive',context)).toBeNull();
});
test('goal entry is available before the first clock but stays blocked for unavailable rounds and viewers',()=>{
 const ready={phase:'roundReady',scoreA:0,scoreB:0};
 const context:any={module:{exports:{}},isAdmin:true,rotationActive:true,scoreboardLive:ready,pendingSavedRound:false,roundBusy:false,live:null,game:{status:'open'}};
 expect(execute('canEnterGoals',context)).toBe(true);
 for(const patch of [{isAdmin:false},{rotationActive:false},{scoreboardLive:null},{pendingSavedRound:true},{roundBusy:true},{live:{shootout:{kicks:[]}}},{game:{status:'finished'}},{game:{status:'cancelled'}}]){
   expect(execute('canEnterGoals',{...context,...patch,module:{exports:{}}})).toBe(false);
 }
 expect(execute('canEnterGoals',{...context,live:{timerRunning:false,scoreA:1,scoreB:0},module:{exports:{}}})).toBe(true);
});

test('continue reopens the saved proposal without another result commit; reload uses recovery',()=>{
 const context:any={module:{exports:{}},fillFlowRef:{current:{savedResult:{a:2,b:0}}},setFillDeferred:jest.fn(),resumeSavedRound:jest.fn()};
 execute('continuePendingRound',context)();expect(context.setFillDeferred).toHaveBeenCalledWith(false);expect(context.resumeSavedRound).not.toHaveBeenCalled();
 context.fillFlowRef.current=null;execute('continuePendingRound',context)();expect(context.resumeSavedRound).toHaveBeenCalledTimes(1);
});

function endPromptContext() {
 return {module:{exports:{}},gameId:'evening',currentRoundKey:'game-3',currentPlayingKey:'0:1',pendingSavedRound:false,
  rotation:{playing:[0,1],waiting:[2],round:3},live:{...cleared,scoreA:2,scoreB:1},
  endRoundPrompt:{gameId:'evening',roundKey:'game-3',playing:'0:1'},
  finalizingRef:{current:false},committingRef:{current:false},fillFlowRef:{current:null},
  winnerOpen:false,decisionOpen:false,shootoutOpen:false,setEndRoundPrompt:jest.fn(),
  onEndRound:jest.fn(),continuePendingRound:jest.fn(),logEvent:jest.fn(),AnalyticsEvent:{RoundEndPrompted:'prompt'}};
}
test('opening the result confirmation does not pause, save or advance the game',()=>{
 const context=endPromptContext();execute('confirmEndRound',context)();
 expect(context.setEndRoundPrompt).toHaveBeenCalledWith({gameId:'evening',roundKey:'game-3',playing:'0:1'});
 expect(context.onEndRound).not.toHaveBeenCalled();
 expect(context.continuePendingRound).not.toHaveBeenCalled();
});
test('accepting the current confirmation enters the existing result-saving flow',()=>{
 const context=endPromptContext();execute('acceptEndRound',context)();
 expect(context.setEndRoundPrompt).toHaveBeenCalledWith(null);
 expect(context.onEndRound).toHaveBeenCalledTimes(1);
});
test.each(['round','game','playing','pending','tie','shootout','missing-live'])('a stale end confirmation cannot save another result: %s',change=>{
 const context:any=endPromptContext();
 if(change==='round')context.currentRoundKey='game-4';
 if(change==='game')context.gameId='other-evening';
 if(change==='playing')context.currentPlayingKey='0:2';
 if(change==='pending')context.pendingSavedRound=true;
 if(change==='tie')context.live.scoreB=2;
 if(change==='shootout')context.live.shootout={kicks:[]};
 if(change==='missing-live')context.live=null;
 execute('acceptEndRound',context)();
 expect(context.onEndRound).not.toHaveBeenCalled();
});
test('a draw still goes directly to the existing tiebreaker flow',()=>{
 const context=endPromptContext();context.live.scoreB=2;execute('confirmEndRound',context)();
 expect(context.onEndRound).toHaveBeenCalledTimes(1);expect(context.setEndRoundPrompt).not.toHaveBeenCalled();
});

test('the first finish tap on an approved lineup without a clock enters the tie flow',()=>{
 const context:any=endPromptContext();context.live=null;
 execute('confirmEndRound',context)();
 expect(context.onEndRound).toHaveBeenCalledTimes(1);
 expect(context.setEndRoundPrompt).not.toHaveBeenCalled();
});

test('the result chooser stays open while a missing clock state is initialized',()=>{
 let callback='';const visit=(node:ts.Node)=>{
   if(ts.isCallExpression(node)&&node.expression.getText(ast)==='useEffect'&&node.arguments[0]?.getText(ast).includes('if(decisionOpen'))callback=node.arguments[0].getText(ast);
   ts.forEachChild(node,visit);
 };visit(ast);expect(callback).not.toBe('');
 const context:any={module:{exports:{}},live:null,rotation:{playing:[0,1]},pendingSavedRound:false,
   endRoundPrompt:null,decisionOpen:true,setDecisionOpen:jest.fn(),shootoutDecision:null,gameId:'g',currentRoundKey:'r',currentPlayingKey:'0:1'};
 context.roundLive=execute('roundLive',context);
 expect(context.roundLive).toMatchObject({phase:'roundReady',scoreA:0,scoreB:0,timerRunning:false});
 vm.runInNewContext(ts.transpileModule('module.exports='+callback,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
 context.module.exports();expect(context.setDecisionOpen).not.toHaveBeenCalled();
 context.roundLive.scoreB=1;context.module.exports();expect(context.setDecisionOpen).toHaveBeenCalledWith(false);
});

test('a manual evening finish follows the canonical policy even with no clock or goals',()=>{
 const context:any={module:{exports:{}},didEveningHappen,game:{status:'open',rotation:{playing:[0,1]}},live:null};
 expect(execute('wasPlayed',context)).toBe(true);
 context.game.playVerified=false;expect(execute('wasPlayed',context)).toBe(false);
});

test.each([2,3])('both-out cannot start with %s teams, even if a stale queue supplies two entries',count=>{
 const context:any={module:{exports:{}},rotation:{waiting:[2,3]},draftTeams:{teams:Array.from({length:count},(_,index)=>({index}))},appAlert:jest.fn()};
 execute('onDecideBothOut',context)();expect(context.appAlert).not.toHaveBeenCalled();
});
test('four teams with two waiting are resolved directly after inline confirmation',()=>{
 const context:any={module:{exports:{}},rotation:{waiting:[2,3],round:1},draftTeams:{teams:[0,1,2,3].map(index=>({index}))},
  appAlert:jest.fn(),teamName:(index:number)=>String(index),he:{shDecideBothOutConfirmTitle:'confirm',shDecideBothOutConfirmBody:(a:string,b:string)=>a+b,cancel:'cancel',shDecideBothOutConfirmOk:'ok'},
  setDecisionOpen:jest.fn(),logEvent:jest.fn(),AnalyticsEvent:{RoundTieDecision:'tie'},resolveTie:jest.fn(),gameId:'evening'};
 execute('onDecideBothOut',context)();expect(context.appAlert).not.toHaveBeenCalled();
 expect(context.resolveTie).toHaveBeenCalledWith('bothOut');
});
