import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';
import * as rotationEngine from '@/services/rotationEngine';
import { reduceRounds, type RoundHistoryDoc } from '@/utils/eveningStats';
import { aggregatePenalties } from '@/utils/penaltyStats';
import { isGuestId, toGuestRosterId } from '@/types';

/** Run the production service bodies with only their external I/O replaced.
 * This is not a mock-game-only assertion and does not write to any account. */
function liveWorld(mock: boolean, size = 4) {
  const team = (index: number) => ({ index, captainId: `${index}:0`, playerIds: Array.from({length:size}, (_,i) => `${index}:${i}`) });
  const state: any = { id: 'audit', status: 'active', format: `${size}v${size}`,
    players: [0,1,2].flatMap(i => team(i).playerIds),
    draftTeams: { teams: [0,1,2].map(team), fillMode: 'temporary' },
    rotation: { roundInstanceId: 'current', playing: [0,1], waiting: [2], loans: [], round: 1, updatedAt: 1 },
    liveMatch: { phase: 'roundReady', scoreA: 0, scoreB: 0, goals: [], timerRunning: false,
      shootout: { firstTeam: 'A', kicks: [] } },
  };
  const update = jest.fn((_ref: unknown, patch: Record<string, any>) => {
    for (const [key,value] of Object.entries(patch)) {
      const path = key.split('.'); let target = state;
      for (const part of path.slice(0,-1)) target = target[part] ??= {};
      const name=path[path.length-1];
      if(value?.union)target[name]=[...(target[name]??[]),...value.union];
      else if(value?.increment!==undefined)target[name]=(target[name]??0)+value.increment;
      else target[name]=value;
    }
  });
  const snapshot = () => ({exists:()=>true,data:()=>state});
  const io = { runTransaction: async (_: unknown, fn: any) => fn({get:async()=>snapshot(),update}),
    doc:()=> 'audit',arrayUnion:(...union:any[])=>({union}),increment:(increment:number)=>({increment}),
    collection:()=> 'history', getDocs:jest.fn().mockRejectedValue(new Error('offline-history')) };
  const dependencies: Record<string, any> = {
    'firebase/firestore':io,
    '@/firebase/config':{USE_MOCK_DATA:mock,getFirebase:()=>({db:{}})},
    '@/firebase/firestore':{docs:{game:()=> 'audit'}},
    '@/data/mockData':{mockGamesV2:[state],mockGame:{id:'other'}},
    '@/services/rotationEngine':rotationEngine,
    '@/services/serverClock':{serverNow:()=>123},
    '@/services/errorLog':{logError:jest.fn()},
    '@/types':{isGuestId,toGuestRosterId},
  };
  const exports: any = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/services/gameService.ts','utf8'), {
    compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},
  }).outputText,{exports,require:(name:string)=>{if(name.endsWith('/joinDiagnosticId'))return require('@/utils/joinDiagnosticId');if(name.endsWith('/diagnosticJournal'))return require('@/services/diagnosticJournal');if(name==='@/services/diagnosticCallable')name='firebase/functions';return dependencies[name]??{};},__DEV__:false,Date,console,setTimeout,clearTimeout});
  return {state,update,io,service:exports.gameService};
}

const attempt = (extra: Record<string, unknown> = {}) => ({id:'one-attempt',team:'A',kickerId:'0:0',keeperId:'1:0',
  scored:false,outcome:'miss',expectedKickCount:0,expectedRoundId:'current',...extra});

test('a failed history read stays a failure instead of claiming no saved mini-games exist',async()=>{
  const x=liveWorld(false);
  await expect(x.service.getRoundHistory('audit')).rejects.toThrow('offline-history');
  expect(x.io.getDocs).toHaveBeenCalledTimes(1);
});

