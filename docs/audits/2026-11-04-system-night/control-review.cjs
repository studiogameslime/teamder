// Independent, offline probes. Uses the project's discovery and measurement code.
const fs=require('fs'), path=require('path'), vm=require('vm'), ts=require('typescript');
const parser=require('@babel/parser'), traverse=require('@babel/traverse').default;
const transform=require('@babel/core').transformSync;
const { discover }=require('../../../scripts/analytics/control-sites.cjs');
const plugin=require('../../../scripts/analytics/control-plugin.cjs');
const fixturePath='src/screens/ReviewControls.tsx';
function sites(source,filename=fixturePath){
  const ast=parser.parse(source,{sourceType:'module',plugins:['typescript','jsx']});
  let rows;
  traverse(ast,{Program(prog){rows=discover(prog,filename).map(({id,kind,label,scope,handler})=>({id,kind,label,scope,handler}));prog.stop();}});
  return rows;
}
function idsFromTransform(source,filename){
  const result=transform(source,{filename:path.resolve(filename),configFile:false,babelrc:false,parserOpts:{plugins:['typescript','jsx']},plugins:[plugin]}).code;
  return [...new Set(result.match(/ui_[a-f0-9]{18}/g)||[])];
}
function runtime(){
  const emitted=[],module={exports:{}};
  const content=ts.transpileModule(fs.readFileSync('src/services/controlActivity.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const analytics=()=>({logEvent:async(name,params)=>{emitted.push({name,params});}});
  vm.runInNewContext(content,{module,exports:module.exports,require:id=>id.includes('firebase/config')?{USE_MOCK_DATA:false}:
    id.endsWith('/productActor')?{captureProductActor:()=>null,recordProductAction:()=>{}}:id.endsWith('/diagnosticJournal')?{recordDiagnostic:()=>{}}:{default:analytics}});
  return {track:module.exports.trackControl,describe:module.exports.describeControl,inherit:module.exports.inheritControl,emitted};
}
(async()=>{
  const list=fs.readFileSync('src/components/profile/HamburgerMenu.tsx','utf8');
  const menuSites=sites(list,'src/components/profile/HamburgerMenu.tsx').filter(s=>s.scope==='MenuRow');
  const sample=(items)=>'function Example(){return <View>'+items.map(v=>'<Pressable onPress={()=>choose("'+v+'")}><Text>'+v+'</Text></Pressable>').join('')+'</View>}';
  const before=sites(sample(['ראשון','שני'])),inserted=sites(sample(['חדש','ראשון','שני']));
  const compiled=idsFromTransform(list,'src/components/profile/HamburgerMenu.tsx');
  const keyboard=sites('function Entry(){return <TextInput onChangeText={type} onSubmitEditing={submit} />}');
  const dialogs=sites("function Dialog(){appAlert('x','', [{text:'ביטול'}, {text:'אישור',onPress:confirm}]);}");
  const {track,describe,inherit,emitted}=runtime();
  const caller=describe??track;
  const delegated=track('ui_outer','press',()=>caller('ui_deep','press',()=>{})());
  delegated();
  const sync=emitted.splice(0);
  const choice=caller('ui_deep','press',()=>{});
  const delayedAction=async()=>{await Promise.resolve();choice();};
  const delayed=track('ui_outer','press',inherit?inherit(choice,delayedAction):delayedAction);
  await delayed();
  const asyncForward=emitted.splice(0);
  const submit=track('ui_keyboard','submit',()=>{});
  submit({nativeEvent:{text:'private sample'}});
  const submitted=emitted.splice(0);
  choice();
  const background=emitted.splice(0);
  const menuOptions=sites("function Menu(){const options=[{id:'profile',label:'פרופיל',onPress:openProfile},{id:'history',label:'היסטוריה',onPress:openHistory}];return <MenuList options={options}/>;}");
  const result={menuSites,allMenuInventoryIDsCompiled:menuSites.every(s=>compiled.includes(s.id)),before,inserted,keyboard,dialogs,
    sync,asyncForward,submitted,background,menuOptions,
    forbiddenDataLeaked:JSON.stringify(submitted).includes('private sample')};
  fs.writeFileSync(path.join(__dirname,describe?'control-review-after.json':'control-review.json'),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify({menuSites:menuSites.length,sync:sync.length,asyncForward:asyncForward.length,keyboard:keyboard.length,dialogOptions:dialogs.length,leak:result.forbiddenDataLeaked}));
})().catch(err=>{console.error(err);process.exitCode=1;});
