import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';

const file=ts.createSourceFile('MatchPlayersScreen.tsx',fs.readFileSync('src/screens/games/MatchPlayersScreen.tsx','utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let reload:ts.VariableDeclaration|undefined;
const hooks:ts.CallExpression[]=[];
function visit(node:ts.Node) {
 if(ts.isVariableDeclaration(node)&&node.name.getText(file)==='reload')reload=node;
 if(ts.isCallExpression(node)&&['useEffect','useFocusEffect'].includes(node.expression.getText(file))&&/\breload\(\)/.test(node.getText(file)))hooks.push(node);
 ts.forEachChild(node,visit);
}
visit(file);
function run(code:string,context:any){return vm.runInNewContext(ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);}
function request(){let resolve!:(game:any)=>void,reject!:(error:unknown)=>void;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
const game=(id='g')=>({id,players:['p'],waitlist:['w'],pending:['p'],cancellations:{c:1},adminRemovals:{r:1},adminRemovedBy:{r:'admin'},guests:[{addedBy:'admin'}]});
function fixture(controlled=false,gameId:string|undefined='g') {
 const requests:ReturnType<typeof request>[]=[];
 const mounts:Array<()=>any>=[],focus:Array<()=>any>=[];
 const context:any={controlled,gameId,currentUser:{id:'owner'},reloadRevision:{current:0},__DEV__:false,
  useCallback:(callback:any)=>callback,useEffect:(callback:any)=>mounts.push(callback),useFocusEffect:(callback:any)=>focus.push(callback),
  useUserStore:{getState:()=>({currentUser:context.currentUser})},
  gameService:{getGameById:jest.fn(()=>{const next=request();requests.push(next);return next.promise;})},
  setGame:jest.fn(),setLoading:jest.fn(),observeRoster:jest.fn(),hydratePlayers:jest.fn(),observeCaughtError:jest.fn(),logError:jest.fn()};
 context.reload=run(`(${reload!.initializer!.getText(file)})`,context);
 run(hooks.map(hook=>hook.getText(file)).join(';'),context);
 let cleanups:Array<()=>void>=[];
 const enter=()=>{cleanups=focus.map(callback=>callback()).filter(Boolean);};
 for(const mount of mounts)mount();enter();
 return {context,requests,enter,blur:()=>{for(const cleanup of cleanups)cleanup();}};
}

test('standalone first focus reads once and returning refreshes exactly once',async()=>{
 const f=fixture();expect(f.context.gameService.getGameById).toHaveBeenCalledTimes(1);
 f.requests[0].resolve(game());await flush();
 expect(f.context.hydratePlayers).toHaveBeenCalledTimes(1);
 expect(Array.from(f.context.hydratePlayers.mock.calls[0][0])).toEqual(['p','w','c','r','admin']);
 f.blur();f.enter();expect(f.context.gameService.getGameById).toHaveBeenCalledTimes(2);
});
test('embedded parent-controlled state skips automatic reads but actions can still refresh it',async()=>{
 const f=fixture(true);expect(f.context.gameService.getGameById).not.toHaveBeenCalled();
 const pending=f.context.reload();expect(f.requests).toHaveLength(1);
 const latest=game();f.requests[0].resolve(latest);await pending;
 expect(f.context.setGame).toHaveBeenCalledWith(latest);
 f.blur();f.enter();expect(f.requests).toHaveLength(1);
});
test('an older response cannot replace the result of a newer focus or clear its loader',async()=>{
 const f=fixture();f.blur();f.enter();
 f.requests[0].resolve(game('old'));await flush();
 expect(f.context.setGame).not.toHaveBeenCalled();expect(f.context.setLoading).not.toHaveBeenCalledWith(false);
 f.requests[1].resolve(game('new'));await flush();
 expect(f.context.setGame).toHaveBeenCalledTimes(1);expect(f.context.setGame.mock.calls[0][0].id).toBe('new');
 expect(f.context.setLoading).toHaveBeenLastCalledWith(false);
});
test.each(['blur','account'])('a late failure after %s cannot clear the roster or report an obsolete error',async reason=>{
 const f=fixture();if(reason==='blur')f.blur();else f.context.currentUser={id:'other'};
 f.requests[0].reject(Error('offline'));await flush();
 expect(f.context.setGame).not.toHaveBeenCalled();expect(f.context.observeCaughtError).not.toHaveBeenCalled();
 expect(f.context.logError).not.toHaveBeenCalled();expect(f.context.setLoading).not.toHaveBeenCalledWith(false);
});
test('a current failure retains the error path and a later focus can retry',async()=>{
 const f=fixture();f.requests[0].reject(Error('offline'));await flush();
 expect(f.context.setGame).toHaveBeenCalledWith(null);expect(f.context.logError).toHaveBeenCalledTimes(1);
 expect(f.context.setLoading).toHaveBeenLastCalledWith(false);
 f.blur();f.enter();f.requests[1].resolve(game());await flush();
 expect(f.context.setGame).toHaveBeenLastCalledWith(expect.objectContaining({id:'g'}));
});
test('a missing game id resolves the local empty state without a network read',()=>{
 const f=fixture(false,'');expect(f.context.gameService.getGameById).not.toHaveBeenCalled();
 expect(f.context.setGame).toHaveBeenCalledWith(null);expect(f.context.setLoading).toHaveBeenLastCalledWith(false);
});
