import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';
const {gunzipSync,strFromU8,gzipSync,strToU8}=require(require.resolve('fflate',{paths:[process.cwd()+'/pulse']}));

function fixture() {
 const request=jest.fn(),observe=jest.fn();
 const imports:any={
  './adminTransport':{pulseFetch:request},'./errorObservation':{observeCaughtError:observe},
  fflate:{gunzipSync,strFromU8},'../capabilities':{has:{appleDownloads:()=>true,playDownloads:()=>false}},
  '../config':{config:{appStore:{vendorNumber:'vendor'}}},'./auth':{appStoreJwt:()=> 'test-token'},
 };
 const module={exports:{} as any};
 ((vm.runInNewContext as any).diagnosticOriginal ?? vm.runInNewContext)(ts.transpileModule(fs.readFileSync('pulse/src/services/downloads.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,
  {module,exports:module.exports,require:(name:string)=>imports[name]??{},Date,Uint8Array});
 const response=(status:number,compressed=false)=>{const text='Units\tProduct Type Identifier\tCountry Code\n3\t1F\tIL\n';
  const bytes=compressed?gzipSync(strToU8(text)):strToU8(text);
  return {status,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)};};
 return {...module.exports,request,observe,response};
}

test('missing Apple reports are omitted and an entirely missing window is unavailable',async()=>{
 const f=fixture();f.request.mockResolvedValue(f.response(404));
 expect(await f.fetchAppleDownloads(2)).toBeNull();expect(f.observe).not.toHaveBeenCalled();
 f.request.mockResolvedValueOnce(f.response(200)).mockResolvedValueOnce(f.response(404));
 const result=await f.fetchAppleDownloads(2);expect(result.total).toBe(3);expect(result.daily).toHaveLength(1);
});
test.each([false,true])('valid Apple reports support compressed=%s without a false decompression failure',async compressed=>{
 const f=fixture();f.request.mockResolvedValue(f.response(200,compressed));
 expect(await f.fetchAppleDownloads(1)).toMatchObject({total:3,byCountry:[{name:'IL',value:3}]});
 expect(f.observe).not.toHaveBeenCalled();
});
test.each([401,403,429,500])('HTTP %s is a failure rather than zero downloads',async status=>{
 const f=fixture();f.request.mockResolvedValue(f.response(status));
 await expect(f.fetchAppleDownloads(1)).rejects.toMatchObject({code:`http/${status}`});
});
test('lifetime requests exclude today and missing reports do not invent a zero lifetime',async()=>{
 const f=fixture();f.request.mockResolvedValue(f.response(404));
 expect(await f.fetchLifetimeStats(true)).toMatchObject({ios:null});
 const dates=f.request.mock.calls.map((a:any[])=>new URL(a[0]).searchParams.get('filter[reportDate]'));
 expect(dates).not.toContain(new Date().toISOString().slice(0,10));expect(f.observe).not.toHaveBeenCalled();
});
