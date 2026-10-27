import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';

const cases=[
 'src/screens/LiveMatchScreen.tsx',
 'src/screens/AdvancedLiveMatchScreen.tsx',
 'src/screens/games/AddMembersScreen.tsx',
 'src/screens/communities/CommunityPlayersScreen.tsx',
];
function fixture(path:string) {
 const file=ts.createSourceFile(path,fs.readFileSync(path,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 let effect:ts.CallExpression|undefined,reload:ts.VariableDeclaration|undefined;
 const roster=path.includes('CommunityPlayersScreen');
 function visit(node:ts.Node) {
  if(roster&&ts.isVariableDeclaration(node)&&node.name.getText(file)==='reload')reload=node;
  if(ts.isCallExpression(node)&&node.expression.getText(file)===(roster?'useFocusEffect':'useEffect')&&
    node.getText(file).includes(roster?'reload()':'gameService.getGameById'))effect=node;
  ts.forEachChild(node,visit);
 }
 visit(file);if(!effect)throw Error('Missing loader registration: '+path);
 const read=jest.fn(()=>new Promise(()=>{}));
 let previous:unknown[]|undefined,cleanup:(()=>void)|undefined,focusCallback:any,callbackIndex=0;
 const memoized:Array<{deps:unknown[];callback:any}>=[];
 const same=(a:unknown[]|undefined,b:unknown[])=>!!a&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
 const context:any={gameId:'g',groupId:'g',me:{id:'owner',isGuest:false},myCommunities:[],nav:{},reserve:false,
  gameService:{getGameById:read},groupService:{get:read},setLoading:jest.fn(),
  useEffect:(callback:()=>any,deps:unknown[])=>{if(!same(previous,deps)){cleanup?.();previous=deps;cleanup=callback();}},
  useCallback:(callback:any,deps:unknown[])=>{const index=callbackIndex++;if(!same(memoized[index]?.deps,deps))memoized[index]={deps,callback};return memoized[index].callback;},
  useFocusEffect:(callback:any)=>{if(callback!==focusCallback){cleanup?.();focusCallback=callback;cleanup=callback();}}};
 const run=(code:string)=>vm.runInNewContext(ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
 const render=()=>{callbackIndex=0;if(reload)context.reload=run(`(${reload.initializer!.getText(file)})`);run(effect!.getText(file));};
 render();return {context,read,render,roster};
}

test.each(cases)('profile-only updates do not reload %s; access context still does',path=>{
 const f=fixture(path);expect(f.read).toHaveBeenCalledTimes(1);
 f.context.me={...f.context.me,name:'שם מעודכן',photoUrl:'new-photo',stats:{goals:12}};f.render();
 expect(f.read).toHaveBeenCalledTimes(1);
 f.context.me={...f.context.me,isGuest:true};f.render();expect(f.read).toHaveBeenCalledTimes(2);
 f.context.me={...f.context.me,id:'other'};f.render();expect(f.read).toHaveBeenCalledTimes(3);
 f.context.myCommunities=[{id:'club',adminIds:['other']}];f.render();
 expect(f.read).toHaveBeenCalledTimes(f.roster?3:4);
 f.context.gameId='new-game';f.context.groupId='new-club';f.render();
 expect(f.read).toHaveBeenCalledTimes(f.roster?4:5);
 if(path.includes('AddMembersScreen')){
  f.context.reserve=true;f.render();expect(f.read).toHaveBeenCalledTimes(6);
 }
});
