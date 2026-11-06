const fs=require('fs'),vm=require('vm'),ts=require('typescript'),path=require('path');
const {createRequire}=require('module');
const localRequire=createRequire(path.resolve('src/services/usageActivityQueue.ts'));
const catalogCode=ts.transpileModule(fs.readFileSync('src/utils/usageActivity.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
const catalog={exports:{}};
vm.runInNewContext(catalogCode,{module:catalog,exports:catalog.exports,require:name=>require(path.resolve('src/utils',name))});
const queueCode=ts.transpileModule(fs.readFileSync('src/services/usageActivityQueue.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const moduleOutput={exports:{}};
vm.runInNewContext(queueCode,{module:moduleOutput,exports:moduleOutput.exports,require:name=>name.includes('utils/usageActivity')?catalog.exports:localRequire(name)});
const options={storage:{getItem:async()=>null,setItem:async()=>new Promise(()=>{})},now:()=>1_800_000_000_000,
  uuid:()=> 'review-pending-visit',identity:()=> 'first',platform:'android',appVersion:'review',
  send:async()=>({acknowledged:[]}),diagnostic:()=>{}};
const queue=new moduleOutput.exports.UsageActivityQueue(options);
queue.start();
for(let index=0;index<800;index++)queue.beginRegistration('game-a','operation-'+index)('failed');
const result={scenario:'800 immediate registration outcomes while local storage never completes',
  pending:queue.pending.length,limit:500,exceeded:queue.pending.length>500,productionDataAccess:false};
fs.writeFileSync(path.join(__dirname,'queue-review-probe.json'),JSON.stringify(result,null,2)+'\n');
console.log(result);
