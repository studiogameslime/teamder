// Browser render of the actual Pulse Sources screen with synthetic service responses.
const fs = require('fs'), path = require('path'), ts = require('typescript');
const { pathToFileURL } = require('url');
const out = path.resolve('artifacts/night-sources-2026-11-04');
fs.mkdirSync(out, {recursive:true});
const before = process.argv.includes('--before');
const virtual = {
  rn: `const R=require('react');
const style=s=>Object.fromEntries(Object.entries(Array.isArray(s)?Object.assign({},...s.filter(Boolean)):s||{}).flatMap(([k,v])=>v==null?[]:/^(padding|margin)(Horizontal|Vertical)$/.test(k)?(k.endsWith('Horizontal')?['Left','Right']:['Top','Bottom']).map(side=>[k.replace(/Horizontal|Vertical/,side),v]):[[k,v]]));
const part=(tag,base={})=>({style:s,children,onPress,disabled,accessibilityRole,accessibilityLabel})=>R.createElement(tag,{style:{boxSizing:'border-box',...base,...style(s)},onClick:onPress,disabled,role:accessibilityRole,'aria-label':accessibilityLabel},children);
exports.View=part('div',{display:'flex',flexDirection:'column',minWidth:0});exports.Text=part('span');exports.Pressable=part('button',{display:'flex',flexDirection:'column',color:'inherit',background:'transparent',border:0,font:'inherit',padding:0});exports.TextInput=({placeholder,style:s})=>R.createElement('input',{placeholder,style:style(s)});
exports.ScrollView=({children,contentContainerStyle:s,refreshControl})=>R.createElement('div',{style:style(s)},refreshControl,children);
exports.RefreshControl=({onRefresh})=>{window.refreshReport=onRefresh;return null};
exports.Modal=({children,visible})=>visible?R.createElement('div',null,children):null;
exports.ActivityIndicator=()=>R.createElement('span',null,'בטעינה');exports.Platform={OS:'web'};exports.StyleSheet={create:s=>s,hairlineWidth:1};`,
  safe: "exports.SafeAreaView=require('react-native').View;",
  icons: "exports.Ionicons=({name})=>require('react').createElement('span',{'aria-hidden':true},'•');",
  dropdown: "exports.Dropdown=({title})=>require('react').createElement('div',null,title);",
  log: "exports.observeCaughtError=()=>{};exports.observeSettledErrors=rows=>rows;",
  api: `const link={id:'night',name:'קישור בדיקה',source:'whatsapp',clicks:7};
exports.SOURCE_PRESETS=['whatsapp'];exports.buildAdLink=()=>'https://example.invalid/';
window.sourcesFixture=new URLSearchParams(location.search).has('fail')?{links:'fail',report:'fail'}:{links:'ok',report:'ok'};
exports.listAdLinks=async()=>{if(window.sourcesFixture.links==='fail')throw Error('local rejection');return window.sourcesFixture.links==='empty'?[]:[link]};
exports.fetchAcquisitionReport=async()=>{if(window.sourcesFixture.report==='fail')throw Error('local rejection');const rows=window.sourcesFixture.report==='empty'?[]:[{source:'whatsapp',accounts:3,signups:2,joined:1}];return {rows,totalUsers:3,totalTracked:3}};`,
};
const ids=new Map(), modules={};
function resolve(name,from){
  const mapping={'react-native':'rn','react-native-safe-area-context':'safe','@expo/vector-icons':'icons','../components/Dropdown':'dropdown','../services/errorObservation':'log','../services/adLinks':'api'};
  if(mapping[name])return '#'+mapping[name];
  if(!name.startsWith('.'))return require.resolve(name,{paths:[process.cwd()]});
  const base=path.resolve(path.dirname(from),name);
  return [base,base+'.ts',base+'.tsx',base+'.js'].find(p=>fs.existsSync(p)&&fs.statSync(p).isFile())||require.resolve(base);
}
function add(file){
  if(ids.has(file))return ids.get(file);
  const id=ids.size;ids.set(file,id);
  const raw=file.startsWith('#')?virtual[file.slice(1)]:fs.readFileSync(file,'utf8');
  const code=/\.tsx?$/.test(file)?ts.transpileModule(raw,{compilerOptions:{esModuleInterop:true,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2020}}).outputText:raw;
  modules[id]=code.replace(/require\(['"]([^'"]+)['"]\)/g,(_,name)=>'require('+add(resolve(name,file))+')');
  return id;
}
async function run(){
  const src=add(path.resolve('pulse/src/screens/SourcesScreen.tsx')),react=add(resolve('react')),dom=add(resolve('react-dom/client'));
  fs.writeFileSync(path.join(out,'preview.js'),"const process={env:{NODE_ENV:'production'}},modules={"+Object.entries(modules).map(([id,code])=>id+':function(module,exports,require){'+code+'\n}').join(',')+"},cache={};function require(n){if(cache[n])return cache[n].exports;const m=cache[n]={exports:{}};modules[n](m,m.exports,require);return m.exports}require("+dom+").createRoot(document.getElementById('root')).render(require("+react+").createElement(require("+src+").SourcesScreen))");
  const html=path.join(out,'index.html');
  fs.writeFileSync(html,'<!doctype html><html lang="he" dir="rtl"><meta charset=utf-8><style>*{box-sizing:border-box}body{background:#171819;color:#f3f1ec;font-family:Arial;margin:0}button{cursor:pointer}input{max-width:100%}</style><div id="root"></div><script src="preview.js"></script></html>');
  const {chromium}=require('C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
  const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
  const results=[];
  try{
    for(const width of before?[390]:[320,390,430]){
      const page=await browser.newPage({viewport:{width,height:900}});page.on('pageerror',e=>console.error(e.message));
      await page.goto(pathToFileURL(html).href);
      await page.getByText('קישור בדיקה',{exact:true}).waitFor();
      await page.evaluate(()=>{window.sourcesFixture={links:'fail',report:'fail'};return window.refreshReport()});
      if(before){await page.getByText('אין עדיין נתוני ייחוס',{exact:true}).waitFor();}
      else{
        await page.getByText('לא ניתן לעדכן את דוח המקורות כרגע.').waitFor();
        await page.getByText('לא ניתן לעדכן את רשימת הקישורים כרגע.').waitFor();
        await page.getByText('קישור בדיקה',{exact:true}).waitFor();
        await page.getByText('3 מיוחסים מתוך 3 משתמשים').waitFor();
      }
      const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
      if(overflow)throw Error('overflow: '+width);
      if(width===390)await page.screenshot({path:path.join(out,before?'sources-before.png':'sources-after.png'),fullPage:true});
      if(!before){
        await page.evaluate(()=>{window.sourcesFixture={links:'empty',report:'fail'};return window.refreshReport()});
        await page.getByText('אין עדיין',{exact:true}).waitFor();
        await page.getByText('3 מיוחסים מתוך 3 משתמשים').waitFor();
        if(await page.getByText('לא ניתן לעדכן את רשימת הקישורים כרגע.').count())throw Error('stale error after successful link read');
        await page.evaluate(()=>{window.sourcesFixture={links:'empty',report:'empty'};return window.refreshReport()});
        await page.getByText('אין עדיין נתוני ייחוס',{exact:true}).waitFor();await page.getByText('אין עדיין',{exact:true}).waitFor();
        await page.goto(pathToFileURL(html).href+'?fail');
        await page.getByText('לא ניתן לעדכן את דוח המקורות כרגע.').waitFor();
        if(await page.getByText('אין עדיין נתוני ייחוס',{exact:true}).count())throw Error('initial denied read looked empty');
      }
      results.push({width,overflow,retainsLastResponse:!before});await page.close();
    }
    console.log(JSON.stringify(results));
  }finally{await browser.close()}
}
run().catch(e=>{console.error(e);process.exitCode=1});
