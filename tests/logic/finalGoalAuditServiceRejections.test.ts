import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';
import { rosterOf as effectiveRosterOf, roundCommitKey } from '@/services/rotationEngine';
import { isGuestId, toGuestRosterId } from '@/types';

const text = fs.readFileSync('src/services/gameService.ts', 'utf8');
const source = ts.createSourceFile('gameService.ts', text, ts.ScriptTarget.Latest, true);
const parts: string[] = [];
const methods: string[] = [];
const visit = (node: ts.Node) => {
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'assertLiveRosterMember') parts.push(node.getText(source));
  if (ts.isMethodDeclaration(node) && ['recordShootoutKick','undoLastShootoutKick'].includes(node.name.getText(source))) methods.push(node.getText(source));
  ts.forEachChild(node, visit);
};
visit(source);
const compiled = ts.transpileModule(parts.join('\n')+`\nmodule.exports={${methods.join(',')}};`, {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const kick = () => ({id:'attempt',team:'A',kickerId:'a',keeperId:'b',scored:true,outcome:'goal',expectedKickCount:0,expectedRoundId:'one'} as const);
function fixture() {
  const state: any = { status:'active',players:['a','a2','b','b2'],rotation:{round:1,roundInstanceId:'one',playing:[0,1],loans:[]},draftTeams:{teams:[{index:0,playerIds:['a','a2']},{index:1,playerIds:['b','b2']}]},liveMatch:{shootout:{firstTeam:'A',kicks:[]}} };
  const update = jest.fn((_ref:unknown,patch:Record<string,unknown>)=>{
    for(const [key,value] of Object.entries(patch)) {
      const names=key.split('.');let target=state;
      for(const name of names.slice(0,-1))target=target[name];
      target[names[names.length-1]]=structuredClone(value);
    }
  });
  const context: any = {module:{exports:{}},USE_MOCK_DATA:false,serverNow:()=>100,roundCommitKey,effectiveRosterOf,isGuestId,toGuestRosterId,
    getFirebase:()=>({db:{}}),docs:{game:()=>({})},runTransaction:async (_db:unknown,callback:any)=>callback({get:async()=>({data:()=>structuredClone(state)}),update}),
  };
  vm.runInNewContext(compiled, context);
  return {state,update,record:context.module.exports.recordShootoutKick,undo:context.module.exports.undoLastShootoutKick};
}

test.each(['count','first-side'])('a definite changed %s is classified only after checking the event id', async change => {
  const x=fixture();
  if(change==='count')x.state.liveMatch.shootout.kicks=[{id:'remote',team:'A',kickerId:'a2',keeperId:'b2',scored:false,outcome:'miss'}];
  else x.state.liveMatch.shootout.firstTeam='B';
  await expect(x.record('evening',kick())).rejects.toMatchObject({message:'SHOOTOUT_CHANGED',code:'LIVE_KICK_CHANGED'});
  expect(x.update).not.toHaveBeenCalled();
});

test('a definite missing participant is classified as a roster rejection before any write', async()=>{
  const x=fixture();x.state.draftTeams.teams[0].playerIds=['a2'];
  await expect(x.record('evening',kick())).rejects.toMatchObject({code:'LIVE_ROSTER_CHANGED'});
  expect(x.update).not.toHaveBeenCalled();
});

test('a conflicting existing id is deliberately not classified as a new-selection-safe rejection', async()=>{
  const x=fixture();x.state.liveMatch.shootout.kicks=[{...kick(),outcome:'miss',scored:false}];
  let caught:any;
  try {await x.record('evening',kick());} catch(error){caught=error;}
  expect(caught.message).toBe('SHOOTOUT_CHANGED');expect(caught.code).toBeUndefined();expect(x.update).not.toHaveBeenCalled();
});

test('a matching event is acknowledged even if its old participants and turn have since changed', async()=>{
  const x=fixture();x.state.liveMatch.shootout.kicks=[{...kick(),at:1}];x.state.draftTeams.teams[0].playerIds=['a2'];x.state.draftTeams.teams[1].playerIds=['b2'];
  await expect(x.record('evening',kick())).resolves.toBeUndefined();expect(x.update).not.toHaveBeenCalled();
});

test('retrying an acknowledged undo removes no earlier kick when the response was lost',async()=>{
  const x=fixture(); const first={...kick(),id:'first',at:1}, last={...kick(),id:'last',team:'B',at:2};x.state.liveMatch.shootout.kicks=[first,last];
  await x.undo('evening','last'); // Persisted, while its acknowledgement can be lost to the UI.
  await expect(x.undo('evening','last')).resolves.toBeUndefined();
  expect(x.state.liveMatch.shootout.kicks).toEqual([first]);expect(x.update).toHaveBeenCalledTimes(1);
});

test('undo still refuses a target that remains in the series but is no longer last',async()=>{
  const x=fixture();const first={...kick(),id:'first',at:1}, last={...kick(),id:'last',team:'B',at:2};x.state.liveMatch.shootout.kicks=[first,last];
  await expect(x.undo('evening','first')).rejects.toThrow('SHOOTOUT_CHANGED');
  expect(x.update).not.toHaveBeenCalled();expect(x.state.liveMatch.shootout.kicks).toEqual([first,last]);
});