describe.each([false,true])('live shootout roster contract (mock %s)', mock => {
  test.each([4,7,11])('%s-a-side saves the selected opposing keeper with the kick atomically',async size=>{
    const x=liveWorld(mock,size);
    await x.service.recordShootoutKick('audit',attempt());
    expect(x.state.liveMatch.shootout).toMatchObject({keeperB:'1:0',kicks:[{kickerId:'0:0',keeperId:'1:0',outcome:'miss',scored:false}]});
    expect(x.state.liveMatch).toMatchObject({scoreA:0,scoreB:0,timerRunning:false});
    if(!mock)expect(x.update).toHaveBeenCalledTimes(1);
    await x.service.recordShootoutKick('audit',attempt({id:'second',team:'B',kickerId:'1:1',keeperId:'0:1',outcome:'save',expectedKickCount:1}));
    expect(x.state.liveMatch.shootout.keeperA).toBe('0:1');
    expect(x.state.liveMatch.shootout.kicks).toHaveLength(2);
  });
  test.each([
    {keeperId:'0:1'}, {keeperId:'2:0'}, {kickerId:'1:0'}, {kickerId:'2:0'},
  ])('rejects another side or a waiting participant: %j',async wrong=>{
    const x=liveWorld(mock);const before=structuredClone(x.state);
    await expect(x.service.recordShootoutKick('audit',attempt(wrong))).rejects.toThrow('אינו בהרכב');
    expect(x.state).toEqual(before);expect(x.update).not.toHaveBeenCalled();
  });
  test('eligibility follows the effective loan rather than the original team',async()=>{
    const x=liveWorld(mock);
    x.state.rotation.loans=[{playerId:'2:0',homeTeam:2,filledTeam:1}];
    await x.service.recordShootoutKick('audit',attempt({keeperId:'2:0'}));
    expect(x.state.liveMatch.shootout.keeperB).toBe('2:0');
    const y=liveWorld(mock);y.state.rotation.loans=[{playerId:'1:0',homeTeam:1,filledTeam:2}];
    await expect(y.service.recordShootoutKick('audit',attempt())).rejects.toThrow('אינו בהרכב');
  });
  test('guests on the opposing field roster are eligible, departed guests are not',async()=>{
    const x=liveWorld(mock);x.state.draftTeams.teams[1].playerIds[0]='guest:dedicated';x.state.guests=[{id:'dedicated'}];
    await x.service.recordShootoutKick('audit',attempt({keeperId:'guest:dedicated'}));
    expect(x.state.liveMatch.shootout.keeperB).toBe('guest:dedicated');
    const y=liveWorld(mock);y.state.draftTeams.leftHome=[{playerId:'1:0',homeTeam:1,at:1}];
    await expect(y.service.recordShootoutKick('audit',attempt())).rejects.toThrow('אינו בהרכב');
  });
  test.each(['no-show','waitlisted-guest','removed-player'])('a stale allocation cannot resurrect a %s',async kind=>{
    const x=liveWorld(mock);let keeperId='1:0';
    if(kind==='no-show')x.state.arrivals={'1:0':'no_show'};
    if(kind==='removed-player')x.state.players=x.state.players.filter((id:string)=>id!=='1:0');
    if(kind==='waitlisted-guest'){
      keeperId='guest:queued';x.state.guests=[{id:'queued',waitlisted:true}];x.state.draftTeams.teams[1].playerIds[0]=keeperId;
    }
    await expect(x.service.recordShootoutKick('audit',attempt({keeperId}))).rejects.toThrow('אינו בהרכב');
    expect(x.state.liveMatch.shootout.kicks).toHaveLength(0);
  });
  test('a lost acknowledgement retries one event; reusing its id for changed data fails',async()=>{
    const x=liveWorld(mock);await x.service.recordShootoutKick('audit',attempt());
    await x.service.recordShootoutKick('audit',attempt());
    expect(x.state.liveMatch.shootout.kicks).toHaveLength(1);
    await expect(x.service.recordShootoutKick('audit',attempt({outcome:'save'}))).rejects.toThrow('SHOOTOUT_CHANGED');
    await expect(x.service.recordShootoutKick('audit',attempt({keeperId:'1:1'}))).rejects.toThrow('SHOOTOUT_CHANGED');
    expect(x.state.liveMatch.shootout.keeperB).toBe('1:0');
  });
  test('editing the latest event also validates the opponent and updates its keeper default',async()=>{
    const x=liveWorld(mock);await x.service.recordShootoutKick('audit',attempt());
    await expect(x.service.updateLastShootoutKick('audit','one-attempt',{kickerId:'0:1',keeperId:'0:0',outcome:'save'},'current')).rejects.toThrow('אינו בהרכב');
    await x.service.updateLastShootoutKick('audit','one-attempt',{kickerId:'0:1',keeperId:'1:1',outcome:'save'},'current');
    expect(x.state.liveMatch.shootout).toMatchObject({keeperB:'1:1',kicks:[{id:'one-attempt',team:'A',at:123,kickerId:'0:1',keeperId:'1:1',outcome:'save'}]});
  });
  test('explicit keeper setup uses that keeper’s own side, never a waiting or opposite team',async()=>{
    const x=liveWorld(mock);
    await expect(x.service.setShootoutKeeper('audit','B','0:0','current')).rejects.toThrow('אינו בהרכב');
    await x.service.setShootoutKeeper('audit','B','1:0','current');
    expect(x.state.liveMatch.shootout.keeperB).toBe('1:0');
  });
  test.each(['saved','missing-roster','stale'])('a new attempt is rejected for %s state',async kind=>{
    const x=liveWorld(mock);
    if(kind==='saved')x.state.lastCommittedRoundId='current';
    if(kind==='missing-roster')delete x.state.draftTeams;
    if(kind==='stale')x.state.rotation.roundInstanceId='another';
    await expect(x.service.recordShootoutKick('audit',attempt())).rejects.toThrow('SHOOTOUT_CHANGED');
    expect(x.state.liveMatch.shootout.kicks).toHaveLength(0);
  });
  test('invalid result classification never reaches the transaction',async()=>{
    const x=liveWorld(mock);
    await expect(x.service.recordShootoutKick('audit',attempt({outcome:'goal',scored:false}))).rejects.toThrow('אינה תקינה');
    await expect(x.service.recordShootoutKick('audit',attempt({outcome:'unknown'}))).rejects.toThrow('אינה תקינה');
    expect(x.update).not.toHaveBeenCalled();
  });
});

