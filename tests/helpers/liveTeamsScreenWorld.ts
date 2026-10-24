import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';
import * as engine from '@/services/rotationEngine';
import { liveTeamsChanged, liveTeamsEditContext } from '@/utils/liveTeamsEdit';
import { liveTeamsFixture, liveTeamsWorld } from './liveTeamsWorld';

const ast=ts.createSourceFile('screen.tsx',fs.readFileSync('src/screens/AdvancedLiveMatchScreen.tsx','utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const names=new Set(['canEditLiveTeams','openLiveTeamsEditor','saveLiveTeamsEditor','beginFillFlow','advanceFillFlow','onFillConfirm','onBalancedConfirm','onFillCancel']);
const functions:string[]=[];let permission='';
const walk=(node:ts.Node)=>{if(ts.isVariableDeclaration(node)&&names.has(node.name.getText(ast))){const name=node.name.getText(ast),value=node.initializer!.getText(ast);if(name==='canEditLiveTeams')permission=value;else functions.push(`var ${name} = ${value};`);}ts.forEachChild(node,walk);};walk(ast);
const compiled=ts.transpileModule(functions.join('\n')+`\nvar checkPermission=()=>(${permission});`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;

/** Invoke the actual screen handlers against the full service and versioned storage. */
export function liveTeamsScreenWorld(initial=liveTeamsFixture()){
  const world=liveTeamsWorld(false,initial),board=world.read(),pending:Promise<any>[]=[];
  const service={...world.service,saveLiveTeamsEdit:jest.fn((...args:any[])=>{const p=world.service.saveLiveTeamsEdit(...args);pending.push(p);return p;}),prepareLiveTeamsEdit:jest.fn((...args:any[])=>world.service.prepareLiveTeamsEdit(...args))};
  const context:any={...engine,Math:Object.assign(Object.create(Math),{random:()=>0.75}),__DEV__:false,console,
    gameId:'audit',me:{id:'owner',name:'מנהל'},game:board,rotation:board.rotation,draftTeams:board.draftTeams,myCommunities:[],
    teamsEditor:{game:board,expected:liveTeamsEditContext(board)},canEditLiveTeams:true,
    currentRoundKey:engine.roundCommitKey(board.rotation!),pendingSavedRound:false,roundBusy:false,ending:false,isAdmin:true,
    winnerOpen:false,decisionOpen:false,shootoutOpen:false,swapOpen:false,endRoundPrompt:null,endOpen:false,
    startingRef:{current:false},committingRef:{current:false},finalizingRef:{current:false},homeActionRef:{current:false},
    fillFlowRef:{current:null},savedRoundViewRef:{current:{gameId:'audit',key:engine.roundCommitKey(board.rotation!),live:board.liveMatch}},
    fillRequest:null,balancedRequest:null,busyCount:0,gameService:service,liveTeamsChanged,liveTeamsEditContext,
    teamName:(i:number)=>`קבוצה ${i}`,teamColor:()=> '#123456',resolveFillPlayer:(id:string)=>({id,name:id}),
    AnalyticsEvent:new Proxy({},{get:(_obj,key)=>key}),logEvent:jest.fn(),logError:jest.fn(),observeCaughtError:jest.fn(),successHaptic:jest.fn(),
    toast:{success:jest.fn(),error:jest.fn(),info:jest.fn()},he:{rotationFillNoDonor:'אין משלימים'},
  };
  context.markBusy=(delta:number)=>{context.busyCount+=delta;context.roundBusy=context.busyCount>0;};
  for(const name of ['FillRequest','BalancedRequest','FillDeferred','TeamsEditor','TeamsEditError','GoalRequest','ShootoutDecision','ShootoutOpen','DecisionOpen','WinnerOpen','SavedRoundView']){
    const field=name[0].toLowerCase()+name.slice(1);context[`set${name}`]=jest.fn((value:any)=>{context[field]=value;});
  }
  vm.runInNewContext(compiled,context);
  const settle=async()=>{await Promise.allSettled(pending);await Promise.resolve();};
  return{world,context,service,settle,queueEvents:()=>context.logEvent.mock.calls.filter((args:any[])=>args[0]==='RotationQueueReordered')};
}
