// Render the real Pulse components with browser/native and data adapters.
// This is source/UI QA, not an emulator or a production collection test.
const fs = require('fs'), path = require('path'), ts = require('typescript');
const { pathToFileURL } = require('url');
const out = path.resolve('artifacts/usage-activity-2026-11-04');
fs.mkdirSync(out, { recursive: true });
const modules = {}, ids = new Map();
const adapters = {
  rn: `const React=require('react');
const flat=s=>!s?{}:Array.isArray(s)?Object.assign({},...s.map(flat)):s;
const css=s=>Object.fromEntries(Object.entries(flat(s)).flatMap(([k,v])=>v==null||k==='elevation'||k.startsWith('shadow')?[]:/^(padding|margin)(Horizontal|Vertical)$/.test(k)?(k.endsWith('Horizontal')?['Left','Right']:['Top','Bottom']).map(x=>[k.replace(/Horizontal|Vertical/,'')+x,v]):[[k,k==='fontFamily'?'Arial':v]]));
const primitive=(tag,base={})=>({children,style,onPress,disabled,accessibilityRole,accessibilityState,accessibilityLabel,...p})=>React.createElement(tag,{style:{boxSizing:'border-box',borderWidth:0,borderStyle:'solid',...base,...css(style)},onClick:onPress,disabled,role:accessibilityRole,'aria-expanded':accessibilityState?.expanded,'aria-label':accessibilityLabel},children);
exports.View=primitive('div',{display:'flex',flexDirection:'column',position:'relative',minWidth:0,flexShrink:0});
exports.Text=primitive('span',{fontFamily:'Arial',whiteSpace:'pre-wrap'});
exports.Pressable=primitive('button',{display:'flex',flexDirection:'column',textAlign:'inherit',cursor:'pointer',backgroundColor:'transparent',font:'inherit',padding:0});
exports.ScrollView=exports.View;exports.Modal=({visible,children})=>visible?React.createElement(exports.View,{style:{position:'fixed',inset:0,zIndex:1000}},children):null;
exports.ActivityIndicator=()=>React.createElement('span',{role:'status'},'טוען פעילות');
exports.StyleSheet={create:s=>s,hairlineWidth:1,absoluteFillObject:{position:'absolute',inset:0}};
exports.Platform={OS:'web'};exports.AppState={currentState:'active'};`,
  icons: `exports.Ionicons=({name})=>require('react').createElement('span',{'aria-hidden':true},name==='chevron-back'?'‹':'⌄');`,
  api: `const cutoff=(p,now=Date.now())=>p==='today'?now-86400000:now-(p==='week'?7:p==='quarter'?90:30)*86400000;
exports.usageCutoff=cutoff;exports.usageTime=(at,full)=>new Intl.DateTimeFormat('he-IL',{timeZone:'Asia/Jerusalem',...(full?{day:'2-digit',month:'2-digit'}:{}),hour:'2-digit',minute:'2-digit'}).format(at);
let revision=1;window.usageFixture={calls:[],pending:[],setRevision:n=>revision=n,fail:false,delay:null};
const visit=(uid,n=1)=>({id:uid+'-'+n,uid,visitId:'visit-'+uid+'-'+n,startedAt:Date.now()-600000,lastActivityAt:Date.now()-120000,updatedAt:revision,eventCount:6,screenEntries:3,distinctScreens:3,distinctGames:1,distinctGroups:1,confirmedRegistrations:1,waitlistRegistrations:0,partial:n===2,platform:'android',appVersion:'1.2.3'});
exports.fetchUsageVisits=async(uid,at,cursor)=>{const f=window.usageFixture;f.calls.push(['visits',uid,cursor]);if(f.delay)await new Promise(resolve=>f.pending.push({uid,resolve}));if(f.fail)throw Error('read');return {rows:uid==='empty'?[]:[visit(uid),visit(uid,2)],cursor:null,fetchedAt:Date.now()}};
exports.fetchUsageCoverage=async uid=>({enabled:uid==='disabled'?false:uid==='empty'?null:true});
exports.fetchUsageEvents=async(uid,visit,cursor)=>{window.usageFixture.calls.push(['events',uid,visit]);return {rows:[
{action:'app_opened'},{action:'screen_view',screen:'MatchDetails',section:'info'},
{action:'screen_view',screen:'CommunityDetails',section:'stats'},
{action:'screen_view',screen:'PlayerCard'},
{action:'registration_attempt',operationId:'join-operation'},
{action:'registration_result',result:'players',operationId:'join-operation',source:'server'}
].map((e,n)=>({uid,id:uid+'-event-'+n,eventId:visit+'-'+n,visitId:visit,sequence:n+1,occurredAt:Date.now()-600000+n*60000,sortAt:Date.now()-600000+n*60000,receivedAt:Date.now()-600000+n*60000+(n===1?90000:0),source:'app',registrationState:n===5?'created':undefined,labelSnapshot:n===1?'יום שלישי / כדורגל אנשים טובים':n===2?'כדורגל אנשים טובים':'',labelStatus:'resolved',timeQuality:'device',gameId:n===1||n>3?'game-a':undefined,...e})),cursor:null,fetchedAt:Date.now()}};`,
};
function resolve(name, from) {
  if (name === 'react-native') return 'virtual:rn';
  if (name === '@expo/vector-icons') return 'virtual:icons';
  if (from && /UserUsageTimeline\.tsx$/.test(from) && name === '../services/usageActivity') return 'virtual:api';
  if (!name.startsWith('.')) return require.resolve(name, { paths: [process.cwd()] });
  const base = path.resolve(path.dirname(from), name);
  return [base, base + '.ts', base + '.tsx', base + '.js', path.join(base, 'index.ts')].find(p => fs.existsSync(p) && fs.statSync(p).isFile()) || require.resolve(base);
}
function add(file, override) {
  if (ids.has(file)) return ids.get(file);
  const id = ids.size; ids.set(file, id);
  const raw = override ?? (file.startsWith('virtual:') ? adapters[file.slice(8)] : fs.readFileSync(file, 'utf8'));
  let code = /\.tsx?$/.test(file) ? ts.transpileModule(raw, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true, target: ts.ScriptTarget.ES2020 } }).outputText : raw;
  code = code.replace(/require\(['"]([^'"]+)['"]\)/g, (_, name) => `require(${add(resolve(name, file))})`);
  modules[id] = code; return id;
}
const before = path.resolve(out, 'before-src/pulse/src/components/PlayerHistory.tsx');
const beforeSource = fs.readFileSync(before, 'utf8');
// Preserve relative imports while keeping the before JSX exactly as captured.
const beforeId = add(path.resolve('pulse/src/components/PlayerHistory.tsx') + '.before.tsx', beforeSource);
const componentId = add(path.resolve('pulse/src/components/UserUsageTimeline.tsx'));
const reactId = add(resolve('react')), domId = add(resolve('react-dom/client'));
const entry = `const React=require(${reactId}),{createRoot}=require(${domId});const Before=require(${beforeId}).PlayerHistory,After=require(${componentId}).UserUsageTimeline;
function App(){const[user,setUser]=React.useState('alice'),[active,setActive]=React.useState(true);window.setUsageUser=setUser;window.setUsageActive=setActive;const old=new URLSearchParams(location.search).has('before');return React.createElement('main',null,React.createElement('h1',null,'היסטוריית משתמש'),old?React.createElement(Before,{data:{timeline:[{at:Date.now()-3600000,title:'נרשם לאפליקציה',kind:'registration'},{at:Date.now()-1800000,title:'הצטרף למועדון',kind:'group',subtitle:'כדורגל אנשים טובים'}],errors:[]},onError:()=>{}}):React.createElement(After,{userId:user,active,onTarget:row=>window.lastTarget=row}));}createRoot(document.getElementById('root')).render(React.createElement(App));`;
const bundle = `var process={env:{NODE_ENV:'development'}};var modules={${Object.entries(modules).map(([id, code]) => `${id}:function(require,module,exports){\n${code}\n}`).join(',')}};var cache={};function require(id){if(cache[id])return cache[id].exports;var m=cache[id]={exports:{}};modules[id](require,m,m.exports);return m.exports;}\n${entry}`;
fs.writeFileSync(path.join(out, 'proof.js'), bundle);
fs.writeFileSync(path.join(out, 'proof.html'), `<!doctype html><html dir="rtl" lang="he"><meta charset="utf-8"><style>body{margin:0;background:#171819;color:#F3F1EC;font-family:Arial}main{padding:20px;max-width:600px;margin:auto}h1{font-size:24px;margin:0 0 24px}button{color:inherit;max-width:100%}span{overflow-wrap:anywhere}*{box-sizing:border-box}</style><div id="root"></div><script src="proof.js"></script></html>`);
async function run() {
  const { chromium } = require('C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
  const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  const page = await browser.newPage(), errors = [], results = [];
  page.on('pageerror', e => errors.push(e.message));
  const url = pathToFileURL(path.join(out, 'proof.html')).href;
  try {
    for (const width of [320, 390, 430]) {
      await page.setViewportSize({ width, height: 1050 });
      await page.goto(url + '?before'); await page.getByText('נרשם לאפליקציה', { exact: true }).waitFor();
      if (width === 390) await page.screenshot({ path: path.join(out, 'history-before.png'), fullPage: true });
      await page.goto(url); await page.getByText('פתיחת הביקור', { exact: false }).first().waitFor();
      await page.getByRole('button', { expanded: false }).first().click();
      await page.getByText(/ההרשמה למחזור אושרה/).click(); await page.getByText(/פעולה מאומתת בשרת/).waitFor();
      if (width === 390) await page.screenshot({ path: path.join(out, 'history-after.png'), fullPage: true });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
      if (overflow) throw Error('RTL overflow ' + width);
      results.push({ width, overflow, sourceRendered: true });
    }
    await page.evaluate(() => { window.usageFixture.fail = true; });
    await page.getByText('רענון הפעילות', { exact: true }).click(); await page.getByText(/קריאת הפעילות נכשלה/).waitFor();
    if (await page.getByRole('button', { expanded: true }).count() !== 1) throw Error('refresh error lost expanded visit');
    await page.screenshot({ path: path.join(out, 'history-read-failure.png'), fullPage: true });
    await page.evaluate(() => { window.usageFixture.fail = false; window.setUsageUser('empty'); });
    await page.getByText(/לא תועדה פעילות בטווח שנבחר/).waitFor();
    await page.screenshot({ path: path.join(out, 'history-empty.png'), fullPage: true });
    await page.evaluate(() => window.setUsageUser('disabled'));
    await page.getByText(/האיסוף כבוי עבור המשתמש/).waitFor();
    await page.screenshot({ path: path.join(out, 'history-disabled.png'), fullPage: true });
    await page.evaluate(() => { window.usageFixture.delay = true; window.setUsageUser('alice'); });
    await page.waitForFunction(() => window.usageFixture.pending.length === 1);
    await page.evaluate(() => window.setUsageUser('bob'));
    await page.waitForFunction(() => window.usageFixture.pending.length === 2);
    await page.evaluate(() => { window.usageFixture.delay = false; window.usageFixture.pending.find(p=>p.uid==='bob').resolve(); });
    await page.getByText(/פתיחת הביקור/).first().waitFor();
    await page.evaluate(() => window.usageFixture.pending.find(p=>p.uid==='alice').resolve());
    await page.getByRole('button', { expanded: false }).first().click();
    await page.waitForFunction(() => window.usageFixture.calls.some(c=>c[0]==='events'&&c[1]==='bob'));
    if (await page.evaluate(() => window.usageFixture.calls.filter(c=>c[0]==='events').at(-1)[1]) !== 'bob') throw Error('late Alice answer replaced Bob');
    if (await page.locator('[aria-expanded]').count() !== 2) throw Error('switch did not render new account');
    await page.clock.install();
    await page.evaluate(() => window.usageFixture.setRevision(2));
    await page.clock.runFor(16_000);
    await page.getByText('יש עדכוני פעילות. לחצו להצגה.',{exact:true}).waitFor();
    if (await page.getByRole('button', { expanded: true }).count() !== 1) throw Error('polling displaced open visit');
    await page.screenshot({ path: path.join(out, 'history-new-updates.png'), fullPage: true });
    await page.evaluate(() => window.setUsageActive(false));
    const calls = await page.evaluate(() => window.usageFixture.calls.length);
    await page.clock.runFor(31_000);
    if (await page.evaluate(() => window.usageFixture.calls.length) !== calls) throw Error('inactive panel kept polling');
    if (errors.length) throw Error(errors.join('; '));
    fs.writeFileSync(path.join(out, 'browser-results.json'), JSON.stringify({ native: false, fixtureData: true, results, retainedOnFailure: true, empty: true, disabled: true, staleOwnerAnswerRejected: true, pollingPreservesExpandedVisit: true, inactiveStopsPolling: true, errors }, null, 2));
    console.log(JSON.stringify({ widthChecks: results.length, retainedOnFailure: true, native: false }));
  } finally { await browser.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