describe.each([false,true])('live goal roster contract (mock %s)', mock=>{
  const goal=(extra:Record<string,unknown>={})=>({id:'goal',team:'A',scorerId:'0:0',assisterId:'0:1',assistStatus:'player',minute:1,expectedRoundId:'current',...extra});
  test('scorer and assist save once; a reused id cannot change its identities',async()=>{
    const x=liveWorld(mock);await x.service.recordGoal('audit',goal());await x.service.recordGoal('audit',goal());
    expect(x.state.liveMatch).toMatchObject({scoreA:1,scoreB:0,goals:[{scorerId:'0:0',assisterId:'0:1',assistStatus:'player'}],goalTally:{'0:0':1}});
    await expect(x.service.recordGoal('audit',goal({assisterId:'0:2'}))).rejects.toThrow('פרטים אחרים');
    expect(x.state.liveMatch.goals).toHaveLength(1);
  });
  test.each([{scorerId:'1:0'},{assisterId:'1:0'},{scorerId:'2:0'},{assisterId:'2:0'}])('a stale picker cannot attribute a goal to %j',async wrong=>{
    const x=liveWorld(mock);await expect(x.service.recordGoal('audit',goal(wrong))).rejects.toThrow('אינו בהרכב');
    expect(x.state.liveMatch.goals).toEqual([]);expect(x.state.liveMatch.scoreA).toBe(0);
  });
  test('own goal validates the conceding roster, counts the beneficiary and never credits a scorer or assist',async()=>{
    const x=liveWorld(mock);await x.service.recordGoal('audit',goal({ownGoal:true,scorerId:'1:0'}));
    expect(x.state.liveMatch).toMatchObject({scoreA:1,scoreB:0,goals:[{ownGoal:true,scorerId:'1:0'}]});
    expect(x.state.liveMatch.goals[0].assisterId).toBeUndefined();expect(x.state.liveMatch.goalTally).toBeUndefined();
    const y=liveWorld(mock);await expect(y.service.recordGoal('audit',goal({ownGoal:true}))).rejects.toThrow('אינו בהרכב');
  });
  test('unknown scorer remains valid without a clock, but requires a prepared current roster',async()=>{
    const x=liveWorld(mock);delete x.state.liveMatch;
    await x.service.recordGoal('audit',goal({scorerId:null,assisterId:null,assistStatus:'unknown'}));
    expect(x.state.liveMatch).toMatchObject({phase:'roundReady',scoreA:1,timerRunning:false,goalTally:{},goals:[{scorerId:null}]});
    const y=liveWorld(mock);delete y.state.draftTeams;
    await expect(y.service.recordGoal('audit',goal({scorerId:null,assisterId:null}))).rejects.toThrow('ההרכב השתנה');
  });
});

