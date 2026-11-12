import fs from 'fs';import vm from 'vm';import ts from 'typescript';import React from 'react';
import {reviewPlayer} from '../../src/utils/ratingReview';import {reviewNights,reviewNow} from '../fixtures/ratingReview';
const flatten=(v:any):any[]=>!v||typeof v!=='object'?[]:Array.isArray(v)?v.flatMap(flatten):[v,...flatten(React.Children.toArray(v.props?.children))];
const content=(v:any)=>flatten(v).filter(n=>n.type==='Text').map(n=>React.Children.toArray(n.props.children).join('')).join(' ');
const flush=async()=>{await Promise.resolve();await Promise.resolve();await Promise.resolve();};
function fixture(){const slots:any[]=[];let index=0,effects:(()=>void)[]=[];
  const same=(a:any[],b:any[])=>a?.length===b?.length&&a?.every((x,i)=>Object.is(x,b[i]));
  const hooks={useState(initial:any){const i=index++;slots[i]??={value:initial};return [slots[i].value,(v:any)=>{slots[i].value=typeof v==='function'?v(slots[i].value):v;}];},useRef(v:any){return slots[index++]??={current:v};},useEffect(fn:any,deps:any[]){const i=index++,old=slots[i];if(!same(old?.deps,deps)){const entry:any={deps};slots[i]=entry;effects.push(()=>{old?.cleanup?.();entry.cleanup=fn();});}}};
  const read=jest.fn(),decide=jest.fn(),saved=jest.fn(),module={exports:{} as any};
  const code=ts.transpileModule(fs.readFileSync('src/components/manager/ManagerRatingReview.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText;
  vm.runInNewContext(code,{module,exports:module.exports,require:(name:string)=>name==='react'?{...React,...hooks}:name==='react-native'?{View:'View',Text:'Text',Pressable:'Pressable',TextInput:'TextInput',StyleSheet:{create:(x:any)=>x}}:name==='@/theme/rtl'?{RTL_LABEL_ALIGN:'left'}:name==='@/services/ratingReviewService'?{loadRatingReview:read,decideRatingReview:decide}:{observeCaughtError(){}}});
  const props={groupId:'club',viewerId:'admin',users:[{id:'a',name:'איתי'}],enabled:true,onEdit:jest.fn(),onSaved:saved,onRound:jest.fn()};
  return {read,decide,saved,api:module.exports,render:(over={})=>{index=0;return module.exports.ManagerRatingReview({...props,...over});},effects:()=>{const f=effects;effects=[];f.forEach(x=>x());},unmount:()=>slots.forEach(s=>s?.cleanup?.())};
}
const row=()=>reviewPlayer('a',3.5,0,0,reviewNights(),reviewNow);
const response=()=>({version:'combined-review-v1',generatedAt:reviewNow,scanned:8,basis:'basis',rows:[row()]});
test('loading or failure never looks like a completed empty recommendation list',async()=>{
  const f=fixture();f.read.mockRejectedValue(Error('not-deployed'));expect(content(f.render())).toContain('טוענים');expect(content(f.render())).not.toContain('אין שחקנים');f.effects();await flush();expect(content(f.render())).toContain('לא נטענו');f.unmount();
});
test('late replies cannot leak cards into a different viewer or club',async()=>{
  const f=fixture();let resolve:any;f.read.mockReturnValueOnce(new Promise(r=>resolve=r)).mockReturnValue(new Promise(()=>{}));f.render();f.effects();f.render({viewerId:'other',groupId:'other'});f.effects();resolve(response());await flush();expect(flatten(f.render({viewerId:'other',groupId:'other'})).some(n=>n.props?.row)).toBe(false);f.unmount();
});
test('double click produces one decision and an unmounted owner receives no refresh',async()=>{
  const f=fixture();f.read.mockResolvedValue(response());let resolve:any;f.decide.mockReturnValue(new Promise(r=>resolve=r));f.render();f.effects();await flush();const card=flatten(f.render()).find(n=>n.props?.row);card.props.onDecision('accept');card.props.onDecision('accept');expect(f.decide).toHaveBeenCalledTimes(1);f.unmount();resolve({ok:true});await flush();expect(f.saved).not.toHaveBeenCalled();
});
test('a successful keep decision refreshes the owner; a failed write exposes retry',async()=>{
  const f=fixture();f.read.mockResolvedValue(response());f.decide.mockResolvedValue({ok:true});f.render();f.effects();await flush();flatten(f.render()).find(n=>n.props?.row).props.onDecision('keep');await flush();expect(f.saved).toHaveBeenCalledTimes(1);f.unmount();
  const g=fixture();g.read.mockResolvedValue(response());g.decide.mockRejectedValue(Error('stale'));g.render();g.effects();await flush();flatten(g.render()).find(n=>n.props?.row).props.onDecision('accept');await flush();expect(content(g.render())).toContain('העדכון לא אושר');g.unmount();
});
test('callable reader rejects malformed advice and preserves evidence',()=>{
  const module={exports:{} as any};const code=ts.transpileModule(fs.readFileSync('src/services/ratingReviewService.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
  vm.runInNewContext(code,{module,exports:module.exports,require:()=>({})});const parse=module.exports.readRatingReview;
  expect(parse(response()).rows[0].eligible).toBe(8);expect(()=>parse({...response(),rows:[{...row(),proposed:NaN}]})).toThrow('rating-review-invalid');expect(()=>parse({rows:[]})).toThrow();
});
