import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';
import {rosterOf} from '@/services/rotationEngine';
import {restoreTargetTeam} from '@/utils/restoreTarget';

function fixture(mock=false) {
  const ast=ts.createSourceFile('gameService.ts',fs.readFileSync('src/services/gameService.ts','utf8'),ts.ScriptTarget.Latest,true);
  const methods:string[]=[];
  function visit(node:ts.Node){if(ts.isMethodDeclaration(node)&&['markPlayerWentHome','restorePlayer','retireEmptyTeam'].includes(node.name.getText(ast)))methods.push(node.getText(ast));ts.forEachChild(node,visit);}
  visit(ast);
  const state:any={id:'audit',status:'active',format:'4x4',updatedAt:1,players:['a','b','c','d','e','f'],guests:[],
    draftTeams:{teams:[{index:0,playerIds:['a','b'],colorKey:'red'},{index:1,playerIds:['c','d'],colorKey:'blue'},{index:2,playerIds:['e','f'],colorKey:'green'}],leftHome:[]},
    rotation:{playing:[0,1],waiting:[2],loans:[],round:3,roundInstanceId:'three',wins:{0:1}},liveMatch:{scoreA:2,scoreB:1,timerRunning:true,timerAccumulatedMs:123,goals:[{id:'kept'}]}};
  let concurrent:(()=>void)|undefined;
  const patches:any[]=[];
  const updateGameDoc=jest.fn(async(_id:string,patch:any)=>{Object.assign(state,patch);patches.push(patch);});
  const runTransaction=jest.fn(async(_db:any,callback:any)=>{
    const attempt=async()=>{
      let patch:any;
      const result=await callback({get:async()=>({exists:()=>true,data:()=>structuredClone(state)}),update:(_ref:any,value:any)=>{patch=value;}});
      return {patch,result};
    };
    let patch=await attempt();
    if(concurrent){const change=concurrent;concurrent=undefined;change();patch=await attempt();}
    if(patch.patch){Object.assign(state,patch.patch);patches.push(patch.patch);}
    return patch.result;
  });
  const context:any={module:{exports:{}},USE_MOCK_DATA:mock,mockGamesV2:[state],Date,docs:{game:()=>({id:'audit'})},getFirebase:()=>({db:{}}),runTransaction,updateGameDoc,
    playersPerTeamFor:()=>4,effectiveRosterOf:rosterOf,restoreTargetTeam,isGuestId:(id:string)=>id.startsWith('guest:')};
  vm.runInNewContext(ts.transpileModule('module.exports={'+methods.join(',')+'}',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
  const service=context.module.exports;
  service.getGameById=jest.fn(async()=>{const old=structuredClone(state);if(concurrent){const change=concurrent;concurrent=undefined;change();}return old;});
  return {state,service,patches,runTransaction,concurrently:(fn:()=>void)=>{concurrent=fn;}};
}

test.each(['leave','restore'])('%s retries against a concurrent allocation instead of restoring its stale draft or rotation',async action=>{
  const x=fixture();
  if(action==='restore') {x.state.draftTeams.teams[0].playerIds=['b'];x.state.draftTeams.leftHome=[{playerId:'a',homeTeam:0,at:1}];x.state.rotation.loans=[{playerId:'e',homeTeam:2,filledTeam:0}];}
  else x.state.rotation.loans=[{playerId:'a',homeTeam:0,filledTeam:1}];
  const live=structuredClone(x.state.liveMatch);
  x.concurrently(()=>{x.state.draftTeams.teams[2].colorKey='black';x.state.draftTeams.teams[2].playerIds.push('new-player');x.state.rotation.playing=[2,1];x.state.rotation.waiting=[0];});
  await x.service[action==='leave'?'markPlayerWentHome':'restorePlayer']('audit','a');
  expect(x.runTransaction).toHaveBeenCalledTimes(1);
  expect(x.state.draftTeams.teams[2]).toMatchObject({colorKey:'black',playerIds:expect.arrayContaining(['new-player'])});
  expect(x.state.rotation.playing).toEqual([2,1]);expect(x.state.rotation.waiting).toEqual([0]);
  expect(x.state.liveMatch).toEqual(live);
  expect(x.state.draftTeams.leftHome).toHaveLength(action==='leave'?1:0);
});

test.each(['filled','entered'])('retiring an empty waiting team rechecks when it has %s concurrently',async change=>{
  const x=fixture();x.state.draftTeams.teams[2].playerIds=[];
  x.concurrently(()=>{if(change==='filled')x.state.draftTeams.teams[2].playerIds=['new-player'];else{x.state.rotation.playing=[2,1];x.state.rotation.waiting=[0];}});
  expect(await x.service.retireEmptyTeam('audit',2)).toBe(false);
  expect(x.state.rotation.waiting).toEqual(change==='filled'?[2]:[0]);
  expect(x.patches).toHaveLength(0);
});

test.each([false,true])('roster changes notify the live screen and repeated leave/restore are idempotent (mock=%s)',async mock=>{
  const x=fixture(mock);await x.service.markPlayerWentHome('audit','a');
  const leftAt=x.state.draftTeams.leftHome[0].at;expect(x.state.updatedAt).toBeGreaterThan(1);
  await x.service.markPlayerWentHome('audit','a');expect(x.state.draftTeams.leftHome).toEqual([{playerId:'a',homeTeam:0,at:leftAt}]);
  expect(x.state.draftTeams.teams[0].playerIds).toEqual(['b']);
  await x.service.restorePlayer('audit','a');await x.service.restorePlayer('audit','a');
  expect(x.state.draftTeams.teams[0].playerIds.filter((id:string)=>id==='a')).toHaveLength(1);expect(x.state.draftTeams.leftHome).toEqual([]);
});

test.each([false,true])('closed rounds cannot be changed by stale roster confirmations (mock=%s)',async mock=>{
  for(const status of ['finished','cancelled'])for(const action of ['markPlayerWentHome','restorePlayer']) {
    const x=fixture(mock);x.state.status=status;x.state.draftTeams.leftHome=[{playerId:'e',homeTeam:2,at:1}];
    const before=structuredClone(x.state);
    await expect(x.service[action]('audit',action==='restorePlayer'?'e':'a')).rejects.toThrow();
    expect(x.state).toEqual(before);expect(x.patches).toHaveLength(0);
  }
});

test.each([false,true])('restoring a player returns a permanent guest filler to the actual source team (mock=%s)',async mock=>{
  const x=fixture(mock);
  x.state.draftTeams.teams[0].playerIds=['b','x','y','guest:filler'];
  x.state.draftTeams.teams[2].playerIds=['e'];
  x.state.draftTeams.leftHome=[{playerId:'a',homeTeam:0,at:1}];
  x.state.rotation.baseTeams=[{index:0,playerIds:['a','b','x','y']},{index:1,playerIds:['c','d']},{index:2,playerIds:['e','guest:filler']}];
  await x.service.restorePlayer('audit','a');
  expect(x.state.draftTeams.teams[0].playerIds).toEqual(['b','x','y','a']);
  expect(x.state.draftTeams.teams[2].playerIds).toEqual(['e','guest:filler']);
  expect(x.state.draftTeams.leftHome).toEqual([]);
});
