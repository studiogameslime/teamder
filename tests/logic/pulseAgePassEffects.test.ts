import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function expression(path:string,predicate:(n:ts.Node,s:ts.SourceFile)=>boolean){
 const s=ts.createSourceFile(path,fs.readFileSync(path,'utf8'),99,true,ts.ScriptKind.TSX);let result:ts.Node|undefined;
 function visit(n:ts.Node){if(predicate(n,s))result=n;else ts.forEachChild(n,visit);}visit(s);if(!result)throw Error('Missing source');return result.getText(s);
}
const evaluate=(text:string,context:any)=>vm.runInNewContext(ts.transpileModule(`(${text})`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
const capture=expression('src/components/support/SupportChatHost.tsx',(n,s)=>ts.isArrowFunction(n)&&n.getText(s).includes('const sameSource ='));
function captureFixture(){
 let run:any;const owner={id:'me'},source={screen:'Profile'};
 const c:any={capturing:true,uid:'me',draft:{context:{...source}},mounted:{current:true},Platform:{OS:'android'},setTimeout:(fn:any)=>{run=fn;return 1;},clearTimeout:jest.fn(),useUserStore:{getState:()=>({currentUser:owner})},captureSupportContext:()=>source,
  captureFullScreenBase64:jest.fn(async()=>'image'),captureScreen:jest.fn(async()=>'fallback'),state:{patch:jest.fn()},setError:jest.fn(),setCapturing:jest.fn(),observeCaughtError:jest.fn()};
 const cleanup=evaluate(capture,c)();return{c,owner,source,start:async()=>{run();await flush();},cleanup};
}
test.each(['before','after'])('changing the screenshot source %s capture is recoverable, never attaches the wrong image or logs a crash',async timing=>{
 const f=captureFixture();if(timing==='before')f.source.screen='Other';else f.c.captureFullScreenBase64.mockImplementation(async()=>{f.source.screen='Other';return 'image';});
 await f.start();expect(f.c.state.patch).not.toHaveBeenCalled();expect(f.c.observeCaughtError).not.toHaveBeenCalled();expect(f.c.setError).toHaveBeenCalled();expect(f.c.setCapturing).toHaveBeenCalledWith(false);
});
test('a real current screenshot failure remains reported, and an obsolete failure is ignored',async()=>{
 const f=captureFixture();f.c.captureFullScreenBase64.mockRejectedValue(Error('native failure'));await f.start();expect(f.c.observeCaughtError).toHaveBeenCalledTimes(1);
 const stale=captureFixture();stale.c.captureFullScreenBase64.mockImplementation(async()=>{stale.owner.id='other';throw Error('native failure');});await stale.start();expect(stale.c.observeCaughtError).not.toHaveBeenCalled();expect(stale.c.state.patch).not.toHaveBeenCalled();
});
test('a cancelled capture does not call the native capture or write a draft',async()=>{const f=captureFixture();f.cleanup();await f.start();expect(f.c.captureFullScreenBase64).not.toHaveBeenCalled();expect(f.c.state.patch).not.toHaveBeenCalled();});
const create=expression('src/screens/groups/CreateGroupScreen.tsx',(n,s)=>ts.isVariableDeclaration(n)&&n.name.getText(s)==='createFromValues');
test.each(['VALIDATION_ERROR','permission-denied'])('club creation %s preserves user feedback and reports only unexpected failures',async code=>{
 const c:any={useUserStore:{getState:()=>({currentUser:{id:'me'}})},draftStore:{write:async()=>({id:'draft'})},draftIdRef:{current:'draft'},createClubFromValues:async()=>{throw Object.assign(Error('rejected'),{code});},observeCaughtError:jest.fn(),logError:jest.fn(),logEvent:jest.fn(),AnalyticsEvent:{},Platform:{OS:'android'},he:{error:'error'},appAlert:jest.fn()};
 const arrow=create.slice(create.indexOf('=')+1);await evaluate(arrow,c)({});expect(c.appAlert).toHaveBeenCalled();expect(c.observeCaughtError).toHaveBeenCalledTimes(code==='VALIDATION_ERROR'?0:1);expect(c.logError).toHaveBeenCalledTimes(code==='VALIDATION_ERROR'?0:1);
});
const friends=expression('src/components/chat/ChatInbox.tsx',(n,s)=>ts.isArrowFunction(n)&&n.getText(s).includes('friendsService.listFriends(me.id)'));
test.each(['FriendOwnerMissingError','Error','stale'])('friend-list failure %s never becomes a successful empty answer',async name=>{
 const owner={id:'me'},failure=Object.assign(Error('missing'),{name});const c:any={mode:'new',preview:undefined,me:{id:'me'},useUserStore:{getState:()=>({currentUser:owner})},friendsService:{listFriends:jest.fn(async()=>{if(name==='stale')owner.id='other';throw failure;})},setFriends:jest.fn(),setFriendsLoading:jest.fn(),setFriendsFailed:jest.fn(),observeCaughtError:jest.fn()};
 evaluate(friends,c)();await flush();expect(c.setFriends).toHaveBeenCalledTimes(1);expect(c.setFriendsFailed).toHaveBeenCalledWith(false);
 if(name==='stale'){expect(c.setFriendsFailed).not.toHaveBeenCalledWith(true);expect(c.observeCaughtError).not.toHaveBeenCalled();}
 else{expect(c.setFriendsFailed).toHaveBeenCalledWith(true);expect(c.observeCaughtError).toHaveBeenCalledTimes(name==='Error'?1:0);}
});
