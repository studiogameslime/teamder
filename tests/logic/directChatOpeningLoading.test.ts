import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';
function source(path:string){return ts.createSourceFile(path,fs.readFileSync(path,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);}
function find(file:ts.SourceFile,predicate:(n:ts.Node)=>boolean):any{let found:any;function visit(n:ts.Node){if(predicate(n))found=n;ts.forEachChild(n,visit);}visit(file);return found;}
const direct=source('src/screens/chat/DirectChatScreen.tsx'),chat=source('src/components/chat/ChatView.tsx');
const initializer=find(direct,n=>ts.isVariableDeclaration(n)&&n.name.getText(direct)==='refresh').initializer.getText(direct);
const marker=find(chat,n=>ts.isCallExpression(n)&&n.expression.getText(chat)==='useEffect'&&n.arguments[0]?.getText(chat).includes('chatService.markChatRead')).getText(chat);
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
function fixture(){
  let resolve!:(x:any)=>void,reject!:(x:any)=>void;
  const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
  const context:any={me:{id:'owner'},otherId:'other',official:false,generation:{current:0},seenRequest:{current:''},
    dmRequestService:{action:jest.fn(()=>promise)},useCallback:(cb:any)=>cb,
    useUserStore:{getState:()=>({currentUser:{id:'owner'}})},setAccess:jest.fn(),setFailed:jest.fn(),
    logEvent:jest.fn(),AnalyticsEvent:{ChatLoadFailed:'failed'},
  };
  const refresh=vm.runInNewContext(ts.transpileModule(`const refresh=${initializer};refresh`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
  return {context,refresh,resolve,reject};
}
test('opening only requests authoritative status, then makes the surface available',async()=>{
  const f=fixture();const pending=f.refresh();
  expect(f.context.dmRequestService.action).toHaveBeenCalledWith('owner','other','status');expect(f.context.setAccess).not.toHaveBeenCalled();
  const result={status:'compose',other:{id:'other',name:'שם'}};f.resolve(result);await pending;
  expect(f.context.setAccess).toHaveBeenCalledWith({...result,ownerId:'owner'});
});
test('blur generation and account switch each reject a delayed access response',async()=>{
  for(const change of ['blur','account']){
    const f=fixture();const pending=f.refresh();
    if(change==='blur')f.context.generation.current++;else f.context.useUserStore.getState=()=>({currentUser:{id:'new'}});
    f.resolve({status:'open'});await pending;expect(f.context.setAccess).not.toHaveBeenCalled();
  }
});
test('failure keeps the last surface mounted and observes failure without inventing an empty result',async()=>{
  const f=fixture();const pending=f.refresh();f.reject(Error('offline'));await pending;
  expect(f.context.setFailed).toHaveBeenCalledWith(true);expect(f.context.setAccess).not.toHaveBeenCalled();
  expect(f.context.logEvent).toHaveBeenCalledWith('failed',{scope:'dm',reason:'fetch_failed'});
});
function markers(suppressSignals:boolean){
  const context:any={me:{id:'owner'},scope:'dm',parentId:'other__owner',denied:false,focused:true,suppressSignals,latestMessageId:'1',
    chatService:{markChatRead:jest.fn(()=>Promise.resolve()),writeReadReceipt:jest.fn(()=>Promise.resolve())},observeCaughtError:jest.fn()};
  let previous:unknown[]|undefined;
  context.useEffect=(cb:()=>void,deps:unknown[])=>{if(!previous||deps.some((x,i)=>!Object.is(x,previous![i]))){previous=deps;cb();}};
  const run=()=>vm.runInNewContext(ts.transpileModule(marker,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
  return{context,run};
}
test('waiting and incoming request surfaces never emit shared read receipts',()=>{
  const f=markers(true);f.run();f.context.latestMessageId='2';f.run();expect(f.context.chatService.writeReadReceipt).not.toHaveBeenCalled();expect(f.context.chatService.markChatRead).not.toHaveBeenCalled();
});
test('approved chat still marks new messages and focus, while unchanged renders do not',()=>{
  const f=markers(false);f.run();f.run();expect(f.context.chatService.markChatRead).toHaveBeenCalledTimes(1);
  f.context.latestMessageId='2';f.run();expect(f.context.chatService.markChatRead).toHaveBeenCalledTimes(2);
  f.context.focused=false;f.run();f.context.focused=true;f.run();expect(f.context.chatService.markChatRead).toHaveBeenCalledTimes(3);
});
test('read marker rejection is observed without blocking the surface',async()=>{
  const f=markers(false),error=Error('offline');f.context.chatService.markChatRead.mockImplementation(()=>Promise.reject(error));f.run();await flush();
  expect(f.context.observeCaughtError).toHaveBeenCalledWith(error,expect.objectContaining({handler:'ChatView'}));
});
