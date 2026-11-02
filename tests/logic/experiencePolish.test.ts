import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';
import { activateListOwner, readListOffset, readListValue, writeListOffset, writeListValue } from '../../src/utils/listMemory';
import { acceptListUpdate, emptyListUpdates, receiveListUpdate } from '../../src/utils/listUpdates';
import { StaleSessionError } from '../../src/services/staleSession';

function runtime() {
  let slots: any[] = [], index = 0, pending: Array<() => void> = [];
  const same = (a: any[], b: any[]) => a?.length === b?.length && a?.every((v, i) => Object.is(v, b[i]));
  const hooks: any = {
    useState(initial: any) { const i=index++; slots[i]??={value:typeof initial==='function'?initial():initial}; return [slots[i].value,(v:any)=>{slots[i].value=typeof v==='function'?v(slots[i].value):v;}]; },
    useRef(initial: any) { const i=index++;return slots[i]??={current:initial}; },
    useCallback(fn: any,deps: any[]) { const i=index++;if(!same(slots[i]?.deps,deps))slots[i]={deps,value:fn};return slots[i].value; },
    useEffect(fn: any,deps: any[]) { const i=index++,old=slots[i];if(!same(old?.deps,deps)){const slot:any={deps};slots[i]=slot;pending.push(()=>{old?.cleanup?.();slot.cleanup=fn();});} },
    createElement: (type:any,props:any,...children:any[])=>({type,props:{...props,children}}),
  };
  return {hooks, begin:()=>{index=0;}, effects:()=>{const work=pending;pending=[];work.forEach(fn=>fn());}, unmount:()=>{slots.forEach(s=>s?.cleanup?.());slots=[];pending=[];} };
}
function load(file:string,dependencies:Record<string,any>,extra='') {
  const output=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React}}).outputText;
  const module={exports:{} as any};
  // The legacy global fixture bridge overrides errorObservation adapters.
  // This fixture supplies all dependencies explicitly, including its error spy.
  const run=(vm.runInNewContext as any).diagnosticOriginal ?? vm.runInNewContext;
  run(output+extra,{module,exports:module.exports,require:(name:string)=>{if(!(name in dependencies))throw Error(name);return dependencies[name];},setTimeout,clearTimeout,Date,Map,Set,Error});return module.exports;
}
const deferred=()=>{let resolve!:(v?:any)=>void,reject!:(e:Error)=>void;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
beforeEach(()=>{activateListOwner(null);});
afterEach(()=>{jest.useRealTimers();});

test('returning to a list retains filters and position, while switching owner clears all UI memory',()=>{
  activateListOwner('one');writeListValue('one','club-a','query','דני');writeListValue('one','club-a','filter','admins');writeListOffset('one','club-a',380);
  expect(readListValue('one','club-a','query','')).toBe('דני');expect(readListOffset('one','club-a')).toBe(380);expect(readListOffset('one','club-b')).toBe(0);
  activateListOwner('two');expect(readListValue('two','club-a','query','')).toBe('');writeListValue('one','club-a','query','stale');writeListOffset('one','club-a',900);
  activateListOwner('one');expect(readListValue('one','club-a','query','')).toBe('');expect(readListOffset('one','club-a')).toBe(0);
});
test('UI memory is bounded and rejects invalid offsets',()=>{
  activateListOwner('one');writeListOffset('one','first',50);for(let i=0;i<40;i++)writeListOffset('one',String(i),i);
  expect(readListOffset('one','first')).toBe(0);writeListOffset('one','x',-1);expect(readListOffset('one','x')).toBe(0);writeListOffset('one','x',42);writeListOffset('one','x',NaN);expect(readListOffset('one','x')).toBe(42);
});
function scrollFixture(initial=350,itemCount?:number){
  jest.useFakeTimers();
  activateListOwner('owner');writeListOffset('owner','a',initial);const rt=runtime();
  const hooks=load('src/hooks/useListMemory.ts',{react:rt.hooks,'react-native':{findNodeHandle:(ref:any)=>ref.tag??null},'@/utils/listMemory':{activateListOwner,readListOffset,readListValue,writeListOffset,writeListValue}});
  const render=(scope='a',ready=true)=>{rt.begin();return hooks.useRememberedScroll('owner',scope,ready,itemCount);};
  const layout=(h=200)=>({nativeEvent:{layout:{height:h}}}),scroll=(y:number)=>({nativeEvent:{contentOffset:{y}}});
  return{rt,render,layout,scroll};
}
test('a remembered offset waits for real content and survives an initial native zero event',()=>{
  const f=scrollFixture(),scrollToOffset=jest.fn();let hook=f.render('a',false);hook.ref.current={scrollToOffset};hook.onLayout(f.layout());hook.onContentSizeChange(390,1200);hook.onScroll(f.scroll(0));f.rt.effects();
  expect(scrollToOffset).not.toHaveBeenCalled();expect(readListOffset('owner','a')).toBe(350);
  hook=f.render('a',true);hook.onContentSizeChange(390,1200);f.rt.effects();jest.advanceTimersByTime(152);expect(scrollToOffset).toHaveBeenCalledWith({offset:350,animated:false});hook.onScroll(f.scroll(420));expect(readListOffset('owner','a')).toBe(420);
  hook.onContentSizeChange(390,1500);expect(scrollToOffset).toHaveBeenCalledTimes(1);f.rt.unmount();
});
test('a short skeleton cannot erase the remembered offset before the real list is measured',()=>{
  const f=scrollFixture(650),scrollToOffset=jest.fn();let hook=f.render('a',false);hook.ref.current={scrollToOffset};hook.onLayout(f.layout(600));hook.onContentSizeChange(390,300);f.rt.effects();
  const staleSkeleton=hook.onContentSizeChange;hook=f.render('a',true);f.rt.effects();
  expect(scrollToOffset).not.toHaveBeenCalled();expect(readListOffset('owner','a')).toBe(650);
  staleSkeleton(390,300);expect(readListOffset('owner','a')).toBe(650);
  hook.onContentSizeChange(390,2200);jest.advanceTimersByTime(32);expect(scrollToOffset).toHaveBeenLastCalledWith({offset:650,animated:false});expect(readListOffset('owner','a')).toBe(650);f.rt.unmount();
});
test('a confirmed empty list resets an old offset, and equal-size content gets a cancellable frame fallback',()=>{
  jest.useFakeTimers();const f=scrollFixture(650),scrollToOffset=jest.fn();let hook=f.render('a',false);hook.ref.current={scrollToOffset};hook.onLayout(f.layout(600));hook.onContentSizeChange(390,2000);f.rt.effects();
  hook=f.render('a',true);hook.onContentSizeChange(390,0);f.rt.effects();jest.advanceTimersByTime(152);expect(scrollToOffset).toHaveBeenLastCalledWith({offset:0,animated:false});expect(readListOffset('owner','a')).toBe(0);f.rt.unmount();
  const equal=scrollFixture(400);let list=equal.render('a',false);list.ref.current={scrollToOffset};list.onLayout(equal.layout(600));list.onContentSizeChange(390,2000);equal.rt.effects();equal.render('a',true);equal.rt.effects();
  jest.advanceTimersByTime(32);expect(scrollToOffset).toHaveBeenLastCalledWith({offset:400,animated:false});equal.rt.unmount();expect(jest.getTimerCount()).toBe(0);
});
test('intermediate virtualized heights do not replace the target, while dragging cancels pending restoration',()=>{
  const f=scrollFixture(1900,40),scrollToOffset=jest.fn();let hook=f.render('a',false);hook.ref.current={scrollToOffset};hook.onLayout(f.layout(600));hook.onContentSizeChange(390,650);f.rt.effects();
  hook=f.render('a',true);hook.onContentSizeChange(390,800);f.rt.effects();jest.advanceTimersByTime(32);expect(readListOffset('owner','a')).toBe(1900);hook.onScroll(f.scroll(0));expect(readListOffset('owner','a')).toBe(1900);
  jest.advanceTimersByTime(2000);expect(readListOffset('owner','a')).toBe(1900);hook.onContentSizeChange(390,3200);expect(scrollToOffset).toHaveBeenLastCalledWith({offset:1900,animated:false});hook.onScroll(f.scroll(1900));hook.onScroll(f.scroll(2000));expect(readListOffset('owner','a')).toBe(2000);f.rt.unmount();
  const dragged=scrollFixture(1900,40);let list=dragged.render('a',true);list.ref.current={scrollToOffset};list.onLayout(dragged.layout(600));list.onContentSizeChange(390,800);dragged.rt.effects();jest.advanceTimersByTime(32);list.onScrollBeginDrag();list.onScroll(dragged.scroll(40));list.onContentSizeChange(390,3200);jest.advanceTimersByTime(300);expect(readListOffset('owner','a')).toBe(40);dragged.rt.unmount();expect(jest.getTimerCount()).toBe(0);
});
test('a shorter virtualized result clamps only once its last actual item is visible',()=>{
  const f=scrollFixture(1900,3),scrollToOffset=jest.fn();const hook=f.render('a',true);hook.ref.current={scrollToOffset};hook.onLayout(f.layout(600));hook.onContentSizeChange(390,900);f.rt.effects();jest.advanceTimersByTime(2000);expect(readListOffset('owner','a')).toBe(1900);
  hook.onViewableItemsChanged({viewableItems:[{index:2,isViewable:true}]});expect(scrollToOffset).toHaveBeenLastCalledWith({offset:300,animated:false});hook.onScroll(f.scroll(300));expect(readListOffset('owner','a')).toBe(300);f.rt.unmount();
});
test('a clamp already reached by the native list is confirmed without waiting for a nonexistent second scroll event',()=>{
  const f=scrollFixture(1900,3),scrollToOffset=jest.fn();const hook=f.render('a',true);hook.ref.current={scrollToOffset};hook.onLayout(f.layout(600));hook.onContentSizeChange(390,900);f.rt.effects();jest.advanceTimersByTime(32);
  hook.onScroll(f.scroll(300));expect(readListOffset('owner','a')).toBe(1900);hook.onViewableItemsChanged({viewableItems:[{index:2,isViewable:true}]});expect(readListOffset('owner','a')).toBe(300);f.rt.unmount();
});
test('the empty component layout cannot replace the actual viewport measurement',()=>{
  const f=scrollFixture(1900,0),scrollToOffset=jest.fn();const hook=f.render('a',true);hook.ref.current={scrollToOffset,getNativeScrollRef:()=>({tag:10})};
  hook.onLayout({nativeEvent:{target:10,layout:{height:600}}});hook.onLayout({nativeEvent:{target:20,layout:{height:35}}});hook.onContentSizeChange(390,140);f.rt.effects();jest.advanceTimersByTime(32);expect(scrollToOffset).toHaveBeenLastCalledWith({offset:0,animated:false});expect(readListOffset('owner','a')).toBe(0);f.rt.unmount();
});
test('dragging before restore wins, and stale callbacks cannot modify a new list',()=>{
  const f=scrollFixture(),scrollTo=jest.fn();const old=f.render('a',false);old.ref.current={scrollTo};old.onScrollBeginDrag();old.onScroll(f.scroll(65));
  f.render('a',true);f.rt.effects();expect(readListOffset('owner','a')).toBe(65);expect(scrollTo).not.toHaveBeenCalled();
  const current=f.render('b');old.toStart();old.onScroll(f.scroll(900));old.onLayout(f.layout());old.onContentSizeChange(390,1300);expect(readListOffset('owner','a')).toBe(65);
  current.onLayout(f.layout());current.onContentSizeChange(390,1000);f.rt.effects();expect(scrollTo).toHaveBeenLastCalledWith({y:0,animated:false});f.rt.unmount();
});
const update=(state:any,ids:string[],hold=false,now=100,revisions:Record<string,string>={},scope='a',ready=true)=>receiveListUpdate(state,{ids,scope,ready,hold,now,revisions});
test('the first snapshot is a baseline, and new rows never reorder a list being read',()=>{
  let state=update(emptyListUpdates('a'),['b','c']);expect(state.highlights).toEqual({});
  state=update(state,['new','c','b'],true);expect(state.order).toEqual(['b','c']);expect(state.pending).toEqual(['new','c','b']);expect(state.highlights).toEqual({});
  state=update(state,['newer','new','c','b'],true);expect(state.order).toEqual(['b','c']);
  state=acceptListUpdate(state,400);expect(state.order).toEqual(['newer','new','c','b']);expect(state.pending).toBeNull();expect(state.highlights).toEqual({newer:400,new:400});
});
test('deleted records disappear immediately, a failed refresh preserves state, and context changes reset the baseline',()=>{
  let state=update(emptyListUpdates('a'),['a','b']);state=update(state,['new','b'],true);expect(state.order).toEqual(['b']);
  expect(update(state,[],true,200,{},'a',false)).toBe(state);
  const other=update(state,['z'],true,200,{},'other');expect(other.order).toEqual(['z']);expect(other.pending).toBeNull();expect(other.highlights).toEqual({});
});
test('returning to the start applies queued rows, changes highlight only five rows and old highlights expire',()=>{
  let state=update(emptyListUpdates('a'),['a']);state=update(state,['new','a'],true);state=update(state,['new','a']);expect(state.order).toEqual(['new','a']);expect(state.pending).toBeNull();
  const ids=['a','b','c','d','e','f','g'];state=update(state,ids,false,300,Object.fromEntries(ids.map(id=>[id,'changed'])));expect(Object.keys(state.highlights).length).toBeLessThanOrEqual(6);
  state=update(state,ids,false,1500,Object.fromEntries(ids.map(id=>[id,'changed'])));expect(state.highlights).toEqual({});
});
test('holding list order still renders fresh records and removes revoked rows immediately',()=>{
  const rt=runtime();const {useListUpdates}=load('src/hooks/useListUpdates.ts',{react:rt.hooks,'@/utils/listUpdates':{acceptListUpdate,emptyListUpdates,receiveListUpdate}});
  const render=(data:any[],scope='a')=>{rt.begin();return useListUpdates(scope,data,{ready:true,hold:true,key:(u:any)=>u.id,revision:(u:any)=>u.name});};
  const initial=[{id:'old',name:'before'}];render(initial);rt.effects();
  const fresh=[{id:'new',name:'new'},{id:'old',name:'after'}];render(fresh);rt.effects();const held=render(fresh);expect(held.items).toEqual([{id:'old',name:'after'}]);expect(held.pendingCount).toBe(1);
  const revoked=render([{id:'new',name:'new'}]);expect(revoked.items).toEqual([]);rt.effects();expect(render([{id:'other',name:'other'}],'other').items).toEqual([{id:'other',name:'other'}]);rt.unmount();
});
test('the registered counter uses the complete current roster even when new rows await display',()=>{
  const ast=ts.createSourceFile('screen.tsx',fs.readFileSync('src/screens/games/MatchPlayersScreen.tsx','utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let expression:ts.Expression|undefined;
  const visit=(n:ts.Node)=>{if(ts.isJsxAttribute(n)&&n.name.getText(ast)==='count'&&n.initializer&&ts.isJsxExpression(n.initializer)&&n.initializer.getText(ast).includes('game.maxPlayers'))expression=n.initializer.expression;ts.forEachChild(n,visit);};visit(ast);if(!expression)throw Error('registered counter');
  expect(vm.runInNewContext(expression.getText(ast),{game:{players:['one','two'],maxPlayers:14},guests:[{id:'guest'}],playerEntries:[]})).toBe('3/14');
});
test('changing conversation or account resets the chat body, while incoming messages keep the current reader mounted',()=>{
  const source=ts.createSourceFile('ChatView.tsx',fs.readFileSync('src/components/chat/ChatView.tsx','utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const wrapper=source.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='ChatView') as ts.FunctionDeclaration;
  const code=ts.transpileModule('(props)=>'+wrapper.body!.getText(source),{compilerOptions:{jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2022}}).outputText;
  let owner='one';const draw=vm.runInNewContext(code,{React:jest.requireActual('react'),ChatViewBody:'Body',useUserStore:(selector:any)=>selector({currentUser:{id:owner}})});
  const props={scope:'dm',parentId:'a',previewMessages:[{id:'first'}]},first=draw(props);
  expect(draw({...props,previewMessages:[{id:'second'}]}).key).toBe(first.key);
  expect(draw({...props,parentId:'b'}).key).not.toBe(first.key);owner='two';expect(draw(props).key).not.toBe(first.key);
});
test('the updates shortcut points toward its target, up for lists and down for newer messages',()=>{
  const {ListUpdateNotice}=load('src/components/ListUpdateNotice.tsx',{react:{__esModule:true,default:{createElement:(type:any,props:any,...children:any[])=>({type,props,children})}},'react-native':{Pressable:'Pressable',Text:'Text',StyleSheet:{create:(v:any)=>v}},'@expo/vector-icons':{Ionicons:'Icon'}});
  expect(ListUpdateNotice({count:2,noun:'שחקנים',onPress:()=>{}}).children[0].props.name).toBe('arrow-up-outline');
  expect(ListUpdateNotice({count:1,noun:'הודעות',direction:'down',onPress:()=>{}}).children[0].props.name).toBe('arrow-down-outline');
});
function feedbackFixture(){
  jest.useFakeTimers();const rt=runtime(),successHaptic=jest.fn(),toast={success:jest.fn(),info:jest.fn()};let owner='one';
  const {useConfirmedFeedback}=load('src/hooks/useConfirmedFeedback.ts',{react:rt.hooks,'@react-navigation/native':{useFocusEffect:(fn:any)=>rt.hooks.useEffect(fn,[fn])},'@/store/userStore':{useUserStore:{getState:()=>({currentUser:{id:owner}})}},'@/utils/haptics':{successHaptic},'@/components/Toast':{toast}});
  const render=(scope='one:round',id='one')=>{rt.begin();return useConfirmedFeedback(scope,id);};return{rt,render,successHaptic,toast,owner:(id:string)=>{owner=id;}};
}
test('confirmed registration feedback is short lived, and late receipts for an old account or screen stay silent',()=>{
  const f=feedbackFixture();const old=f.render();f.rt.effects();old.confirm('round','נרשמת למחזור');expect(f.render().labelFor('round')).toBe('נרשמת למחזור');expect(f.successHaptic).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime(1400);expect(f.render().labelFor('round')).toBeUndefined();
  f.render('two:round','two');f.owner('two');f.rt.effects();old.confirm('round','wrong');expect(f.successHaptic).toHaveBeenCalledTimes(1);
  const current=f.render('two:round','two');f.rt.unmount();current.confirm('round','late');expect(f.toast.success).toHaveBeenCalledTimes(1);expect(jest.getTimerCount()).toBe(0);
});
test('waitlist and approval receipts retain their actual meaning, and unknown buckets have no success fallback',()=>{
  const he={toastGameJoined:'registered',toastGameJoinedWaitlist:'waiting',toastGameJoinedPending:'approval'};
  const {registrationFeedback}=load('src/utils/registrationFeedback.ts',{'@/i18n/he':{he}});
  expect(registrationFeedback('players')).toEqual({label:'registered',tone:'success'});expect(registrationFeedback('waitlist')).toEqual({label:'waiting',tone:'info'});expect(registrationFeedback('pending')).toEqual({label:'approval',tone:'info'});expect(registrationFeedback('unexpected')).toBeNull();
});
function archiveFixture(){
  const ast=ts.createSourceFile('chat.ts',fs.readFileSync('src/services/chatService.ts','utf8'),ts.ScriptTarget.Latest,true);let method:ts.Node|undefined;
  const visit=(node:ts.Node)=>{if(ts.isMethodDeclaration(node)&&node.name.getText(ast)==='undoArchive')method=node;ts.forEachChild(node,visit);};visit(ast);if(!method)throw Error('undoArchive');
  const auth={currentUser:{uid:'owner'}},doc=jest.fn((...args)=>args),removed=Symbol('delete'),transaction={get:jest.fn(),update:jest.fn()},rejectDemoChatWrite=jest.fn();
  const context={auth,db:{},getFirebase:()=>({auth,db:{}}),rejectDemoChatWrite,StaleSessionError,doc,col:{userChatSettings:(id:string)=>id},chatKeyFor:(s:string,id:string)=>`${s}:${id}`,deleteField:()=>removed,runTransaction:async(_db:any,fn:any)=>fn(transaction)};
  const code=ts.transpileModule('({'+method.getText(ast)+'}).undoArchive',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  const undo=vm.runInNewContext(code,context);const saved={archivedAt:200,archivedMessageId:'last',muted:true,pinned:true};transaction.get.mockResolvedValue({exists:()=>true,data:()=>saved});
  const run=()=>undo('owner','dm','exact-id',{archivedAt:200,archivedMessageId:'last'},{archivedAt:0});return{auth,doc,transaction,removed,saved,rejectDemoChatWrite,run};
}
test('undo restores only archive fields using the queried ID, preserving mute and pin',async()=>{
  const f=archiveFixture();await expect(f.run()).resolves.toBe('restored');expect(f.doc).toHaveBeenCalledWith('owner','dm:exact-id');expect(f.transaction.update).toHaveBeenCalledWith(['owner','dm:exact-id'],{archivedAt:0,archivedMessageId:f.removed});
});
test.each(['missing','changed-time','changed-message'])('undo does not recreate or overwrite a %s archive',async(kind)=>{
  const f=archiveFixture();if(kind==='missing')f.transaction.get.mockResolvedValue({exists:()=>false});else if(kind==='changed-time')f.saved.archivedAt=201;else f.saved.archivedMessageId='new';
  await expect(f.run()).resolves.toBe('changed');expect(f.transaction.update).not.toHaveBeenCalled();
});
test('undo rejects stale sessions before reading and after a pending read, and demo never fakes a server receipt',async()=>{
  const f=archiveFixture();f.auth.currentUser.uid='other';await expect(f.run()).rejects.toMatchObject({name:'StaleSessionError'});expect(f.transaction.get).not.toHaveBeenCalled();
  f.auth.currentUser.uid='owner';const read=deferred();f.transaction.get.mockReturnValue(read.promise);const pending=f.run();f.auth.currentUser.uid='other';read.resolve({exists:()=>true,data:()=>f.saved});await expect(pending).rejects.toMatchObject({name:'StaleSessionError'});expect(f.transaction.update).not.toHaveBeenCalled();
  f.rejectDemoChatWrite.mockImplementation(()=>{throw Error('demo');});await expect(f.run()).rejects.toThrow('demo');
});

function toastFixture(){
  jest.useFakeTimers();const rt=runtime();let owner='owner',reduced=false;let store:any;
  const create=(factory:any)=>{let state:any;const get=()=>state;const set=(patch:any)=>{state={...state,...patch};};state=factory(set,get);const use:any=(selector?:any)=>selector?selector(state):state;use.getState=get;store=use;return use;};
  const timing=jest.fn(v=>v),spring=jest.fn(v=>v),observed=jest.fn();const animation={__esModule:true,default:{View:'AnimatedView'},Easing:{in:(x:any)=>x,out:(x:any)=>x,cubic:0},useSharedValue:(v:any)=>rt.hooks.useRef({value:v}).current,useAnimatedStyle:(fn:any)=>fn(),withTiming:timing,withSpring:spring};
  const api=load('src/components/Toast.tsx',{react:{__esModule:true,default:rt.hooks,...rt.hooks},'react-native':{StyleSheet:{create:(v:any)=>v}},'react-native-reanimated':animation,'./NoticeCard':{NoticeCard:'NoticeCard'},'react-native-safe-area-context':{useSafeAreaInsets:()=>({top:0})},zustand:{create},'@/theme':{spacing:{md:16}},'@/hooks/animations/useReducedMotion':{useReducedMotion:()=>reduced},'@/store/userStore':{useUserStore:Object.assign((selector:any)=>selector({currentUser:{id:owner}}),{getState:()=>({currentUser:{id:owner}})})},'@/utils/errorObservation':{observeCaughtError:observed},'@/services/staleSession':{isStaleSession:(e:any)=>e.name==='StaleSessionError'}});
  const render=()=>{rt.begin();const view=api.ToastHost();rt.effects();return view;};return{...api,store,rt,render,timing,spring,observed,owner:(id:string)=>{owner=id;},reduced:()=>{reduced=true;}};
}
test('undo toast prevents double taps and a late callback cannot hide a newer toast',async()=>{
  const f=toastFixture(),request=deferred(),undo=jest.fn(()=>request.promise);f.toast.action('archived',{label:'בטל',onPress:undo,ownerId:'owner'});f.render();const first=f.store.getState().act();const second=f.store.getState().act();expect(undo).toHaveBeenCalledTimes(1);
  f.toast.info('new');request.resolve();await Promise.all([first,second]);expect(f.store.getState()).toMatchObject({visible:true,message:'new',busy:false});f.rt.unmount();
});
test('undo toast failure offers a retry and never reports success',async()=>{
  const f=toastFixture(),undo=jest.fn().mockRejectedValueOnce(Error('offline')).mockResolvedValueOnce(undefined);f.toast.action('archived',{label:'בטל',onPress:undo,ownerId:'owner'});await f.store.getState().act();expect(f.store.getState()).toMatchObject({visible:true,busy:false,type:'error'});expect(f.store.getState().action).toBeDefined();expect(f.observed).toHaveBeenCalledTimes(1);await f.store.getState().act();expect(f.store.getState().visible).toBe(false);expect(undo).toHaveBeenCalledTimes(2);f.rt.unmount();
});
test('undo expires after six seconds, pauses during a request, and disappears on account change',async()=>{
  const f=toastFixture(),request=deferred(),undo=jest.fn(()=>request.promise);f.toast.action('archived',{label:'בטל',onPress:undo,ownerId:'owner'});f.render();jest.advanceTimersByTime(5999);expect(f.store.getState().visible).toBe(true);jest.advanceTimersByTime(1);expect(f.store.getState().visible).toBe(false);
  f.toast.action('archived',{label:'בטל',onPress:undo,ownerId:'owner'});f.render();const pending=f.store.getState().act();f.render();jest.advanceTimersByTime(10000);expect(f.store.getState().visible).toBe(true);request.resolve();await pending;
  f.toast.action('archived',{label:'בטל',onPress:undo,ownerId:'owner'});f.owner('other');const view=f.render();expect(view.props.accessibilityElementsHidden).toBe(true);await f.store.getState().act();expect(undo).toHaveBeenCalledTimes(1);f.rt.unmount();expect(jest.getTimerCount()).toBe(0);
});
test('reduced motion removes toast movement while retaining the notice',()=>{
  const f=toastFixture();f.reduced();f.toast.success('נשמר');const view=f.render();expect(view.props.accessibilityElementsHidden).toBe(false);expect(f.timing).not.toHaveBeenCalled();expect(f.spring).not.toHaveBeenCalled();f.rt.unmount();
});
test('the loading reveal fades once, leaves children immediately usable, and respects reduced motion',()=>{
  const rt=runtime();let reduced=false;const timing=jest.fn(v=>v),cancel=jest.fn();
  const {ContentReveal}=load('src/components/anim/ContentReveal.tsx',{react:{__esModule:true,default:rt.hooks,...rt.hooks},'react-native-reanimated':{__esModule:true,default:{View:'AnimatedView'},cancelAnimation:cancel,Easing:{out:(v:any)=>v,cubic:1},useSharedValue:(v:any)=>rt.hooks.useRef({value:v}).current,useAnimatedStyle:(fn:any)=>fn(),withTiming:timing},'@/hooks/animations/useReducedMotion':{useReducedMotion:()=>reduced}});
  const render=(ready:boolean,scope='a')=>{rt.begin();const view=ContentReveal({ready,scopeKey:scope,children:'content'});rt.effects();return view;};render(false);const view=render(true);expect(view.props.children).toEqual(['content']);expect(view.props.pointerEvents).toBeUndefined();expect(timing).toHaveBeenCalledTimes(1);render(false);render(true);expect(timing).toHaveBeenCalledTimes(1);
  reduced=true;render(false,'b');render(true,'b');expect(timing).toHaveBeenCalledTimes(1);rt.unmount();expect(cancel).toHaveBeenCalled();
});
