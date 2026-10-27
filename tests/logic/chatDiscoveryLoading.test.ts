import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';

function parse(path:string){return ts.createSourceFile(path,fs.readFileSync(path,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);}
function find(file:ts.SourceFile,predicate:(node:ts.Node)=>boolean):ts.Node {
 let result:ts.Node|undefined;
 function visit(node:ts.Node){if(!result&&predicate(node))result=node;else ts.forEachChild(node,visit);}
 visit(file);if(!result)throw Error('Missing source');return result;
}
function evaluate(code:string,ctx:any){return vm.runInNewContext(ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,ctx);}
const chat=parse('src/components/chat/ChatInbox.tsx');
const peerMemo=(find(chat,node=>ts.isVariableDeclaration(node)&&node.name.getText(chat)==='otherIds') as ts.VariableDeclaration).initializer!;
const peerHook=find(chat,node=>ts.isCallExpression(node)&&node.expression.getText(chat)==='useFocusEffect'&&node.getText(chat).includes('userService.getUserById')) as ts.CallExpression;
const flush=async()=>{for(let i=0;i<16;i++)await Promise.resolve();};
function deferred(){let resolve!:(value:any)=>void,reject!:(error:Error)=>void;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
const dm=(peer:string,message='one')=>({scope:'dm',parentId:`u__${peer}`,lastText:message});
function chatFixture(){
 const pending:ReturnType<typeof deferred>[]=[];
 const read=jest.fn(()=>{const r=deferred();pending.push(r);return r.promise;});
 let callback:()=>any=()=>{},deps:unknown[]|undefined,cleanup:(()=>void)|undefined,focused=true;
 const ctx:any={entries:{first:dm('p')},me:{id:'u'},preview:undefined,retry:0,setProfiles:jest.fn(),observeCaughtError:jest.fn(),userService:{getUserById:read},useMemo:(cb:any)=>cb(),
  useUserStore:{getState:()=>({currentUser:ctx.me})},useCallback:(cb:any,values:unknown[])=>({cb,values}),
  useFocusEffect:(next:any)=>{
   callback=next.cb;
   if(!deps||deps.length!==next.values.length||deps.some((v,i)=>!Object.is(v,next.values[i]))){deps=next.values;if(focused){cleanup?.();cleanup=callback();}}
  }};
 const render=()=>{ctx.otherIds=evaluate(`(${peerMemo.getText(chat)})`,ctx);evaluate(peerHook.getText(chat),ctx);};
 render();
 return {ctx,read,pending,render,blur:()=>{cleanup?.();focused=false;},focus:()=>{focused=true;cleanup=callback();}};
}

test('message/count changes and reordered duplicate peer entries do not reload the same private-chat identities',async()=>{
 const f=chatFixture();expect(f.read).toHaveBeenCalledTimes(1);
 f.pending[0].resolve({id:'p',name:'חבר'});await flush();
 f.ctx.entries={unrelated:{scope:'game',parentId:'round',lastText:'changed'},again:dm('p','new'),duplicate:dm('p','newest'),foreign:{scope:'dm',parentId:'a__b'}};
 f.render();
 expect(f.read).toHaveBeenCalledTimes(1);expect(JSON.parse(f.ctx.otherIds)).toEqual(['p']);
});

test('returning refreshes identities even with unchanged peer IDs, and retry also refreshes',async()=>{
 const f=chatFixture();f.pending[0].resolve({id:'p',name:'ישן'});await flush();
 f.blur();f.focus();expect(f.read).toHaveBeenCalledTimes(2);
 f.pending[1].resolve({id:'p',name:'מעודכן'});await flush();
 expect(f.ctx.setProfiles).toHaveBeenLastCalledWith({p:{id:'p',name:'מעודכן'}});
 f.ctx.retry++;f.render();expect(f.read).toHaveBeenCalledTimes(3);
});

test('a newly added peer reloads once and obsolete responses cannot replace the current peer set',async()=>{
 const f=chatFixture();f.ctx.entries={first:dm('p'),second:dm('q')};f.render();
 expect(f.read.mock.calls.map((args:any)=>args[0])).toEqual(['p','p','q']);
 f.pending[0].resolve({id:'p',name:'obsolete'});await flush();expect(f.ctx.setProfiles).not.toHaveBeenCalled();
 f.pending[1].resolve({id:'p',name:'current'});f.pending[2].resolve({id:'q',name:'new'});await flush();
 expect(f.ctx.setProfiles).toHaveBeenCalledWith({p:{id:'p',name:'current'},q:{id:'q',name:'new'}});
});

test.each(['blur','account'])('a late identity failure after %s cannot publish or report an obsolete error',async reason=>{
 const f=chatFixture();if(reason==='blur')f.blur();else f.ctx.me={id:'new-owner'};
 f.pending[0].reject(Error('offline'));await flush();
 expect(f.ctx.setProfiles).not.toHaveBeenCalled();expect(f.ctx.observeCaughtError).not.toHaveBeenCalled();
});

test('a current missing identity preserves successful peers and still records its failure',async()=>{
 const f=chatFixture();f.blur();f.ctx.entries={first:dm('p'),second:dm('q')};f.render();f.focus();
 f.pending[1].reject(Error('offline'));f.pending[2].resolve({id:'q',name:'חבר'});await flush();
 expect(f.ctx.setProfiles).toHaveBeenCalledWith({q:{id:'q',name:'חבר'}});expect(f.ctx.observeCaughtError).toHaveBeenCalledTimes(1);
});

test('resubscribing to club-admin inbox data does not erase already resolved peer identities',()=>{
 const effect=find(chat,node=>ts.isCallExpression(node)&&node.expression.getText(chat)==='useEffect'&&node.getText(chat).includes('subscribeInboxGames')) as ts.CallExpression;
 const ctx:any={preview:undefined,me:{id:'u'},adminIds:'club',setGames:jest.fn(),setProfiles:jest.fn(),setPreferences:jest.fn(),setLoading:jest.fn(),setFailed:jest.fn(),logError:jest.fn(),
  chatService:{subscribeInboxGames:()=>()=>{},subscribePreferences:()=>()=>{}}};
 evaluate(`(${effect.arguments[0].getText(chat)})`,ctx)();expect(ctx.setProfiles).not.toHaveBeenCalled();
});

const discovery=parse('src/screens/communities/PublicGroupsFeedScreen.tsx');
const discoverEffect=find(discovery,node=>ts.isCallExpression(node)&&node.expression.getText(discovery)==='useEffect'&&node.arguments[0]?.getText(discovery).includes('groupService.listPublicGroups')) as ts.CallExpression;
function discoveryFixture(text:string){
 const ctx:any={text,setLoading:jest.fn(),setItems:jest.fn(),groupService:{listPublicGroups:jest.fn(async()=>[]),searchPublicGroups:jest.fn(async()=>[])},logEvent:jest.fn(),AnalyticsEvent:{GroupSearch:'search'},observeCaughtError:jest.fn(),logError:jest.fn(),setTimeout,clearTimeout};
 return {ctx,run:()=>evaluate(`(${discoverEffect.arguments[0].getText(discovery)})`,ctx)()};
}

test('blank discovery and refresh start without the search delay, while typing still waits and cancels superseded searches',async()=>{
 jest.useFakeTimers();
 try {
  const blank=discoveryFixture('   ');blank.run();jest.advanceTimersByTime(0);await flush();expect(blank.ctx.groupService.listPublicGroups).toHaveBeenCalledTimes(1);
  blank.run();jest.advanceTimersByTime(0);await flush();expect(blank.ctx.groupService.listPublicGroups).toHaveBeenCalledTimes(2);
  const typed=discoveryFixture('old');const cancel=typed.run();jest.advanceTimersByTime(249);expect(typed.ctx.groupService.searchPublicGroups).not.toHaveBeenCalled();
  cancel();typed.ctx.text='new';typed.run();jest.advanceTimersByTime(250);await flush();
  expect(typed.ctx.groupService.searchPublicGroups.mock.calls).toEqual([['new']]);
 } finally {jest.useRealTimers();}
});
