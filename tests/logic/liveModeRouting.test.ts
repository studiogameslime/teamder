import fs from 'fs';
import ts from 'typescript';
import vm from 'vm';

const parse=(file:string)=>ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
function loader() {
 const ast=parse('src/screens/LiveMatchScreen.tsx');let text='';
 const visit=(n:ts.Node)=>{if(ts.isFunctionDeclaration(n)&&n.name?.text==='LiveMatchScreen'){
   const walk=(c:ts.Node)=>{if(ts.isCallExpression(c)&&c.expression.getText(ast)==='useCallback')text=c.arguments[0].getText(ast);ts.forEachChild(c,walk);};walk(n);
 }ts.forEachChild(n,visit);};visit(ast);if(!text)throw Error('focus callback missing');return text;
}
const flush=()=>new Promise<void>(done=>setImmediate(done));
function harness(read:any){
 const selections:any[]=[];const context:any={module:{exports:{}},gameId:'round',gameService:{getGameById:read},setSelection:(s:any)=>selections.push(s),logError:jest.fn()};
 vm.runInNewContext(ts.transpileModule('module.exports='+loader(),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
 return {selections,context,focus:()=>context.module.exports()};
}
test.each([
 [{advancedMode:true},true],
 [{advancedMode:false,draftTeams:{teams:[{},{}]}},false],
 [{advancedMode:false,draftTeams:{completionMode:'balanced'}},true],
 [{},false],
])('focus resolves the saved live setting: %j',async(game,advanced)=>{
 const h=harness(jest.fn().mockResolvedValue(game));h.focus();await flush();
 expect(h.selections).toEqual([{gameId:'round',advanced}]);
});
test('returning from settings reloads the mode instead of retaining the first plain result',async()=>{
 const read=jest.fn().mockResolvedValueOnce({advancedMode:false}).mockResolvedValueOnce({advancedMode:true});
 const h=harness(read);const blur=h.focus();await flush();blur();h.focus();await flush();
 expect(h.selections.map(s=>s.advanced)).toEqual([false,true]);expect(read).toHaveBeenCalledTimes(2);
});
test.each([null,Error('network')])('missing game/read failure never selects the plain timer: %s',async result=>{
 const read=jest.fn();result instanceof Error?read.mockRejectedValue(result):read.mockResolvedValue(result);
 const h=harness(read);h.focus();await flush();
 expect(h.selections).toEqual([{gameId:'round',failed:true}]);expect(h.context.logError).toHaveBeenCalledTimes(1);
});
test('a read completed after blur cannot replace the newly focused selection',async()=>{
 let resolve:(g:any)=>void=()=>{};const old=new Promise(done=>{resolve=done;});
 const h=harness(jest.fn().mockReturnValueOnce(old).mockResolvedValueOnce({advancedMode:true}));
 const blur=h.focus();blur();h.focus();await flush();resolve({advancedMode:false});await flush();
 expect(h.selections).toEqual([{gameId:'round',advanced:true}]);
});
function createBanner(vars:any){
 const ast=parse('src/screens/games/MatchDetailsScreen.tsx');let expression='';
 const visit=(n:ts.Node)=>{if(ts.isVariableDeclaration(n)&&n.name.getText(ast)==='showCreateTeamsBanner')expression=n.initializer!.getText(ast);ts.forEachChild(n,visit);};visit(ast);
 return vm.runInNewContext(expression,{isAdmin:true,draftTeams:undefined,hasLocalManualDraft:false,game:{status:'active'},teamSizeFromFormat:(format:string)=>format==='4v4'?4:5,isTerminalGame:(g:any)=>['finished','cancelled'].includes(g.status),draftablePeople:10,msToKickoff:-5*60*60*1000,...vars});
}
test('ten players still expose team creation five hours after kickoff',()=>expect(createBanner({})).toBe(true));
test('four-a-side needs eight registered players, never seven',()=>{
 expect(createBanner({game:{status:'open',format:'4v4'},draftablePeople:7})).toBe(false);
 expect(createBanner({game:{status:'open',format:'4v4'},draftablePeople:8})).toBe(true);
});
test.each([{isAdmin:false},{draftTeams:{teams:[]}},{hasLocalManualDraft:true},{game:{status:'finished'}},{game:{status:'cancelled'}},{draftablePeople:1},{msToKickoff:25*60*60*1000}])('team creation keeps its other gates: %j',vars=>expect(createBanner(vars)).toBe(false));
