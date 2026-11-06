// Render the real AnalyticsScreen action section against fixed, offline aggregate data.
// Native layout is adapted to DOM/CSS; this is a source-component proof, not a device capture.
const fs=require('fs'),path=require('path'),vm=require('vm'),ts=require('typescript');
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const {chromium}=require(path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const phase=process.argv[2],width=Number(process.argv[3]||390),scale=Number(process.argv[4]||1);
const scenario=process.argv[5]||'example';
if(phase==='before'&&!fs.readFileSync('pulse/src/screens/AnalyticsScreen.tsx','utf8').includes('פעולות מובילות באפליקציה'))throw Error('The before proof requires the original screen source');
const fixture={
  activeUsers:4,topActions:[{name:'הצטרפו למשחק',value:12},{name:'פתחו כרטיס שחקן',value:9}],
  actions:{state:'ready',rows:[{id:'live_goal_recorded',label:'הזינו שער במשחק חי',users:2,events:7},{id:'player_comparison_viewed',label:'צפו בהשוואת שחקנים',users:1,events:3}],thresholded:false,sampled:false,other:false},
  controls:{state:'ready',rows:[{id:'proof',label:'פתיחת מסך פרטי המחזור',users:3,events:12}],thresholded:false,sampled:false,other:false},
  acquisition:[],devices:[],totalUsers:8,inCommunity:4,notInCommunity:4,createdGame:1,registeredGame:2,createdCommunity:1,
  friendsSent:1,friendsAccepted:1,returnRate:0,avgEngagementSec:0,
};
if(scenario==='independent'){
  fixture.actions={...fixture.actions,rows:[{id:'live_goal_recorded',label:'הזינו שער במשחק חי',users:0,events:0}],thresholded:true,sampled:true,other:true};
  fixture.controls={...fixture.controls,state:'error',rows:[]};
}
if(scenario==='empty'){
  fixture.actions={...fixture.actions,rows:[]};
  fixture.controls={...fixture.controls,state:'unavailable',rows:[]};
}
let isScreen=true,hook=0;
const accountRows={accounts:1,accepted:3,rows:[{id:'live_goal_recorded',label:'הזינו שער במשחק חי',users:1,events:3}],partial:false,readTime:'2026-11-04T12:00:00Z'};
if(scenario==='account-time-quality')accountRows.timeQuality={device:1,received:1,unknown:1};
const R={...React,useState:(init)=>{if(!isScreen){
  if(scenario.startsWith('account-')&&scenario!=='account-idle'&&init==='idle')return ['ready',()=>{}];
  if(scenario.startsWith('account-')&&init===null)return [scenario==='account-empty'?{...accountRows,accounts:0,accepted:0,rows:[]}:accountRows,()=>{}];
  return [init,()=>{}];}const i=hook++;
  return [[false,'engagement',fixture,false,false,'7d',false][i]??init,()=>{}];},
  useEffect:()=>{},useRef:value=>({current:value}),useMemo:cb=>cb(),useCallback:cb=>cb};
const flat=s=>Array.isArray(s)?Object.assign({},...s.map(flat)):s||{};
function css(s){const o={...flat(s)};if(o.paddingHorizontal!=null)o.paddingLeft=o.paddingRight=o.paddingHorizontal;if(o.paddingVertical!=null)o.paddingTop=o.paddingBottom=o.paddingVertical;
  delete o.paddingHorizontal;delete o.paddingVertical;if(o.fontSize)o.fontSize*=scale;return o;}
const V=({style,children})=>React.createElement('div',{style:{display:'flex',flexDirection:'column',boxSizing:'border-box',...css(style)}},children);
const T=({style,children})=>React.createElement('span',{style:css(style)},children);
const Card=({style,children})=>React.createElement('article',{style:{display:'flex',flexDirection:'column',background:'#242628',border:'1px solid #3b3e40',borderRadius:18,padding:16,...css(style)}},children);
const rn={Platform:{OS:'web'},Text:T,View:V,Pressable:V,RefreshControl:()=>null,StyleSheet:{create:s=>s,hairlineWidth:1}};
const ui={Card,Screen:V,SectionTabs:()=>null,Panel:({active,children})=>active?children:null};
const loaded={react:R,'react-native':rn,'@expo/vector-icons':{Ionicons:()=>null},'./ui':ui,'../components/ui':ui,'../components/Donut':{},'../format':{compact:String},'./errorObservation':{},'../services/errorObservation':{},'../services/analyticsFull':{},'../services/accountActionReport':{},'../services/actionLabels':{},'../data/controlActions.json':{}};
function from(file){const module={exports:{}};let source=fs.readFileSync(file,'utf8');
  // Restore only this change's former component body for a like-for-like before proof.
  if(phase==='quality-before'&&file.endsWith('AccountActionCard.tsx'))source=source.split('\n').filter(line=>!line.includes('const timing=')&&!line.includes('{timing.received>0')&&!line.includes('{timing.unknown>0')).join('\n');
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText,
  {module,exports:module.exports,require:id=>{if(loaded[id])return loaded[id];if(id.endsWith('/theme'))return loaded.theme;if(id.startsWith('.')){const base=path.resolve(path.dirname(file),id);for(const ext of ['.tsx','.ts'])if(fs.existsSync(base+ext))return from(base+ext);}throw Error(id);}});return module.exports;}
