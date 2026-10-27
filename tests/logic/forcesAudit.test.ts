jest.mock('@/firebase/config',()=>({getFirebase:jest.fn()}));
import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';
import { validateDraftRoster } from '@/utils/draftIntegrity';
import { createManualDraft } from '@/utils/manualAllocation';
import { fillComparisonText } from '@/utils/balancedFill';
import { readTeamBalanceMeta } from '@/firebase/firestore';
import type { Game } from '@/types';

const draft=()=>createManualDraft([['a','b'],['c','guest:x']],'owner',1);
const game=()=>({id:'game',players:['a','b','c'],guests:[{id:'x',name:'אורח',addedBy:'a',createdAt:1},{id:'waiting',name:'בהמתנה',addedBy:'a',createdAt:1,waitlisted:true}],numberOfTeams:2,format:'5v5',status:'open'} as Game);
test('completed split accepts active guests while excluding queued guests',()=>expect(()=>validateDraftRoster(draft(),game(),game())).not.toThrow());
test.each(['joined','left','duplicate','captain','count','closed','format'])('atomic roster validation rejects %s instead of overwriting with stale teams',kind=>{
  const d=draft(),g=game(),expected=game();
  if(kind==='joined')g.players.push('new');
  if(kind==='left')g.players.pop();
  if(kind==='duplicate')d.teams[1].playerIds.push('a');
  if(kind==='captain')d.teams[1].captainId='a';
  if(kind==='count')g.numberOfTeams=3;
  if(kind==='closed')g.status='finished';
  if(kind==='format')g.format='7v7';
  expect(()=>validateDraftRoster(d,g,expected)).toThrow();
});
test('manual edit preserves chosen colour by team index, including the frozen snapshot',()=>{
  const old=draft();old.teams[0].colorKey='yellow';old.teams[1].colorKey='white';
  const edited=createManualDraft([['c','b'],['a','guest:x']],'owner',2,old.teams.slice().reverse());
  expect(edited.teams.map(t=>t.colorKey)).toEqual(['yellow','white']);
  expect(edited.originalTeams?.map(t=>t.colorKey)).toEqual(['yellow','white']);
  expect(edited.teams[0].playerIds).toEqual(['c','b']);
});
test('missing ratings cannot be presented as proof of equally rated teams',()=>{
  expect(fillComparisonText([['a'],['b']],{})).toContain('אין דירוג');
  expect(fillComparisonText([['a'],['b']],{a:4,b:4})).toContain('קרובים');
  expect(fillComparisonText([['a'],['b']],{a:1,b:5})).toContain('פער');
});
test('actual converter retains the random algorithm marker and rejects unknown ones',()=>{
  expect(readTeamBalanceMeta({generatedAt:1,algorithm:'random_even_v1'})?.algorithm).toBe('random_even_v1');
  expect(readTeamBalanceMeta({generatedAt:1,algorithm:'invented'})).toBeUndefined();
});
test('actual game converter preserves the server recovery marker',()=>{
  const ast=source('src/firebase/firestore.ts');let expression='';
  const visit=(node:ts.Node)=>{if(ts.isPropertyAssignment(node)&&node.name.getText(ast)==='lastCommittedRoundId')expression=node.initializer.getText(ast);ts.forEachChild(node,visit);};visit(ast);
  const context:any={module:{exports:{}}};
  vm.runInNewContext(ts.transpileModule(`module.exports=(d)=>(${expression});`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
  expect(context.module.exports({lastCommittedRoundId:'round-1'})).toBe('round-1');
  expect(context.module.exports({lastCommittedRoundId:null})).toBeUndefined();
});

function source(file:string){return ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);}
test('saved summary renders the exact unequal split for all methods instead of reconstructing captain turns',()=>{
  const ast=source('src/screens/games/DraftBoardScreen.tsx');let block='';
  const visit=(node:ts.Node)=>{if(ts.isIfStatement(node)&&node.expression.getText(ast)==='resume && game?.draftTeams')block=node.getText(ast);ts.forEachChild(node,visit);};visit(ast);
  const context:any={module:{exports:{}},React:{createElement:(type:any,props:any,...children:any[])=>({type,props,children})},
    SafeAreaView:'SafeAreaView',ScreenHeader:'ScreenHeader',ScrollView:'ScrollView',Text:'Text',View:'View',Button:'Button',DraftTeamCard:'DraftTeamCard',
    styles:{},resolve:(id:string)=>({id,name:id}),openCard:()=>{},nav:{navigate:()=>{}},gameId:'game',returnRouteKey:undefined,playersPerTeam:()=>5};
  vm.runInNewContext(ts.transpileModule(`module.exports=(game,resume,readOnly)=>{${block}}`,{compilerOptions:{target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React}}).outputText,context);
  const teams=[['a','b','c','d'],['e','f','g','h','i'],['j','k','l','m']];
  const d=createManualDraft(teams,'owner',1);d.method='snake';
  const tree=context.module.exports({draftTeams:d},true,false);const cards:any[]=[];
  const walk=(node:any)=>{if(Array.isArray(node))node.forEach(walk);else if(node){if(node.type==='DraftTeamCard')cards.push(node.props);node.children?.forEach(walk);}};walk(tree);
  expect(cards.map(p=>[p.captain.id,...p.members.map((m:any)=>m.id)])).toEqual(teams);
});
test('actual transactional save checks the current roster and leaves the saved draft intact on conflict',async()=>{
  const ast=source('src/services/gameService.ts');let method='';
  const visit=(node:ts.Node)=>{if(ts.isMethodDeclaration(node)&&node.name.getText(ast)==='saveDraftTeams')method=node.getText(ast);ts.forEachChild(node,visit);};visit(ast);
  const current=game();const update=jest.fn();
  const context:any={module:{exports:{}},validateDraftRoster,USE_MOCK_DATA:false,docs:{game:()=>({})},getFirebase:()=>({db:{}}),stripUndefined:(v:any)=>v,
    runTransaction:async(_db:any,fn:any)=>fn({get:async()=>({exists:()=>true,data:()=>current}),update}),Date};
  vm.runInNewContext(ts.transpileModule('module.exports={'+method+'}',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
  const service=context.module.exports;service.getGameById=async()=>current;
  await service.saveDraftTeams('game',draft(),undefined,true,game());
  expect(update).toHaveBeenCalledTimes(1);
  expect(update.mock.calls[0][1].teamBalanceMeta).toBeNull();
  update.mockClear();current.players.push('new');
  await expect(service.saveDraftTeams('game',draft(),undefined,true,game())).rejects.toThrow('DRAFT_ROSTER_CHANGED');
  expect(update).not.toHaveBeenCalled();
});
test('reused edit entry waits for the newly saved teams before opening manual allocation',async()=>{
  const ast=source('src/screens/games/DraftSetupScreen.tsx');let callback='';
  const visit=(node:ts.Node)=>{if(ts.isCallExpression(node)&&node.expression.getText(ast)==='useEffect'&&node.arguments[0]?.getText(ast).includes("logError('manualEntryLoad'"))callback=node.arguments[0].getText(ast);ts.forEachChild(node,visit);};visit(ast);
  let resolve:(value:any)=>void=()=>{};
  const fresh=new Promise<any>(done=>{resolve=done;});const events:any[]=[];
  const context:any={module:{exports:{}},params:{editExisting:true},loadRevision:{current:0},gameId:'game',nav:{setParams:jest.fn()},setLoadingGame:jest.fn(),setLoadFailed:jest.fn(),
    setSplitMode:(value:any)=>events.push(['mode',value]),setOpeningExisting:()=>{},setEditSavedTeams:()=>{},setGame:(value:any)=>events.push(['game',value]),
    gameService:{getGameById:jest.fn(()=>fresh)},logError:jest.fn(),toast:{error:jest.fn()}};
  vm.runInNewContext(ts.transpileModule('module.exports='+callback,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
  context.module.exports();
  expect(events).toEqual([['mode',null]]);
  const newest={id:'game',draftTeams:createManualDraft([['c','b'],['a','guest:x']],'owner',5)};
  resolve(newest);await fresh;await new Promise<void>(done=>setImmediate(done));
  expect(events).toEqual([['mode',null],['game',newest],['mode','free']]);
  expect(context.nav.setParams).toHaveBeenCalledWith({resumeManual:undefined,editExisting:undefined});
});