test('the detailed evening reducer agrees with server penalty counts for explicit misses and legacy data',()=>{
  const penalties = [
    {kickerId:'a',keeperId:'keeper',team:'A' as const,scored:true,outcome:'goal' as const},
    {kickerId:'a',keeperId:'keeper',team:'A' as const,scored:false,outcome:'save' as const},
    {kickerId:'a',keeperId:'keeper',team:'A' as const,scored:false,outcome:'miss' as const},
    {kickerId:'a',keeperId:'keeper',team:'A' as const,scored:false},
  ];
  const round:RoundHistoryDoc={roundId:'r',teamA:['a'],teamB:['keeper'],scoreA:0,scoreB:0,winnerSide:'A',goals:[],penalties,at:1};
  const history=reduceRounds('keeper',[round]);
  const aggregate=aggregatePenalties(penalties,{isOnField:()=>true,isReal:()=>true});
  expect(history.pen).toEqual({saved:2,conceded:1,scored:0,missed:0});
  expect(aggregate.byKeeper.keeper).toEqual({faced:4,saved:2,conceded:1});
});

test('the actual server history preserves registered guest assists and excludes own/self/unknown attribution',()=>{
  const source=fs.readFileSync('functions/src/index.ts','utf8');
  const tree=ts.createSourceFile('index.ts',source,ts.ScriptTarget.Latest,true);
  let expression='';
  function visit(node:ts.Node) {
    if(ts.isVariableDeclaration(node)&&node.name.getText(tree)==='roundHistoryDoc')expression=node.initializer!.getText(tree);
    ts.forEachChild(node,visit);
  }
  visit(tree);expect(expression).not.toBe('');
  const cappedGoals=[
    {scorerId:'a',assisterId:'guest:dedicated',team:'A',assistStatus:'player'},
    {scorerId:'a',assisterId:'guest:other-round',team:'A'},
    {scorerId:'a',assisterId:'a',team:'A'},
    {scorerId:'b',assisterId:'guest:dedicated',team:'A',ownGoal:true},
    {scorerId:null,assisterId:'guest:dedicated',team:'A'},
  ];
  const value=vm.runInNewContext(ts.transpileModule(`(${expression})`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,{
    roundId:'r',fullA:['a','guest:dedicated'],fullB:['b'],teamAIndex:0,teamBIndex:1,scoreA:5,scoreB:0,winnerSide:'A',
    cappedGoals,A:['a'],B:['b'],isReal:(id:string)=>!id.startsWith('guest:'),onField:new Set(['a','b']),
    okForDisplay:(id:string)=>['a','b','guest:dedicated'].includes(id),penalties:[],inPlayPenalties:[],liveGoalIds:[],now:1,
  });
  expect(Array.from(value.goals,(goal:any)=>goal.assisterId)).toEqual(['guest:dedicated',null,null,null,null]);
  expect(reduceRounds('guest:dedicated',[value]).bestMiniGame).toEqual({round:1,goals:0,assists:1});
});
