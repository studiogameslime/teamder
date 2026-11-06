import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';
import { roundVisit, roundChanges, parseRoundVisit } from '@/utils/roundVisit';

function runtime() {
  let slots:any[]=[],index=0,pending:Array<()=>void>=[];
  const same=(a:any[],b:any[])=>a?.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
  const hooks:any={
    useState(initial:any){const i=index++;slots[i]??={value:typeof initial==='function'?initial():initial};return [slots[i].value,(v:any)=>{slots[i].value=typeof v==='function'?v(slots[i].value):v;}];},
    useRef(initial:any){const i=index++;return slots[i]??={current:initial};},
    useCallback(fn:any,deps:any[]){const i=index++;if(!same(slots[i]?.deps,deps))slots[i]={deps,value:fn};return slots[i].value;},
    useEffect(fn:any,deps:any[]){const i=index++,old=slots[i];if(!same(old?.deps,deps)){const slot:any={deps};slots[i]=slot;pending.push(()=>{old?.cleanup?.();slot.cleanup=fn();});}},
    createElement:(type:any,props:any,...children:any[])=>({type,props:{...props,children}}),
  };
  return {hooks,begin:()=>{index=0;},effects:()=>{const p=pending;pending=[];p.forEach(f=>f());},unmount:()=>{slots.forEach(s=>s?.cleanup?.());slots=[];pending=[];}};
}
function load(file:string,deps:Record<string,any>) {
  const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText;
  const exports:any={};vm.runInNewContext(code,{exports,require:(id:string)=>{if(!(id in deps))throw Error('Missing adapter '+id);return deps[id];},setTimeout,clearTimeout});return exports;
}
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
const deferred=()=>{let resolve!:(v:any)=>void,reject!:(e:any)=>void;const promise=new Promise<any>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const game=(id='round',startsAt=100,fieldName='מגרש ראשון')=>({id,startsAt,fieldName,fieldAddress:'רחוב ראשון',city:'תל אביב',fieldLat:32,fieldLng:34});

test('round change badges distinguish first visit, time, location, removal and normalized whitespace',()=>{
  const initial=roundVisit(game());
  expect(roundChanges(null,initial)).toEqual({time:false,location:false});
  expect(roundChanges(initial,roundVisit({...game(),fieldName:' מגרש   ראשון '}))).toEqual({time:false,location:false});
  expect(roundChanges(initial,roundVisit({...game(),startsAt:200}))).toEqual({time:true,location:false});
  expect(roundChanges(initial,roundVisit({...game(),fieldLat:33}))).toEqual({time:false,location:true});
  expect(roundChanges(initial,roundVisit({...game(),fieldName:''}))).toEqual({time:false,location:true});
});
test.each([null,[],{}, {startsAt:'100'}, {...roundVisit(game()),lat:NaN}])('invalid local visit memory does not invent a change: %j',value=>{expect(parseRoundVisit(value)).toBeNull();});

function visitFixture(stored:any=null) {
  const rt=runtime(),read=jest.fn(async()=>stored),save=jest.fn(async()=>undefined);
  const mod=load('src/hooks/useRoundChanges.ts',{'react':rt.hooks,'@react-navigation/native':{useFocusEffect:(cb:any)=>rt.hooks.useEffect(cb,[cb])},'@/utils/roundVisit':{roundVisit,roundChanges},'@/services/roundVisitService':{readRoundVisit:read,saveRoundVisit:save},'@/utils/errorObservation':{observedRejection:(callback:any)=>callback}});
  const draw=(owner='owner',id='round',value:any=game())=>{rt.begin();const result=mod.useRoundChanges(owner,id,value);rt.effects();return result;};
  return {rt,read,save,draw};
}
test('first visit stays quiet, live changes remain highlighted until leaving, then newest visible facts are saved',async()=>{
  const f=visitFixture();expect(f.draw()).toEqual({time:false,location:false});await flush();f.draw();
  expect(f.draw('owner','round',game('round',200))).toEqual({time:true,location:false});
  expect(f.draw('owner','round',game('round',200))).toEqual({time:true,location:false});
  f.rt.unmount();expect(f.save).toHaveBeenCalledWith('owner','round',roundVisit(game('round',200)));
});
test('a previous visit compares against current facts and a direct route switch saves the previous round under its own identity',async()=>{
  const f=visitFixture(roundVisit(game()));f.draw('owner','round',game('round',200,'מגרש שני'));await flush();
  expect(f.draw('owner','round',game('round',200,'מגרש שני'))).toEqual({time:true,location:true});
  expect(f.draw('owner','other',game('other',300))).toEqual({time:false,location:false});
  expect(f.save).toHaveBeenCalledWith('owner','round',roundVisit(game('round',200,'מגרש שני')));
  f.rt.unmount();
});
test('late storage replies from another account cannot reveal its change badge or acknowledge its data for the new owner',async()=>{
  const f=visitFixture(),old=deferred(),current=deferred();f.read.mockImplementationOnce(()=>old.promise).mockImplementationOnce(()=>current.promise);
  f.draw();f.draw('new-owner','other',game('other'));old.resolve(roundVisit(game('round',999)));await flush();
  expect(f.draw('new-owner','other',game('other'))).toEqual({time:false,location:false});
  current.resolve(null);await flush();expect(f.draw('new-owner','other',game('other'))).toEqual({time:false,location:false});
  f.rt.unmount();expect(f.save).toHaveBeenLastCalledWith('new-owner','other',roundVisit(game('other')));
});
test('no accessible round means no stored acknowledgement',async()=>{
  const f=visitFixture();f.draw();await flush();f.draw('owner','round',null);f.rt.unmount();expect(f.save).not.toHaveBeenCalled();
});

function noticeFixture() {
  const rt=runtime();const mod=load('src/components/ReadStatusNotice.tsx',{'react':rt.hooks,'react-native':{View:'View',Text:'Text',StyleSheet:{create:(v:any)=>v}},'@expo/vector-icons':{Ionicons:'Icon'},'@/components/Button':{Button:'Button'},'@/theme':{colors:{},RTL_LABEL_ALIGN:'left'}});
  const draw=(props:any)=>{rt.begin();const result=mod.ReadStatusNotice(props);rt.effects();return result;};
  const operation=(props:any)=>{rt.begin();const result=mod.OperationStatus(props);rt.effects();return result;};
  return {rt,draw,operation};
}
const all=(tree:any):any[]=>!tree||typeof tree!=='object'?[]:Array.isArray(tree)?tree.flatMap(all):[tree,...all(tree.props?.children)];
const copy=(tree:any)=>all(tree).filter(x=>x.type==='Text').flatMap(x=>x.props.children).join(' ');
beforeEach(()=>jest.useFakeTimers());afterEach(()=>jest.useRealTimers());
test('fast reads add no notice; slow reads identify old data without claiming connectivity or success',()=>{
  const f=noticeFixture(),p={loading:true,failed:false,hasData:true,scope:'a',onRetry:jest.fn()};
  expect(f.draw(p)).toBeNull();jest.advanceTimersByTime(5999);expect(f.draw(p)).toBeNull();jest.advanceTimersByTime(1);
  expect(copy(f.draw(p))).toContain('מוצג מידע שכבר נטען');expect(copy(f.draw(p))).not.toContain('אין חיבור');
  expect(f.draw({...p,loading:false})).toBeNull();f.rt.unmount();
});
test('failed first load has retry and no empty-list claim; confirmed empty snapshots still count as prior data',()=>{
  const f=noticeFixture(),onRetry=jest.fn(),p={loading:false,failed:true,hasData:false,scope:'a',onRetry};
  const tree=f.draw(p);expect(copy(tree)).toContain('המידע עדיין לא זמין');all(tree).find(x=>x.type==='Button').props.onPress();expect(onRetry).toHaveBeenCalledTimes(1);
  expect(copy(f.draw({...p,hasData:true}))).toContain('ייתכן שהפרטים השתנו');f.rt.unmount();
});
test('slow hints reset immediately on a different scope and cancelled timers cannot reappear',()=>{
  const f=noticeFixture(),p={loading:true,failed:false,hasData:false,scope:'a',onRetry:jest.fn()};f.draw(p);jest.advanceTimersByTime(6000);expect(f.draw(p)).not.toBeNull();
  expect(f.draw({...p,scope:'b'})).toBeNull();f.draw({...p,loading:false,scope:'b'});jest.runAllTimers();expect(f.draw({...p,loading:false,scope:'b'})).toBeNull();f.rt.unmount();
});
test('long writes remain pending and never announce success or offer another write',()=>{
  const f=noticeFixture(),p={active:true,label:'שומרים את הפרופיל',scope:'write',awaitingConfirmation:true};f.operation(p);jest.advanceTimersByTime(6000);
  const tree=f.operation(p);expect(copy(tree)).toContain('אין צורך ללחוץ שוב');expect(copy(tree)).not.toContain('נשמר');expect(all(tree).some(x=>x.type==='Button')).toBe(false);
  expect(f.operation({...p,active:false})).toBeNull();f.rt.unmount();
});
