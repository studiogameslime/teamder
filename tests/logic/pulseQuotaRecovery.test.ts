import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function fixture(){
 const source=ts.createSourceFile('quota.ts',fs.readFileSync('pulse/src/services/quota.ts','utf8'),99,true);
 const names=['iso','quotaRead','metricSum','metricByType','schedulerJobs'];
 const parts=source.statements.filter(n=>ts.isFunctionDeclaration(n)&&names.includes(n.name?.text??'')).map(n=>n.getText(source));
 const origins=new WeakMap<object,unknown>(),fetch=jest.fn(),delays:number[]=[];
 const observe=jest.fn((error:object,origin:unknown)=>origins.set(error,origin));
 const context:any={module:{exports:{}},fetch,Date,Map,Promise,Number,PID:'project',SCHEDULER_LOCATIONS:['a','b','c','d'],observeCaughtError:observe,caughtErrorOrigin:(e:object)=>origins.get(e),encodeURIComponent,setTimeout:(fn:()=>void,ms:number)=>{delays.push(ms);fn();}};
 vm.runInNewContext(ts.transpileModule(parts.join('\n')+'\nmodule.exports={metricSum,metricByType,schedulerJobs};',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
 return{api:context.module.exports,fetch,observe,delays};
}
const response=(json:any,ok=true)=>({ok,json:async()=>json});
test('a transient DNS outage retries bounded GET reads and returns the real metric without a false incident',async()=>{
 const f=fixture();f.fetch.mockRejectedValueOnce(Error('UnknownHostException')).mockRejectedValueOnce(Error('Network request failed')).mockResolvedValue(response({timeSeries:[{points:[{value:{int64Value:'13'}}]}]}));
 expect(await f.api.metricSum('token','metric',0,1000)).toBe(13);expect(f.fetch).toHaveBeenCalledTimes(3);expect(f.delays).toEqual([250,750]);expect(f.observe).not.toHaveBeenCalled();
});
test.each(['metricSum','metricByType'])('a continuing outage leaves %s unavailable and is reported once after bounded retry',async name=>{
 const f=fixture();f.fetch.mockRejectedValue(Error('fetch failed'));expect(await f.api[name]('token','metric',0,1000)).toBeNull();expect(f.fetch).toHaveBeenCalledTimes(3);expect(f.observe).toHaveBeenCalledTimes(1);
});
test('an unexpected non-network failure is reported without retry or a false zero',async()=>{
 const f=fixture();f.fetch.mockRejectedValue(Error('decoder failed'));expect(await f.api.metricSum('token','metric',0,1000)).toBeNull();expect(f.fetch).toHaveBeenCalledTimes(1);expect(f.observe).toHaveBeenCalledTimes(1);
});
test('an empty successful scheduler response is a known zero',async()=>{
 const f=fixture();f.fetch.mockResolvedValue(response({}));expect(await f.api.schedulerJobs('token')).toMatchObject({count:0,names:[]});expect(f.observe).not.toHaveBeenCalled();
});
test('one failed scheduler region never presents a partial job count as the project total',async()=>{
 const f=fixture();f.fetch.mockImplementation(async(url:string)=>{if(url.includes('/b/'))throw Error('UnknownHostException');return response({jobs:[{name:'projects/p/jobs/job'}]});});
 expect(await f.api.schedulerJobs('token')).toBeNull();expect(f.fetch).toHaveBeenCalledTimes(6);expect(f.observe).toHaveBeenCalledTimes(1);
});
test('an explicit scheduler API error remains unavailable even when other regions succeeded',async()=>{
 const f=fixture();f.fetch.mockImplementation(async(url:string)=>response(url.includes('/b/')?{error:{code:403}}:{jobs:[]},!url.includes('/b/')));expect(await f.api.schedulerJobs('token')).toBeNull();
});
