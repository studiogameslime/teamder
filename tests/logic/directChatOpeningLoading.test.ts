import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';

function effect(path:string,contains:string) {
 const file=ts.createSourceFile(path,fs.readFileSync(path,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 let result:ts.CallExpression|undefined;
 function visit(node:ts.Node){if(ts.isCallExpression(node)&&node.expression.getText(file)==='useEffect'&&node.getText(file).includes(contains))result=node;ts.forEachChild(node,visit);}
 visit(file);if(!result)throw Error('Missing source effect');return result.getText(file);
}
const parent=effect('src/screens/chat/DirectChatScreen.tsx','chatService.ensureDmConversation');
const marker=effect('src/components/chat/ChatView.tsx','chatService.markChatRead');
const flush=async()=>{for(let i=0;i<16;i++)await Promise.resolve();};
function deferred(){let resolve!:(value?:any)=>void,reject!:(error:unknown)=>void;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
function fixture(focused=true) {
 const profile=deferred(),ensure=deferred(),touch=deferred(),read=deferred();
 let cleanup:(()=>void)|undefined,dependencies:unknown[]|undefined;
 const context:any={focused,me:{id:'owner'},otherId:'other',convId:'other__owner',reloadTick:0,scope:'dm',parentId:'other__owner',denied:false,latestMessageId:'m1',
  userService:{getUserById:jest.fn(()=>profile.promise)},
  chatService:{ensureDmConversation:jest.fn(()=>ensure.promise),touchMyDmEntry:jest.fn(()=>touch.promise),markChatRead:jest.fn(()=>read.promise),writeReadReceipt:jest.fn(()=>Promise.resolve())},
  setLoading:jest.fn(),setOther:jest.fn(),setRestricted:jest.fn(),setFailed:jest.fn(),observeCaughtError:jest.fn(),logEvent:jest.fn(),AnalyticsEvent:{ChatLoadFailed:'failed'},
  useEffect:(callback:()=>any,deps:unknown[])=>{if(!dependencies||deps.some((value,index)=>!Object.is(value,dependencies![index]))){cleanup?.();dependencies=deps;cleanup=callback();}}};
 const run=(code:string)=>vm.runInNewContext(ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
 run(parent);const stopParent=cleanup;
 const mountMessages=()=>{dependencies=undefined;run(marker);};
 return {context,profile,ensure,touch,read,mountMessages,renderMessages:()=>run(marker),blur:()=>stopParent?.()};
}
async function open(f:ReturnType<typeof fixture>) {
 f.profile.resolve({id:'other',name:'חבר'});await flush();
 f.ensure.resolve('other__owner');await flush();f.touch.resolve();await flush();
}

test('opening awaits the access gate and inbox entry, then mounts without a duplicate read-marker write',async()=>{
 const f=fixture();f.profile.resolve({id:'other',name:'חבר'});await flush();
 expect(f.context.chatService.ensureDmConversation).toHaveBeenCalledTimes(1);
 expect(f.context.chatService.touchMyDmEntry).not.toHaveBeenCalled();expect(f.context.setLoading).not.toHaveBeenCalledWith(false);
 f.ensure.resolve('other__owner');await flush();
 expect(f.context.chatService.touchMyDmEntry).toHaveBeenCalledTimes(1);expect(f.context.setLoading).not.toHaveBeenCalledWith(false);
 f.touch.resolve();await flush();
 expect(f.context.setLoading).toHaveBeenLastCalledWith(false);expect(f.context.chatService.markChatRead).not.toHaveBeenCalled();
 f.mountMessages();expect(f.context.chatService.markChatRead).toHaveBeenCalledTimes(1);
 expect(f.context.chatService.markChatRead).toHaveBeenCalledWith('owner','dm','other__owner');
 expect(f.context.chatService.writeReadReceipt).toHaveBeenCalledTimes(1);
});
test('the shared effect still marks new messages and refocus, while unchanged renders do not',async()=>{
 const f=fixture();await open(f);f.mountMessages();f.renderMessages();
 expect(f.context.chatService.markChatRead).toHaveBeenCalledTimes(1);
 f.context.latestMessageId='m2';f.renderMessages();expect(f.context.chatService.markChatRead).toHaveBeenCalledTimes(2);
 f.context.focused=false;f.renderMessages();expect(f.context.chatService.markChatRead).toHaveBeenCalledTimes(2);
 f.context.focused=true;f.renderMessages();expect(f.context.chatService.markChatRead).toHaveBeenCalledTimes(3);
});
test('a read-marker failure is observed by the shared effect without blocking the opened conversation',async()=>{
 const f=fixture();await open(f);f.mountMessages();const error=Error('offline');f.read.reject(error);await flush();
 expect(f.context.observeCaughtError).toHaveBeenCalledWith(error,expect.objectContaining({handler:'ChatView'}));
 expect(f.context.setLoading).toHaveBeenLastCalledWith(false);expect(f.context.setFailed).not.toHaveBeenCalledWith(true);
});
test.each(['permission-denied','unavailable'])('an access failure remains %s and never starts entry/read writes',async code=>{
 const f=fixture();f.profile.resolve({id:'other',name:'חבר'});await flush();
 f.ensure.reject({code});await flush();
 expect(code==='permission-denied'?f.context.setRestricted:f.context.setFailed).toHaveBeenCalledWith(true);
 expect(f.context.chatService.touchMyDmEntry).not.toHaveBeenCalled();expect(f.context.chatService.markChatRead).not.toHaveBeenCalled();
 expect(f.context.setLoading).toHaveBeenLastCalledWith(false);
});
test('a blurred opening does not continue after identity resolution',async()=>{
 const f=fixture();f.blur();f.profile.resolve({id:'other',name:'חבר'});await flush();
 expect(f.context.chatService.ensureDmConversation).not.toHaveBeenCalled();expect(f.context.setLoading).not.toHaveBeenCalledWith(false);
});
