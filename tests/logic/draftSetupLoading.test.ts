import fs from 'fs';
import ts from 'typescript';
import vm from 'vm';

const file=ts.createSourceFile('DraftSetupScreen.tsx',fs.readFileSync('src/screens/games/DraftSetupScreen.tsx','utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let loader='',gate='';
function visit(node:ts.Node){
 if(ts.isCallExpression(node)&&node.expression.getText(file)==='useCallback'&&node.arguments[0].getText(file).includes("logError('draftSetupLoad'"))loader=node.arguments[0].getText(file);
 if(ts.isIfStatement(node)&&node.expression.getText(file).startsWith('loadingGame ||'))gate=node.expression.getText(file);
 ts.forEachChild(node,visit);
}visit(file);
const flush=()=>new Promise<void>(done=>setImmediate(done));
function setup(){
 const state:any={loading:false,failed:false,game:{id:'round',old:true},count:2};
 const scope:any={module:{exports:{}},params:{},gameId:'round',loadRevision:{current:0},gameService:{getGameById:jest.fn()},currentUser:{id:'admin'},myCommunities:[],MIN_TEAMS:2,MAX_TEAMS:5,
 setLoadingGame:(v:boolean)=>state.loading=v,setLoadFailed:(v:boolean)=>state.failed=v,setGame:(v:any)=>state.game=v,setAutoNumTeams:(v:number)=>state.count=v,hydratePlayers:jest.fn(),toast:{info:jest.fn()},he:{draftAdminOnly:'admin only'},nav:{canGoBack:()=>true,goBack:jest.fn()},logError:jest.fn()};
 vm.runInNewContext(ts.transpileModule(`module.exports=${loader}`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,scope);
 const blocked=()=>vm.runInNewContext(gate,{loadingGame:state.loading,loadFailed:state.failed,openingExisting:false,game:state.game,gameId:'round'});
 return {state,scope,focus:scope.module.exports,blocked};
}
const game=(extra={})=>({id:'round',createdBy:'admin',players:['one','two'],numberOfTeams:3,...extra});
test('the method chooser stays hidden until the current round and configured team count arrive together',async()=>{
 const {state,scope,focus,blocked}=setup();let resolve!:(value:any)=>void;scope.gameService.getGameById.mockReturnValue(new Promise(done=>resolve=done));
 focus();expect(blocked()).toBe(true);expect(state.count).toBe(2);resolve(game());await flush();expect(blocked()).toBe(false);expect(state.count).toBe(3);expect(state.game.old).toBeUndefined();
});
test.each([undefined,Error('offline')])('missing or failed round loading offers failure instead of the old method chooser: %s',async result=>{
 const {state,scope,focus,blocked}=setup();result instanceof Error ? scope.gameService.getGameById.mockRejectedValue(result) : scope.gameService.getGameById.mockResolvedValue(result);
 focus();await flush();expect(state.loading).toBe(false);expect(state.failed).toBe(true);expect(blocked()).toBe(true);
 scope.gameService.getGameById.mockResolvedValue(game());focus();await flush();expect(state.failed).toBe(false);expect(blocked()).toBe(false);
});
test('leaving a reused setup hides its previous content and ignores a response from the previous visit',async()=>{
 const {state,scope,focus,blocked}=setup();let old!:(value:any)=>void;scope.gameService.getGameById.mockReturnValueOnce(new Promise(done=>old=done)).mockResolvedValueOnce(game({numberOfTeams:4}));
 const blur=focus();blur();expect(blocked()).toBe(true);focus();await flush();old(game({numberOfTeams:2}));await flush();expect(state.count).toBe(4);expect(blocked()).toBe(false);
});
test('explicit manual entry is not raced by the normal focus reader',()=>{
 const {scope,focus}=setup();scope.params.resumeManual=true;focus();expect(scope.gameService.getGameById).not.toHaveBeenCalled();
});
