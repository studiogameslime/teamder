import fs from 'fs';
import path from 'path';
import vm from 'vm';
import ts from 'typescript';
import * as helpers from '@/utils/localDemoPersistence';
import type { LocalDemoSnapshot } from '@/utils/localDemoPersistence';

const roster = Array.from({length:15}, (_, i) => `p${i+1}`);
const baseline = (): LocalDemoSnapshot => ({
  version: 1,
  game: {id:'gv2-live',groupId:'g1',title:'בדיקת כוחות ולייב',startsAt:1,
    fieldName:'המגרש הקבוע',maxPlayers:15,players:[...roster],waitlist:[],
    status:'open',locked:false,matches:[],currentMatchIndex:0,createdBy:'p7',createdAt:1,
    format:'5v5',numberOfTeams:3,advancedMode:true},
  group:{id:'g1',internalRating:true,adminRatings:Object.fromEntries(roster.map((id,i)=>[id,2+i/10]))},
  history:[],
});

test('a saved allocation, live match, colours and results never enter a fresh test', () => {
  const saved = baseline();
  Object.assign(saved.game, {
    status:'finished',endedAt:5,committedRoundCount:4,teamsEditedManually:true,
    lastCommittedRoundId:'old',draftTeams:{teams:[{index:0,playerIds:['p1'],colorKey:'green'}]},
    rotation:{playing:[0,1]},liveMatch:{scoreA:3,timerRunning:true,shootout:{kicks:[{}]}},
  });
  saved.history = [{roundId:'old'}] as LocalDemoSnapshot['history'];
  const next = helpers.freshLocalDemoSnapshot(saved, 1000);
  expect(next.game).toMatchObject({format:'5v5',numberOfTeams:3,maxPlayers:15,advancedMode:true,
    status:'open',locked:false,currentMatchIndex:0,startsAt:1201000,players:roster});
  for (const key of ['draftTeams','rotation','liveMatch','endedAt','committedRoundCount','lastCommittedRoundId','teamsEditedManually']) {
    expect(next.game).not.toHaveProperty(key);
  }
  expect(next.game.matches).toEqual([]);
  expect(next.history).toEqual([]);
  expect(next.group).toEqual(saved.group);
  next.game.players.pop();
  next.group.adminRatings!.p1 = 5;
  expect(saved.game.players).toHaveLength(15);
  expect(saved.group.adminRatings!.p1).toBe(2);
});

test('only the prepared demo identity and valid roster/ratings can be restored', () => {
  expect(helpers.parseLocalDemoSnapshot(null)).toBeNull();
  expect(helpers.parseLocalDemoSnapshot(JSON.stringify(baseline()))).toEqual(baseline());
  for (const patch of [{id:'real-game'},{createdBy:'real-user'},{players:['p7']},{players:Array(15).fill('p7')},{format:'12v12'}]) {
    const value=baseline(); Object.assign(value.game,patch);
    expect(()=>helpers.parseLocalDemoSnapshot(JSON.stringify(value))).toThrow('LOCAL_DEMO_INVALID');
  }
  const bad=baseline(); bad.group.adminRatings!.p1=6;
  expect(()=>helpers.parseLocalDemoSnapshot(JSON.stringify(bad))).toThrow('LOCAL_DEMO_INVALID_RATINGS');
  expect(()=>helpers.parseLocalDemoSnapshot('{')).toThrow();
});

const compiled = ts.transpileModule(fs.readFileSync(path.resolve(__dirname,'../../src/dev/localDemoPersistence.ts'),'utf8'), {
  compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS,esModuleInterop:true},
}).outputText;

function boot(raw: string | null, opts: {dev?:boolean;mock?:boolean;force?:string;qa?:string} = {}) {
  const disk={raw};
  const storage={getItem:jest.fn(async()=>disk.raw),setItem:jest.fn(async(_key:string,json:string)=>{disk.raw=json;}),multiRemove:jest.fn(async()=>{})};
  const original=baseline().game;
  const data={mockGamesV2:[original],mockRoundHistory:{'gv2-live':[{roundId:'old'}]}};
  const group={id:'g1',adminIds:['p7'],internalRating:false};
  const groupService={get:jest.fn(async()=>group)};
  const mockUsers={mockGroup:{...group}};
  const exports:Record<string,any>={};
  const modules:Record<string,unknown>={
    '@react-native-async-storage/async-storage':storage,
    '@/utils/localDemoPersistence':helpers,
    '@/firebase/config':{USE_MOCK_DATA:opts.mock ?? true},
    '@/data/mockData':data,'@/data/mockUsers':mockUsers,'@/services/groupService':{groupService},
  };
  vm.runInNewContext(compiled,{exports,module:{exports},require:(id:string)=>{
    if (!(id in modules)) throw new Error('Unexpected dependency '+id); return modules[id];
  },__DEV__:opts.dev ?? true,process:{env:{EXPO_PUBLIC_FOOTY_FORCE_MOCK:opts.force ?? '1',EXPO_PUBLIC_QA_ROUTES:opts.qa ?? '1'}},Promise,Date});
  return {restore:exports.restoreLocalDemoRound as ()=>Promise<void>,storage,data,group,disk,original};
}

test.each([{dev:false},{mock:false},{force:'0'},{qa:'0'}])('normal runtime never reads or changes local demo data: %j', async options => {
  const run=boot(JSON.stringify(baseline()),options);
  await run.restore();
  expect(run.storage.getItem).not.toHaveBeenCalled();
  expect(run.data.mockGamesV2[0]).toBe(run.original);
});

test('cold boot restores the clean setup and ratings before screens; a second boot resets again', async () => {
  const saved=baseline(); saved.game.draftTeams={method:'regular',numTeams:3,createdAt:1,createdBy:'p7',teams:[]};
  const first=boot(JSON.stringify(saved));
  await first.restore();
  expect(first.data.mockGamesV2[0].draftTeams).toBeUndefined();
  expect(first.group.internalRating).toBe(true);
  expect(first.storage.multiRemove).toHaveBeenCalledWith(['manual-allocation:p7:gv2-live','match-opening:p7:gv2-live']);
  first.data.mockGamesV2[0].draftTeams=saved.game.draftTeams;
  await first.restore();
  expect(first.data.mockGamesV2[0].draftTeams).toBeDefined(); // No reset while using the app.
  const second=boot(first.disk.raw);
  await second.restore();
  expect(second.data.mockGamesV2[0].draftTeams).toBeUndefined();
  expect(second.data.mockGamesV2[0].players).toHaveLength(15);
  expect(second.data.mockRoundHistory['gv2-live']).toEqual([]);
  expect(JSON.parse(second.disk.raw!).game.draftTeams).toBeUndefined();
});

test('a failed local checkpoint leaves bundled fixtures intact and allows a retry', async () => {
  const run=boot(JSON.stringify(baseline()));
  run.storage.setItem.mockRejectedValueOnce(new Error('disk unavailable'));
  await expect(run.restore()).rejects.toThrow('disk unavailable');
  expect(run.data.mockGamesV2[0]).toBe(run.original);
  await run.restore();
  expect(run.data.mockGamesV2[0]).not.toBe(run.original);
});
