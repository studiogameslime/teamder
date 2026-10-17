import fs from 'fs';
import ts from 'typescript';
import vm from 'vm';
jest.mock('@/firebase/config',()=>({getFirebase:jest.fn()}));
import {readDraftTeams} from '@/firebase/firestore';
import {createManualDraft,restoreManualTeams} from '@/utils/manualAllocation';
import {teamName} from '@/utils/teamIdentity';

function callback(operation:string) {
 const file=ts.createSourceFile('DraftSetupScreen.tsx',fs.readFileSync('src/screens/games/DraftSetupScreen.tsx','utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 let text='';
 const visit=(node:ts.Node)=>{
  if(ts.isCallExpression(node)&&['useEffect','useCallback'].includes(node.expression.getText(file))&&node.arguments[0]?.getText(file).includes(`logError('${operation}'`))text=node.arguments[0].getText(file);
  ts.forEachChild(node,visit);
 };visit(file);if(!text)throw Error('Load callback missing');return text;
}

test('a late initial read cannot replace the newly loaded split during manual edit',async()=>{
 let oldRead:(v:any)=>void=()=>{},newRead:(v:any)=>void=()=>{};
 const old=new Promise(done=>oldRead=done),fresh=new Promise(done=>newRead=done),seen:any[]=[];
 const context:any={module:{exports:{}},params:{},gameId:'round',loadRevision:{current:0},
  currentUser:{id:'owner'},myCommunities:[],MIN_TEAMS:2,MAX_TEAMS:7,
  nav:{setParams:jest.fn()},setLoadingGame:jest.fn(),setLoadFailed:jest.fn(),gameService:{getGameById:jest.fn().mockReturnValueOnce(old).mockReturnValueOnce(fresh)},
  setGame:(g:any)=>seen.push(g),setSplitMode:jest.fn(),setOpeningExisting:jest.fn(),setEditSavedTeams:jest.fn(),setAutoNumTeams:jest.fn(),hydratePlayers:jest.fn(),logError:jest.fn(),toast:{error:jest.fn()},he:{}};
 const run=(op:string)=>{vm.runInNewContext(ts.transpileModule('module.exports='+callback(op),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);return context.module.exports();};
 run('draftSetupLoad');context.params={editExisting:true};run('manualEntryLoad');
 const latest={id:'round',createdBy:'owner',draftTeams:{createdAt:2,teams:[{index:0,playerIds:['new']} ]}};
 newRead(latest);await fresh;await new Promise<void>(done=>setImmediate(done));
 oldRead({...latest,draftTeams:{createdAt:1,teams:[{index:0,playerIds:['old']}]}});await old;await new Promise<void>(done=>setImmediate(done));
 expect(seen).toEqual([latest]);
});

test.each([3,4,7])('saved team identities survive manual editing with %i unordered teams',count=>{
 const colors=['green','red','blue','white','purple','yellow','orange'];
 const teams=Array.from({length:count},(_,index)=>({index,captainId:`p${index}a`,playerIds:[`p${index}a`,`p${index}b`],colorKey:colors[index]}));
 const stored=readDraftTeams({method:'snake',createdAt:1,createdBy:'owner',numTeams:count,teams:[...teams.slice(1),teams[0]]})!;
 const roster=teams.flatMap(t=>t.playerIds);
 const manual=restoreManualTeams(Array.from({length:count},(_,index)=>stored.teams.find(t=>t.index===index)?.playerIds??[]),roster,count,7);
 const saved=readDraftTeams(createManualDraft(manual,'owner',2,stored.teams))!;
 for(const t of teams){
  const actual=saved.teams.find(row=>row.index===t.index)!;
  expect(actual.playerIds).toEqual(t.playerIds);
  expect(actual.colorKey).toBe(t.colorKey);
  expect(teamName(t.index,saved.teams)).toBe(teamName(t.index,teams));
 }
});
