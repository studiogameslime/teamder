// Runs the identity listener, analytics entry point and product actor from current
// source. Firebase identity, native delivery and the delayed SDK response are adapters.
const fs=require('fs'),path=require('path'),vm=require('vm'),ts=require('typescript'),babel=require('@babel/core');
function load(source,deps,extra={}) {
  const module={exports:{}};
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,
    {module,exports:module.exports,require:id=>deps[id]??{},__DEV__:false,console,...extra});
  return module.exports;
}
const recorder=load(fs.readFileSync('src/services/productActor.ts','utf8'),{'./diagnosticJournal':{recordDiagnostic(){}}});
let actor='first-account',received=[],listener,release;
const detach=recorder.attachProductCollector({actor:()=>actor,record:(key,owner)=>received.push({key,owner})});
const analytics=load(fs.readFileSync('src/services/analyticsService.ts','utf8'),{
  'react-native':{Platform:{OS:'android'}},
  '@react-native-firebase/analytics':{__esModule:true,default:()=>({logEvent:()=>Promise.resolve()})},
  '@/firebase/config':{USE_MOCK_DATA:false},'@/services/errorLog':{logError(){}},
  '@/services/breadcrumbs':{crumbAct(){}},'@/services/joryio':{joryio:{track:()=>Promise.resolve()}},
  '@/services/onboardingActivity':{recordOnboardingActivity(){}},'./productActor':recorder,
});
const source=fs.readFileSync('src/firebase/auth.ts','utf8');
const ast=ts.createSourceFile('auth.ts',source,ts.ScriptTarget.Latest,true);
const declaration=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='ensureIdentityWatch');
if(!declaration)throw Error('Listener missing');
const raw=`import {logEvent,AnalyticsEvent} from '../services/analyticsService';
let _identityWatching=false; const USE_MOCK_DATA=false;
${declaration.getText(ast)}
export {ensureIdentityWatch};`;
const transformed=babel.transformSync(raw,{filename:path.resolve('src/firebase/auditIdentity.ts'),
  configFile:false,babelrc:false,parserOpts:{plugins:['typescript']},plugins:[require('../../../scripts/analytics/actor-plugin.cjs')]}).code;
const entry=load(transformed,{'../services/analyticsService':analytics,'../services/productActor':recorder},{
  getFirebase:()=>({auth:{}}),onAuthStateChanged:(_auth,cb)=>{listener=cb;},
  currentAuthProviderId:()=> 'google.com',
  joryio:{bindIdentity:()=>new Promise(resolve=>{release=resolve;})},
});
(async()=>{
  entry.ensureIdentityWatch();
  listener({uid:'first-account',isAnonymous:false});
  actor='second-account';
  release('aliased');
  await Promise.resolve();await Promise.resolve();
  const identityResult={sourceFunction:'ensureIdentityWatch',actorAtCallback:'first-account',
    actorAtCompletion:actor,productRecords:[...received],hasOperationOwnerCapture:transformed.includes('captureProductActor')};
  let timer;
  const timerSource=`import {logEvent,AnalyticsEvent} from '../services/analyticsService';
    export function schedule(){setTimeout(()=>{logEvent(AnalyticsEvent.EntryWelcomeViewed);},1500);}`;
  const timerCode=babel.transformSync(timerSource,{filename:path.resolve('src/screens/auditTimer.ts'),
    configFile:false,babelrc:false,parserOpts:{plugins:['typescript']},plugins:[require('../../../scripts/analytics/actor-plugin.cjs')]}).code;
  const timerEntry=load(timerCode,{'../services/analyticsService':analytics,'../services/productActor':recorder},{
    setTimeout:cb=>{timer=cb;}
  });
  received=[];actor='first-account';timerEntry.schedule();actor='second-account';timer();
  const timerResult={actorAtSchedule:'first-account',actorAtCompletion:actor,productRecords:[...received],
    hasOperationOwnerCapture:timerCode.includes('captureProductActor')};
  const result={identity:identityResult,timer:timerResult};
  fs.writeFileSync(path.join(__dirname,'analytics-audit-result.json'),JSON.stringify(result,null,2)+'\n');
  console.log(result);detach();
})().catch(e=>{console.error(e);process.exitCode=1});
