import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';
import { buildRoundSides } from '../../functions/src/roundSides';
import { roundParticipantSides } from '../../functions/src/roundParticipants';
import { StatBatch, MAX_ROUND_BATCH_OPS } from '../../functions/src/statBatch';
import { liveRoundKey, matchesLiveRound } from '../../functions/src/liveRoundCommit';
import { liveSeasonStamp } from '../../functions/src/liveSeasonStamp';
import { assertSeasonOpenForGame } from '../../functions/src/seasonLock';
import { commitRoundInOrder } from '../../functions/src/commitProtocol';

const source=fs.readFileSync('functions/src/index.ts','utf8');
const tree=ts.createSourceFile('index.ts',source,ts.ScriptTarget.Latest,true);
let expression='';
function visit(node:ts.Node) {
  if(ts.isVariableDeclaration(node)&&node.name.getText(tree)==='commitRoundStats')expression=node.initializer!.getText(tree);
  ts.forEachChild(node,visit);
}
visit(tree);
const compiled=ts.transpileModule(`(${expression})`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;

/** Execute the complete callable handler and its atomic batch builder. Only
 * admin SDK I/O and authentication are replaced; there is no production call. */
function serverWorld(size=11, guests=false) {
  const side=(letter:string)=>Array.from({length:size},(_,i)=>guests?`guest:${letter}${i}`:`${letter}${i}`);
  const sideA=side('a'),sideB=side('b');
  const documents=new Map<string,any>();
  const state:any={createdBy:'manager',groupId:'club',status:'active',players:guests?[]:[...sideA,...sideB,'sub-a','sub-b'],
    guests:guests?[...sideA,...sideB].map(id=>({id:id.slice(6)})):[],
    rotation:{roundInstanceId:'r',updatedAt:1},liveMatch:{scoreA:0,scoreB:0,goals:[]}};
  documents.set('games/audit',state);documents.set('groups/club',{adminIds:['manager']});
  const inc=(delta:number)=>({__increment:delta});const removed={__delete:true};
  function merge(target:any,patch:any) {
    for(const [key,value]of Object.entries(patch) as [string,any][]) {
      const path=key.split('.');let parent=target;
      for(const piece of path.slice(0,-1))parent=parent[piece]??={};
      const name=path[path.length-1];
      if(value?.__increment!==undefined)parent[name]=(parent[name]??0)+value.__increment;
      else if(value?.__delete)delete parent[name];
      else if(value&&typeof value==='object'&&!Array.isArray(value))merge(parent[name]??={},value);
      else parent[name]=value;
    }
  }
  const ref=(path:string):any=>({path,
    collection:(name:string)=>collection(`${path}/${name}`),
    get:async()=>({exists:documents.has(path),ref:ref(path),updateTime:1,createTime:{toMillis:()=>2000},data:()=>documents.get(path),get:(key:string)=>documents.get(path)?.[key]}),
    set:async(patch:any)=>merge(documents.get(path)??{},patch),
    update:async(patch:any)=>merge(documents.get(path),patch),
    create:async(patch:any)=>{if(documents.has(path))throw Object.assign(Error('exists'),{code:6});documents.set(path,patch);},
  });
  const collection=(path:string):any=>({doc:(id:string)=>ref(`${path}/${id}`)});
  const commits:number[]=[];
  const db={collection,batch:()=>{
    const writes:{kind:string;ref:any;data:any}[]=[];
    const batch={create:(reference:any,data:any)=>{writes.push({kind:'create',ref:reference,data});return batch;},
      set:(reference:any,data:any)=>{writes.push({kind:'set',ref:reference,data});return batch;},
      update:(reference:any,data:any)=>{writes.push({kind:'update',ref:reference,data});return batch;},
      commit:async()=>{
        for(const write of writes)if(write.kind==='create'&&documents.has(write.ref.path))throw Object.assign(Error('exists'),{code:6});
        for(const write of writes){const value=documents.get(write.ref.path)??{};merge(value,write.data);documents.set(write.ref.path,value);}
        commits.push(writes.length);
      },
    };return batch;
  }};
  class HttpsError extends Error {constructor(public code:string,message:string){super(message);}}
  const commit=vm.runInNewContext(compiled,{onCall:(_:unknown,handler:any)=>handler,ENFORCE_APP_CHECK:false,db,HttpsError,
    admin:{firestore:{FieldValue:{increment:inc,delete:()=>removed}}},
    liveRoundKey,matchesLiveRound,buildRoundSides,roundParticipantSides,StatBatch,MAX_ROUND_BATCH_OPS,commitRoundInOrder,
    liveSeasonStamp, assertSeasonOpenForGame,isReal:(id:string)=>!id.startsWith('guest:'),
    console:{log(){},error(){}},Date,
  });
  const payload:any={gameId:'audit',roundId:'r',sideA,sideB,teamAIndex:0,teamBIndex:1,winnerSide:'A',goals:[],penalties:[],liveGoalIds:[],rotationUpdatedAt:1};
  const save=()=>commit({auth:{uid:'manager'},data:payload});
  return {documents,state,payload,commits,save};
}

test.each([4,7,11])('the actual server commit keeps a %s-a-side goal, guest assist and shootout classification once',async size=>{
  const x=serverWorld(size,true);
  x.payload.goals=[{scorerId:'guest:a0',assisterId:'guest:a1',assistStatus:'player',team:'A',minute:1}];
  x.state.liveMatch.goals=[{id:'g',...x.payload.goals[0]}];x.payload.liveGoalIds=['g'];
  const penalties=[
    {kickerId:'guest:a0',keeperId:'guest:b0',scored:false,outcome:'miss'},
    {kickerId:'guest:b0',keeperId:'guest:a0',scored:false,outcome:'save'},
    {kickerId:'guest:a1',keeperId:'guest:b0',scored:true,outcome:'goal'},
  ];
  x.payload.penalties=penalties;x.state.liveMatch.shootout={kicks:penalties};
  expect(await x.save()).toMatchObject({ok:true,protocol:2});
  const history=x.documents.get('games/audit/roundHistory/r');
  expect(history).toMatchObject({scoreA:1,scoreB:0,goals:[{scorerId:'guest:a0',assisterId:'guest:a1'}]});
  expect(history.penalties.map((p:any)=>p.outcome)).toEqual(['miss','save','goal']);
  expect(x.documents.get('gamePlayerStats/audit__guest:a0')).toMatchObject({isGuest:true,goals:1,rounds:1});
  expect(x.documents.get('gamePlayerStats/audit__guest:a1')).toMatchObject({isGuest:true,assists:1,rounds:1});
  expect([...x.documents.keys()].some(key=>key.startsWith('users/'))).toBe(false);
  expect(await x.save()).toMatchObject({alreadyCommitted:true});expect(x.commits).toHaveLength(1);
});

test('11-a-side restores a scorer and assister substituted off without rejecting size or losing history',async()=>{
  const x=serverWorld();
  x.payload.goals=[{scorerId:'sub-a',assisterId:'a0',team:'A'},{scorerId:'b0',assisterId:'sub-b',team:'B'}];
  x.payload.liveGoalIds=['g1','g2'];x.state.liveMatch.goals=x.payload.goals.map((g:any,i:number)=>({id:`g${i+1}`,...g}));
  await x.save();
  expect(x.documents.get('users/sub-a').stats.goals).toBe(1);
  expect(x.documents.get('users/sub-b').stats.assists).toBe(1);
  const history=x.documents.get('games/audit/roundHistory/r');
  expect(history.teamA).toHaveLength(12);expect(history.teamA).toContain('sub-a');
  expect(history.teamB).toHaveLength(12);expect(history.teamB).toContain('sub-b');
  expect(x.commits[0]).toBeLessThanOrEqual(MAX_ROUND_BATCH_OPS);
});

test('the batch limit still refuses genuinely oversized expanded participation before writing',async()=>{
  const x=serverWorld();
  const extra=Array.from({length:12},(_,i)=>`off${i}`);x.state.players.push(...extra);
  x.payload.goals=extra.map((scorerId,i)=>({scorerId,team:i%2===0?'A':'B'}));
  x.payload.liveGoalIds=extra.map((_,i)=>`g${i}`);x.state.liveMatch.goals=x.payload.goals.map((g:any,i:number)=>({id:`g${i}`,...g}));
  await expect(x.save()).rejects.toMatchObject({code:'resource-exhausted'});
  expect(x.commits).toHaveLength(0);expect(x.documents.has('games/audit/committedRounds/r')).toBe(false);
});

test('new misses count as faced but never saved in the actual server player counters',async()=>{
  const x=serverWorld(4);
  x.payload.penalties=[{kickerId:'a0',keeperId:'b0',scored:false,outcome:'miss'},
    {kickerId:'a1',keeperId:'b0',scored:false,outcome:'save'},
    {kickerId:'a2',keeperId:'b0',scored:true,outcome:'goal'}];
  x.state.liveMatch.shootout={kicks:x.payload.penalties};
  await x.save();
  expect(x.documents.get('users/b0').stats).toMatchObject({penFaced:3,penSaved:1,penConceded:1});
  expect(x.documents.get('gamePlayerStats/audit__b0')).toMatchObject({penFaced:3,penSaved:1,penConceded:1});
});

describe.each([4,7,11])('%s-a-side outgoing guest participation',size=>{
  test.each(['scorer','assister'] as const)('an outgoing %s keeps one appearance and result without changing the live lineup',async role=>{
    const x=serverWorld(size,true);
    const outgoing='guest:outgoing';
    x.state.guests.push({id:'outgoing'});
    x.state.draftTeams={teams:[
      {index:0,playerIds:[...x.payload.sideA]},
      {index:1,playerIds:[...x.payload.sideB]},
      {index:2,playerIds:[outgoing]},
    ]};
    x.state.rotation.loans=[{playerId:outgoing,homeTeam:0,filledTeam:2,swapId:'temporary'}];
    const before=JSON.parse(JSON.stringify({draft:x.state.draftTeams,rotation:x.state.rotation,sideA:x.payload.sideA,sideB:x.payload.sideB}));
    x.payload.goals=[{scorerId:role==='scorer'?outgoing:'guest:a0',assisterId:role==='assister'?outgoing:null,assistStatus:role==='assister'?'player':'none',team:'A'}];
    x.payload.liveGoalIds=['g'];x.state.liveMatch.goals=[{id:'g',...x.payload.goals[0]}];

    await x.save();

    const history=x.documents.get('games/audit/roundHistory/r');
    expect(history.teamA).toHaveLength(size+1);
    expect(history.teamA.filter((id:string)=>id===outgoing)).toHaveLength(1);
    expect(history.teamB).not.toContain(outgoing);
    expect(x.documents.get(`gamePlayerStats/audit__${outgoing}`)).toMatchObject({
      isGuest:true,rounds:1,wins:1,cleanSheets:1,actualTeamGoalsFor:1,actualTeamGoalsAgainst:0,teamScoreRounds:1,
      [role==='scorer'?'goals':'assists']:1,
    });
    expect({draft:x.state.draftTeams,rotation:x.state.rotation,sideA:x.payload.sideA,sideB:x.payload.sideB}).toEqual(before);
    expect([...x.documents.keys()].some(key=>(key.startsWith('users/')||key.startsWith('communityPlayerStats/')||key.startsWith('pairStats/'))&&key.includes(outgoing))).toBe(false);
    await x.save();
    expect(x.commits).toHaveLength(1);
    expect(x.documents.get(`gamePlayerStats/audit__${outgoing}`).rounds).toBe(1);
  });
});

test('removing the outgoing guest goal before commit also removes its evidence of participation',async()=>{
  const x=serverWorld(4,true);x.state.guests.push({id:'outgoing'});
  // The live undo has removed the only event; registration alone is not proof
  // that this waiting guest participated in this mini-game.
  await x.save();
  expect(x.documents.get('games/audit/roundHistory/r').teamA).not.toContain('guest:outgoing');
  expect(x.documents.has('gamePlayerStats/audit__guest:outgoing')).toBe(false);
});

test('an outgoing guest own-goal scorer is restored only to the conceding side',async()=>{
  const x=serverWorld(4,true);x.state.guests.push({id:'outgoing'});
  x.payload.goals=[{scorerId:'guest:outgoing',assisterId:'guest:fake-assist',ownGoal:true,team:'A'}];
  x.payload.liveGoalIds=['g'];x.state.liveMatch.goals=[{id:'g',...x.payload.goals[0]}];
  await x.save();
  const history=x.documents.get('games/audit/roundHistory/r');
  expect(history.teamA).not.toContain('guest:outgoing');
  expect(history.teamB).toContain('guest:outgoing');
  expect(history.goals[0].assisterId).toBeNull();
  expect(x.documents.get('gamePlayerStats/audit__guest:outgoing')).toMatchObject({isGuest:true,rounds:1,losses:1,actualTeamGoalsFor:0,actualTeamGoalsAgainst:1});
  expect(x.documents.get('gamePlayerStats/audit__guest:outgoing').goals??0).toBe(0);
});

test('a forged unregistered outgoing guest is never restored or credited',async()=>{
  const x=serverWorld(4,true);
  x.payload.goals=[{scorerId:'guest:unregistered',team:'A'}];
  x.payload.liveGoalIds=['g'];x.state.liveMatch.goals=[{id:'g',...x.payload.goals[0]}];
  await x.save();
  expect(x.documents.get('games/audit/roundHistory/r').teamA).not.toContain('guest:unregistered');
  expect(x.documents.has('gamePlayerStats/audit__guest:unregistered')).toBe(false);
});


test('the complete timerless commit stamps the current season in the same single game write and retries once',async()=>{
 const x=serverWorld(4);x.state.status='open';
 x.documents.get('groups/club').seasons={enabled:true,currentId:'s3',currentNo:3,count:2,startedAt:1000};
 expect(x.state.seasonId).toBeUndefined();
 await expect(x.save()).resolves.toMatchObject({ok:true,protocol:2});
 expect(x.state.seasonId).toBe('s3');expect(x.state.lastCommittedRoundId).toBe('r');expect(x.commits).toHaveLength(1);
 await expect(x.save()).resolves.toMatchObject({alreadyCommitted:true});expect(x.commits).toHaveLength(1);
});
test('the complete commit cannot reinterpret an old stamped season and writes nothing',async()=>{
 const x=serverWorld(4);x.state.status='open';x.state.seasonId='s1';
 x.documents.get('groups/club').seasons={enabled:true,currentId:'s3',currentNo:3,count:2,startedAt:1000};
 await expect(x.save()).rejects.toThrow('closedSeasonGame');expect(x.commits).toHaveLength(0);expect(x.state.seasonId).toBe('s1');
});
