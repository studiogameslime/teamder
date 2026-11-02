import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';

function fixture(samples: {rtt:number; offset?:number; fail?:boolean; now?:unknown}[], cached = 700) {
  let clock = 2_000_000_000_000;
  const stored = jest.fn(async () => {});
  const call = jest.fn(async () => {
    const sample = samples.shift()!;
    const start = clock; clock += sample.rtt;
    if (sample.fail) throw Object.assign(Error('internal'),{code:'functions/internal'});
    return {data:{now:sample.now ?? start + sample.rtt/2 + (sample.offset ?? 0)}};
  });
  const callable = jest.fn(() => call);
  const deps: Record<string, unknown> = {
    '@react-native-async-storage/async-storage': {getItem:async()=>String(cached),setItem:stored},
    '@/firebase/config': {getFirebase:()=>({functions:{}})},
    '@/services/diagnosticCallable': {httpsCallable:callable},
    '../utils/errorObservation': {observeCaughtError:jest.fn()},
  };
  const mod = {exports:{} as any};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/services/serverClock.ts','utf-8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},
  }).outputText,{module:mod,exports:mod.exports,require:(id:string)=>deps[id],Date:{now:()=>clock}});
  return {service:mod.exports,stored,callable,call};
}

test('server clock rejects responses delayed by suspension and retains the cached correction',async()=>{
  const f=fixture([{rtt:179343,offset:90000},{rtt:5000,fail:true},{rtt:5000,fail:true}]);
  expect(await f.service.syncServerClock(true)).toBe(700);
  expect(f.stored).not.toHaveBeenCalled();
  expect(f.callable).toHaveBeenCalledWith({},'getServerTime',{timeout:5000});
});

test('server clock selects the fastest valid sample and shares concurrent synchronisation',async()=>{
  const f=fixture([{rtt:300,offset:50},{rtt:100,offset:60},{rtt:150,offset:55}]);
  expect(await Promise.all([f.service.syncServerClock(true),f.service.syncServerClock(true)])).toEqual([60,60]);
  expect(f.call).toHaveBeenCalledTimes(3);
  expect(f.stored).toHaveBeenCalledWith('@teamder/serverClockOffset','60');
});

test('invalid server timestamps and backwards device-clock samples cannot replace a known offset',async()=>{
  const f=fixture([{rtt:-100,offset:1},{rtt:100,now:0},{rtt:100,now:'invalid'}],-450);
  expect(await f.service.syncServerClock(true)).toBe(-450);
  expect(f.stored).not.toHaveBeenCalled();
});
