import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';
import { draftColorPatch, draftColorTeams, readDraftColors } from '@/utils/draftColors';
import { createManualDraft, hasManualDraft, manualDraftRevision } from '@/utils/manualAllocation';
import { initialOpeningPlan, changeOpeningColor } from '@/utils/openingTeams';
import { rotationWriteSource } from '@/services/rotationWriteSource';
import type { Game } from '@/types';
import { applyScheduledColors } from '../../functions/src/draftColors';

const baseline = {0:'red',1:'blue',2:'green'};
function fixture(): Game {
  return {id:'g',groupId:'club',title:'מחזור בדיקה',createdBy:'owner',status:'open',numberOfTeams:3,format:'3v3',players:['a','b','c'],guests:[],matches:[],waitlist:[],startsAt:1,createdAt:1,fieldName:'מגרש',maxPlayers:9,currentMatchIndex:0,locked:false};
}
function harness(mock: boolean, initial = fixture()) {
  const current = structuredClone(initial);
  const ast = ts.createSourceFile('gameService.ts',fs.readFileSync('src/services/gameService.ts','utf8'),ts.ScriptTarget.Latest,true);
  const methods: string[] = [];
  const visit = (n: ts.Node) => {if(ts.isMethodDeclaration(n) && ['saveDraftTeamColors','saveDraftTeams','_persistRotation'].includes(n.name.getText(ast))) methods.push(n.getText(ast));ts.forEachChild(n,visit);};visit(ast);
  const patches: any[]=[];
  const context:any={module:{exports:{}},Date,USE_MOCK_DATA:mock,mockGamesV2:[current],draftColorPatch,rotationWriteSource,
    resolveRoundInstance:()=>({roundInstanceId:'first',roundInstanceRound:1}),validateDraftRoster:jest.fn(),stripUndefined:(v:any)=>v,
    docs:{game:()=>({})},getFirebase:()=>({db:{}}),runTransaction:async(_:unknown,fn:any)=>fn({
      get:async()=>({exists:()=>true,data:()=>structuredClone(current)}),update:(_:unknown,patch:any)=>{patches.push(patch);Object.assign(current,structuredClone(patch));},
    })};
  vm.runInNewContext(ts.transpileModule(`module.exports={${methods.join(',')}}`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
  return {service:context.module.exports,current,patches};
}

test.each([false,true])('before any allocation, colour changes persist without creating empty teams (mock=%s)',async mock=>{
  const {service,current}=harness(mock);
  await service.saveDraftTeamColors('g',{...baseline,0:'yellow'},baseline);
  expect(current.draftTeams).toBeUndefined();
  expect(current.players).toEqual(['a','b','c']);
  expect(draftColorTeams(current,3).map(t=>t.colorKey)).toEqual(['yellow','blue','green']);
  // A method switch/remount reconstructs from the round, not from UI state.
  expect(draftColorTeams(structuredClone(current),3)[0].colorKey).toBe('yellow');
});

test.each([false,true])('colours survive allocation, opening edits and the live rotation write (mock=%s)',async mock=>{
  const {service,current}=harness(mock);
  await service.saveDraftTeamColors('g',{...baseline,0:'yellow'},baseline);
  const chosen=draftColorTeams(current,3);
  const draft=createManualDraft([['a'],['b'],['c']],'owner',3,undefined,current.draftTeamColors);
  await service.saveDraftTeams('g',draft,undefined,true,structuredClone(current));
  expect(current.draftTeams!.teams.map((t:any)=>t.colorKey)).toEqual(chosen.map(t=>t.colorKey));
  const plan=initialOpeningPlan(current.draftTeams!);
  expect(plan.colors).toEqual({0:'yellow',1:'blue',2:'green'});
  const changed=changeOpeningColor(plan,0,'blue');
  await service.saveDraftTeamColors('g',changed.colors,plan.colors);
  const source=rotationWriteSource(current);
  const result={rotation:{playing:[0,1],waiting:[2],loans:[],round:1,updatedAt:8},teams:current.draftTeams!.teams.map((t:any)=>({index:t.index,playerIds:t.playerIds}))};
  await service._persistRotation('g',current.draftTeams,result,undefined,source);
  expect(current.draftTeamColors).toEqual({0:'blue',1:'yellow',2:'green'});
  expect(current.draftTeams!.teams.map((t:any)=>t.colorKey)).toEqual(['blue','yellow','green']);
  expect(current.draftTeams!.originalTeams!.map((t:any)=>t.colorKey)).toEqual(['blue','yellow','green']);
  expect(current.rotation!.playing).toEqual([0,1]);
});

test('colour-only saves retain roster metadata, original teams, score and clock',()=>{
  const game=fixture();game.draftTeams=createManualDraft([['a'],['b'],['c']],'owner',4);game.draftTeams.published=true;
  game.liveMatch={phase:'roundReady',scoreA:2,scoreB:1,timerRunning:false,goals:[]} as any;
  const before=structuredClone(game);
  const patch=draftColorPatch(game,{...baseline,0:'white'},baseline);
  const result={...game,...patch};
  expect(result.liveMatch).toEqual(before.liveMatch);
  expect(result.draftTeams!.teams.map(t=>t.playerIds)).toEqual(before.draftTeams!.teams.map(t=>t.playerIds));
  expect(result.draftTeams!.createdAt).toBe(4);expect(result.draftTeams!.published).toBe(true);
  expect(game).toEqual(before);
});

test('a colour edit retains partial manual work, including old-format local revision keys',()=>{
  const game=fixture();game.draftTeams=createManualDraft([['a'],['b'],['c']],'owner',4,undefined,baseline);
  const legacy=JSON.stringify([4,game.draftTeams.teams]);
  const raw=JSON.stringify({teams:[['b'],[],[]],baseDraftRevision:legacy});
  Object.assign(game,draftColorPatch(game,{...baseline,0:'white'},baseline));
  expect(hasManualDraft(raw,manualDraftRevision(game.draftTeams))).toBe(true);
  game.draftTeams!.teams[0].playerIds.push('d');
  expect(hasManualDraft(raw,manualDraftRevision(game.draftTeams))).toBe(false);
});

test.each(['finished','cancelled','rotation','stale','duplicate','unknown'])('rejected colour update is atomic: %s',async reason=>{
  const {service,current}=harness(false);
  if(reason==='finished'||reason==='cancelled')current.status=reason;
  if(reason==='rotation')current.rotation={playing:[0,1],waiting:[2],loans:[]} as any;
  const colors={...baseline,0:reason==='duplicate'?'blue':reason==='unknown'?'pink':'yellow'};
  const before=JSON.stringify(current);
  await expect(service.saveDraftTeamColors('g',colors,reason==='stale'?{...baseline,0:'white'}:baseline)).rejects.toThrow();
  expect(JSON.stringify(current)).toBe(before);
});

test('a stale allocation cannot overwrite a newer colour selection',async()=>{
  const {service,current}=harness(false),old=structuredClone(current);
  await service.saveDraftTeamColors('g',{...baseline,0:'yellow'},baseline);
  const before=JSON.stringify(current);
  await expect(service.saveDraftTeams('g',createManualDraft([['a'],['b'],['c']],'owner',4),undefined,true,old)).rejects.toThrow('DRAFT_COLORS_CHANGED');
  expect(JSON.stringify(current)).toBe(before);
});

test.each([2,3,4,7])('every supported count restores unique colours by team index (%s)',count=>{
  const teams=draftColorTeams({draftTeamColors:{0:'green',1:'white'}},count);
  expect(teams).toHaveLength(count);expect(new Set(teams.map(t=>t.colorKey)).size).toBe(count);
  expect(teams[0].colorKey).toBe('green');expect(teams[1].colorKey).toBe('white');
  expect(applyScheduledColors(Array.from({length:count},(_,index)=>({index})),{0:'green',1:'white'})).toEqual(teams);
});

test('the real Firestore converter round-trips choices before teams exist',()=>{
  const ast=ts.createSourceFile('firestore.ts',fs.readFileSync('src/firebase/firestore.ts','utf8'),ts.ScriptTarget.Latest,true);
  let converter='';const walk=(n:ts.Node)=>{if(ts.isVariableDeclaration(n)&&n.name.getText(ast)==='gameDocConverter')converter=n.initializer!.getText(ast);ts.forEachChild(n,walk);};walk(ast);
  const context:any={module:{exports:{}},Date};
  for(const match of converter.matchAll(/\b(read\w+)\(/g))context[match[1]]=(value:unknown)=>value;
  context.readDraftColors=readDraftColors;
  vm.runInNewContext(ts.transpileModule(`module.exports=${converter}`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
  const actual=context.module.exports,game={...fixture(),draftTeamColors:{...baseline,0:'white'}};
  const raw=actual.toFirestore(game);
  expect(actual.fromFirestore({id:'g',data:()=>raw}).draftTeamColors).toEqual(game.draftTeamColors);
  expect(actual.fromFirestore({id:'g',data:()=>({...raw,draftTeamColors:null})}).draftTeamColors).toBeUndefined();
  expect(readDraftColors({'0':'pink','1':'blue','99':'red'})).toEqual({1:'blue'});
});

test('an early colour subscription acknowledgement preserves the chosen opening pair and waiting order',async()=>{
  const ast=ts.createSourceFile('AdvancedLiveMatchScreen.tsx',fs.readFileSync('src/screens/AdvancedLiveMatchScreen.tsx','utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  let change='',effect='';
  const visit=(n:ts.Node)=>{
    if(ts.isVariableDeclaration(n)&&n.name.getText(ast)==='changeOpening')change=n.initializer!.getText(ast);
    if(ts.isCallExpression(n)&&n.expression.getText(ast)==='useEffect'&&n.arguments[0]?.getText(ast).includes('AsyncStorage.getItem(openingStorageKey)'))effect=n.arguments[0].getText(ast);
    ts.forEachChild(n,visit);
  };visit(ast);
  const draft=createManualDraft([['a'],['b'],['c']],'owner',1,undefined,baseline);
  const openingPlan={...initialOpeningPlan(draft),selected:[2,0],waiting:[1]};
  const plan=changeOpeningColor(openingPlan,0,'yellow');
  let acknowledge!:(patch:unknown)=>void;
  const ack=new Promise(resolve=>acknowledge=resolve);
  const setItem=jest.fn(async(_key:string,_value:string)=>{}),setOpeningPlan=jest.fn(),pendingOpeningColors={current:null};
  const context:any={module:{exports:{}},openingPlan,pendingOpeningColors,gameId:'g',openingSource:'old',openingStorageKey:'storage',
    gameService:{saveDraftTeamColors:jest.fn(()=>ack)},AsyncStorage:{setItem,getItem:jest.fn()},setOpeningBusy:jest.fn(),setOpeningPlan,setOpeningLoading:jest.fn(),setGame:jest.fn(),
    openingFingerprint:require('@/utils/openingTeams').openingFingerprint,initialOpeningPlan,rotation:undefined,
    draftTeams:{...draft,teams:draft.teams.map(t=>({...t,colorKey:plan.colors[t.index]}))},toast:{error:jest.fn()}};
  const run=(text:string)=>{vm.runInNewContext(ts.transpileModule('module.exports='+text,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);return context.module.exports;};
  const saving=run(change)(plan);
  expect(pendingOpeningColors.current).toEqual(plan);
  run(effect)(); // real subscription effect before transaction promise settles
  expect(setOpeningPlan).toHaveBeenLastCalledWith(plan);
  expect(context.AsyncStorage.getItem).not.toHaveBeenCalled();
  acknowledge({draftTeams:context.draftTeams,draftTeamColors:plan.colors});await saving;
  expect(JSON.parse(setItem.mock.calls[0][1])).toMatchObject({plan});
  expect(setOpeningPlan).toHaveBeenLastCalledWith(plan);
  expect(pendingOpeningColors.current).toBeNull();
  // Plain selection taps update immediately, and a late local-storage reply
  // must not replace a newer selection or unlock a colour transaction.
  const nextOrder={...plan,selected:[1,2],waiting:[0]};
  context.openingPlan=plan;setOpeningPlan.mockClear();context.setOpeningBusy.mockClear();
  let stored!:()=>void;
  setItem.mockImplementationOnce(()=>new Promise<void>(resolve=>stored=resolve));
  const selecting=run(change)(nextOrder);
  expect(setOpeningPlan).toHaveBeenCalledTimes(1);
  expect(setOpeningPlan).toHaveBeenCalledWith(nextOrder);
  stored();await selecting;
  expect(setOpeningPlan).toHaveBeenCalledTimes(1);
  expect(context.setOpeningBusy).not.toHaveBeenCalled();
});