loaded.theme=from('pulse/src/theme.ts');
const source=from('pulse/src/screens/AnalyticsScreen.tsx');
const element=source.AnalyticsScreen();isScreen=false;
const output=renderToStaticMarkup(element);
(async()=>{const browser=await chromium.launch({executablePath:path.join(process.env.ProgramFiles,'Google/Chrome/Application/chrome.exe'),headless:true});
  try{const page=await browser.newPage({viewport:{width,height:1000},deviceScaleFactor:1});await page.setContent('<html lang="he" dir="rtl"><body style="background:#171819;font-family:Arial;color:#f3f1ec;margin:16px">'+output+'</body></html>');
    const pattern=scenario.startsWith('account-')?'חשבונות טימדר':'פעולות מובילות באפליקציה|פעולות באפליקציה|פעולות ממשק|לחיצות בממשק';
    const cards=page.locator('article').filter({hasText:new RegExp(pattern)});
    if(!await cards.count())throw Error('Action card missing');
    const proof=await page.locator('body').evaluateHandle((body,p)=>{const div=document.createElement('div');div.style.cssText='display:flex;flex-direction:column;gap:10px;padding:4px';body.prepend(div);for(const card of body.querySelectorAll('article'))if(new RegExp(p).test(card.textContent))div.append(card);return div;},pattern);
    const element=proof.asElement();const file='pulse-actions-'+phase+'-'+width+'-'+String(scale).replace('.','_')+(scenario==='example'?'':'-'+scenario)+'.png';
    const clipped=await element.evaluate(el=>Array.from(el.querySelectorAll('*')).filter(x=>x.scrollWidth>x.clientWidth+2&&x.clientWidth>0).length);
    const dest=path.join(__dirname,file);await element.screenshot({path:dest});
    const visible=await element.textContent();
    for(const expected of scenario==='independent'?['אנשים: 0','ביצועים: 0','ניסיון חוזר','סף פרטיות','דגימה','טרם התקבלה שורה']:scenario==='empty'?['לא התקבלו שורות','אינו מחובר','טרם התקבלה שורה']:[])if(!visible.includes(expected))throw Error('Missing state text: '+expected);
    for(const expected of scenario==='account-ready'?['חשבונות: 1','ביצועים: 3']:scenario==='account-empty'?['אין כיסוי מדוד']:scenario==='account-idle'?['טעינת דוח חשבונות']:[])if(!visible.includes(expected))throw Error('Missing account state: '+expected);
    if(scenario==='account-time-quality'){
      for(const expected of ['חשבונות: 1','ביצועים: 3'])if(!visible.includes(expected))throw Error('Missing stable count: '+expected);
      for(const expected of ['בשל זמן מכשיר לא אמין הוא 1','לא נשמרה איכות זמן עבור 1'])if(visible.includes(expected)===(phase==='quality-before'))throw Error('Wrong time quality state: '+expected);
    }
    if(clipped)throw Error('Horizontal clipping');
    console.log({file,clipped,width,scale,scenario});
    }finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
