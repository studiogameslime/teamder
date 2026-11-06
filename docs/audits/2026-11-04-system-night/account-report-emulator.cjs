// Offline integration against an explicitly local Firestore emulator and a fresh demo project.
const fs=require('fs'),path=require('path'),vm=require('vm'),ts=require('typescript');
const name='demo-night-acts-'+Date.now().toString(36);
const db='projects/'+name+'/databases/(default)';
const base='http://127.0.0.1:8080/v1/'+db+'/documents';
const now=Date.now(),start=now-60000,headers={'Content-Type':'application/json',Authorization:'Bearer owner'};
const request=async(url,body)=>{
  const r=await fetch(url,{method:'POST',headers,body:JSON.stringify(body)});
  if(!r.ok)throw Error('Local emulator '+r.status+': '+(await r.text()).slice(0,250));
  return r.json();
};
function write(n,uid='first-account') {
  return {update:{name:db+'/documents/usageActivity/'+String(n).padStart(5,'0'),fields:{
    uid:{stringValue:uid},productKey:{stringValue:'live_goal_recorded'},sortAt:{integerValue:String(start)},
    action:{stringValue:'product_action'},visitId:{stringValue:n%2?'first-visit':'second-visit'},
    platform:{stringValue:n%2?'ios':'android'}}}};
}
const known=new Set(require('../../../pulse/src/services/productActionKeys.json'));
const m={exports:{}},deps={'./usageActivityCatalog':{isProductKey:id=>known.has(id)},'./usageActivity':{usageCutoff:()=>now-86400000},'./analyticsFull':{EVENT_LABEL:{live_goal_recorded:'שער'}}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('pulse/src/services/accountActionReport.ts','utf8'),
  {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:m,exports:m.exports,require:id=>deps[id]||{}});
(async()=>{
  await request(base+':commit',{writes:Array.from({length:203},(_,i)=>write(i))});
  let pages=0;
  const result=await m.exports.readAccountActions(async body=>{
    const response=await request(base+':runQuery',body);
    if(!body.readTime)await request(base+':commit',{writes:[write(203,'later-account')]});
    else pages++;
    return response;
  },'today',now);
  const verified=result.accounts===1&&result.accepted===203&&pages===2;
  const report={source:'firestore emulator on loopback',syntheticProject:name,insertedBefore:203,insertedAfterSnapshot:1,pages,accounts:result.accounts,events:result.accepted,verified};
  fs.writeFileSync(path.join(__dirname,'account-emulator-result.json'),JSON.stringify(report,null,2)+'\n');
  console.log(report);if(!verified)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
