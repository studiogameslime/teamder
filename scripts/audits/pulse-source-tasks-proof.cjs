// Real Pulse JSX and conversion/read services, with an in-memory datastore and browser primitives.
// No authenticated backend, message delivery, account or production write is used here.
const fs = require('fs'), path = require('path'), ts = require('typescript');
const { pathToFileURL } = require('url');
const out = path.resolve('artifacts/pulse-source-tasks-2026-11-05');
fs.mkdirSync(out, { recursive: true });
const virtual = {
  rn: `const React=require('react'),{createPortal}=require('react-dom');
const flat=s=>!s?{}:Array.isArray(s)?Object.assign({},...s.map(flat)):s;
const css=s=>Object.fromEntries(Object.entries(flat(s)).flatMap(([k,v])=>v==null||k==='elevation'||k.startsWith('shadow')||k==='transform'?[]:/^(padding|margin)(Horizontal|Vertical)$/.test(k)?(k.endsWith('Horizontal')?['Left','Right']:['Top','Bottom']).map(x=>[k.replace(/Horizontal|Vertical/,'')+x,v]):[[k,k==='fontFamily'?'Arial':k==='lineHeight'?v+'px':v]]));
const primitive=(tag,base={})=>React.forwardRef(({children,style,onPress,disabled,accessibilityRole,accessibilityState,accessibilityLabel,numberOfLines,...p},ref)=>React.createElement(tag,{ref,style:{boxSizing:'border-box',borderWidth:0,borderStyle:'solid',...base,...css(style)},onClick:onPress,disabled,role:accessibilityRole,'aria-expanded':accessibilityState?.expanded,'aria-label':accessibilityLabel},children));
exports.View=primitive('div',{display:'flex',flexDirection:'column',position:'relative',minWidth:0,flexShrink:0});
exports.Text=primitive('span',{fontFamily:'Arial',whiteSpace:'pre-wrap',overflowWrap:'anywhere'});
exports.Pressable=primitive('button',{display:'flex',flexDirection:'column',textAlign:'inherit',cursor:'pointer',backgroundColor:'transparent',font:'inherit',padding:0,color:'inherit'});
exports.ScrollView=React.forwardRef(({children,style,contentContainerStyle,horizontal,...p},ref)=>React.createElement('div',{ref,style:{...css(style),overflow:'auto',minHeight:0}},React.createElement(exports.View,{style:{...(horizontal?{flexDirection:'row'}:{}),...flat(contentContainerStyle)}},children)));
exports.Modal=({visible,children})=>visible?createPortal(React.createElement('div',{'data-modal':true,style:{position:'fixed',inset:0,zIndex:1000,display:'flex',flexDirection:'column',background:'#171819'}},children),document.body):null;
exports.TextInput=React.forwardRef(({value,onChangeText,multiline,style,placeholder,accessibilityLabel,...p},ref)=>React.createElement(multiline?'textarea':'input',{ref,value,onChange:e=>onChangeText?.(e.target.value),placeholder,'aria-label':accessibilityLabel,style:{...css(style),fontFamily:'Arial',background:'transparent',color:'#F3F1EC',border:'1px solid #3B3E40',minWidth:0}}));
exports.Image=({source,style})=>React.createElement('img',{src:source?.uri,style:css(style)});
exports.ActivityIndicator=()=>React.createElement('span',{role:'status'},'טוענים');exports.RefreshControl=()=>null;
exports.KeyboardAvoidingView=exports.View;exports.Keyboard={dismiss:()=>{}};exports.Alert={alert:(...args)=>window.alerts.push(args)};
exports.AppState={currentState:'active'};exports.Platform={OS:'web'};exports.StyleSheet={create:s=>s,hairlineWidth:1,absoluteFillObject:{position:'absolute',inset:0}};`,
  safe: `const rn=require('react-native');exports.SafeAreaView=rn.View;exports.useSafeAreaInsets=()=>({top:0,left:0,right:0,bottom:0});`,
  icons: `exports.Ionicons=({size=16})=>require('react').createElement('span',{'aria-hidden':true,style:{width:size,height:size,minWidth:size,textAlign:'center'}},'●');`,
  storage: `const values=new Map();exports.__esModule=true;exports.default={getItem:async k=>values.get(k)||null,setItem:async(k,v)=>{values.set(k,v)},removeItem:async k=>values.delete(k)};`,
  nav: `exports.useRoute=()=>({key:'fixture-route',name:window.routeName,params:window.routeParams});exports.useNavigation=()=>({navigate:(...args)=>window.navigateFixture(...args),goBack:()=>{}});exports.createNavigationContainerRef=()=>({isReady:()=>true,navigate:(...args)=>window.navigateFixture(...args)});`,
  config: `exports.MOCK_WORK=false;exports.config={firebase:{projectId:'demo-proof'}};`,
  capabilities: `exports.has={firebase:()=>true};`,
  picker: `exports.requestMediaLibraryPermissionsAsync=async()=>({granted:false});exports.launchImageLibraryAsync=async()=>({canceled:true});`,
  image: `exports.SaveFormat={JPEG:'jpeg'};exports.manipulateAsync=async()=>({});`,
  lightbox: `exports.ImageLightbox=()=>null;exports.useLightbox=()=>({props:{visible:false},close:()=>{},open:()=>{}});`,
  diagnostic: `exports.DiagnosticTimeline=()=>null;`,
  rtlinput: `exports.RtlTextInput=require('react-native').TextInput;`,
  errors: `exports.rawFeedback=async()=>window.fixture.collection('feedback');`,
  workMock: `exports.mockWork=()=>[];`,
  errorBody: `exports.ErrorsBody=()=>require('react').createElement('span',null,'שגיאות לדוגמה');`,
  featureBody: `exports.FeaturesBody=()=>null;`,
  qaBody: `exports.QaUsersBody=()=>null;`,
  rest: `window.alerts=[];const docs=new Map(),writes=[];const now=Date.now();
docs.set('users/alice',{name:'שחקן לדוגמה'});
docs.set('feedback/proposal-a',{type:'suggestion',message:'אפשר להציג זמינות מגרשים לפי יום',userName:'שחקן לדוגמה',userId:'alice',screen:'CommunitiesFeed',createdAt:now-600000,status:'new'});
docs.set('feedback/bug-a',{type:'bug',message:'הכפתור נשאר בטעינה לאחר ההרשמה',userName:'שחקן לדוגמה',userId:'alice',screen:'MatchDetails',createdAt:now-500000,status:'new'});
docs.set('dmConversations/alice__teamder',{participants:['alice','teamder'],updatedAt:now-60000});
docs.set('dmConversations/alice__teamder/messages/outgoing',{senderId:'teamder',senderName:'תמיכה',text:'קיבלנו את הפנייה',createdAt:now-180000});
docs.set('dmConversations/alice__teamder/messages/incoming',{senderId:'alice',senderName:'שחקן לדוגמה',text:'יש דרך לסנן מחזורים לפי השעה?',createdAt:now-60000,supportContext:{screen:'GamesList',screenLabel:'רשימת המחזורים',appVersion:'1.1.75',platform:'android'}});
function doc(p){const d=docs.get(p);return d?{...d,id:decodeURIComponent(p.split('/').at(-1))}:null;}
function collection(p){return [...docs.keys()].filter(k=>k.startsWith(p+'/')&&k.split('/').length===p.split('/').length+1).map(doc);}
window.fixture={docs,writes,collection,failRead:false,pendingCreate:false};
exports.getDoc=async(p,fields)=>{if(window.fixture.failRead)throw Error('read failed');const d=doc(p);return d&&fields?Object.fromEntries([['id',d.id],...fields.filter(k=>k in d).map(k=>[k,d[k]])]):d};
exports.listAll=async(p)=>collection(p);
exports.queryEquals=async(p,k,v,limit=200)=>collection(p).filter(d=>d[k]===v).slice(0,limit);
exports.queryArrayContains=async(p,k,v)=>collection(p).filter(d=>Array.isArray(d[k])&&d[k].includes(v));
exports.queryCollectionRecent=async(p,limit)=>collection(p).sort((a,b)=>b.createdAt-a.createdAt).slice(0,limit);
exports.createDocOnly=async(p,d)=>{if(window.fixture.pendingCreate)await new Promise(resolve=>window.fixture.releaseCreate=resolve);if(docs.has(p))return 'conflict';docs.set(p,d);writes.push(p);return 'created'};
exports.patchDoc=async()=>{throw Error('Unexpected source/status mutation in proof')};exports.deleteDoc=async()=>{throw Error('Unexpected delete in proof')};`,
};
const fileVirtual = {
  'pulse/src/services/firestoreRest.ts': 'rest', 'pulse/src/services/errorsService.ts': 'errors',
  'pulse/src/config.ts': 'config', 'pulse/src/capabilities.ts': 'capabilities',
  'pulse/src/components/ImageLightbox.tsx': 'lightbox', 'pulse/src/components/DiagnosticTimeline.tsx': 'diagnostic',
  'pulse/src/components/RtlTextInput.tsx': 'rtlinput', 'pulse/src/services/workItemsMock.ts': 'workMock',
  'pulse/src/screens/ErrorsScreen.tsx': 'errorBody', 'pulse/src/screens/FeaturesScreen.tsx': 'featureBody', 'pulse/src/screens/QaUsersScreen.tsx': 'qaBody',
};
function bundle(phase) {
  const modules = {}, ids = new Map();
  function resolve(name, from) {
    const specials = {'react-native':'rn','react-native-safe-area-context':'safe','@expo/vector-icons':'icons','@react-native-async-storage/async-storage':'storage','@react-navigation/native':'nav','expo-image-picker':'picker','expo-image-manipulator':'image'};
    if (specials[name]) return 'virtual:' + specials[name];
    if (!name.startsWith('.')) return require.resolve(name, { paths: /^(react(?:\/|$)|react-dom(?:\/|$)|scheduler(?:\/|$))/.test(name) ? [process.cwd()] : [path.dirname(from),path.resolve('pulse'),process.cwd()] });
    const base = path.resolve(path.dirname(from), name);
    const file = [base,base+'.ts',base+'.tsx',base+'.js',base+'.json',path.join(base,'index.ts')].find(p=>fs.existsSync(p)&&fs.statSync(p).isFile()) || require.resolve(base);
    const key = path.relative(process.cwd(),file).replace(/\\/g,'/');
    return fileVirtual[key] ? 'virtual:' + fileVirtual[key] : file;
  }
  function add(file) {
    if (ids.has(file)) return ids.get(file);
    const id = ids.size; ids.set(file,id);
    const prior = file.startsWith('virtual:') ? null : path.join(out,'before-src',path.relative(process.cwd(),file));
    const raw = file.startsWith('virtual:') ? virtual[file.slice(8)] : fs.readFileSync(phase==='before'&&fs.existsSync(prior)?prior:file,'utf8');
    let code = file.endsWith('.json') ? 'module.exports='+raw : /\.tsx?$/.test(file) ? ts.transpileModule(raw,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText : raw;
    code = code.replace(/require\(['"]([^'"]+)['"]\)/g,(_,name)=>`require(${add(resolve(name,file))})`); modules[id]=code;return id;
  }
  const react = add(require.resolve('react')), dom = add(require.resolve('react-dom/client'));
  const tasks = add(path.resolve('pulse/src/screens/TasksScreen.tsx')), inbox = add(path.resolve('pulse/src/screens/DevInboxScreen.tsx')), chat = add(path.resolve('pulse/src/components/TeamderChatSheet.tsx'));
  const entry = `const React=require(${react}),{createRoot}=require(${dom}),{TasksScreen}=require(${tasks}),{DevInboxScreen}=require(${inbox}),{TeamderChatSheet}=require(${chat});
function App(){const[scene,setScene]=React.useState(new URLSearchParams(location.search).get('scene')||'board'),[route,setRoute]=React.useState({});window.routeParams=route;window.routeName=scene==='reports'?'DevInbox':'Tasks';window.navigateFixture=(name,params)=>{if(name!=='Tasks')throw Error('Unexpected navigation '+name);setRoute(params||{});setScene('task')};return React.createElement('main',null,scene==='reports'?React.createElement(DevInboxScreen):scene==='support'?React.createElement(TeamderChatSheet,{visible:true,userId:'alice',userName:'שחקן לדוגמה',onClose:()=>setScene('closed')}):scene==='closed'?null:React.createElement(TasksScreen));}createRoot(document.getElementById('root')).render(React.createElement(App));`;
  fs.writeFileSync(path.join(out,phase+'.js'),`var process={env:{NODE_ENV:'development'}};var modules={${Object.entries(modules).map(([id,code])=>`${id}:function(require,module,exports){\n${code}\n}`).join(',')}};var cache={};function require(id){if(cache[id])return cache[id].exports;var m=cache[id]={exports:{}};modules[id](require,m,m.exports);return m.exports;}\n${entry}`);
  fs.writeFileSync(path.join(out,phase+'.html'),`<!doctype html><html dir="rtl" lang="he"><meta charset="utf-8"><style>html,body,#root{height:100%;margin:0;background:#171819;color:#F3F1EC;font-family:Arial}main{height:100vh;display:flex;flex-direction:column}button{max-width:100%}*{box-sizing:border-box}span{overflow-wrap:anywhere}</style><div id="root"></div><script src="${phase}.js"></script></html>`);
}
bundle('before'); bundle('after');
async function run() {
  const { chromium } = require('C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
  const browser = await chromium.launch({ executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true });
  const context=await browser.newContext({timezoneId:'Asia/Jerusalem'}),page=await context.newPage(),errors=[],results=[];
  page.on('pageerror',e=>errors.push(e.message));
  const open=(phase,scene)=>page.goto(pathToFileURL(path.join(out,phase+'.html')).href+'?scene='+scene);
  try {
    for(const phase of ['before','after']) for(const width of [320,390,430]) {
      await page.setViewportSize({width,height:1000});
      for(const scene of ['board','reports','support']) {
        await open(phase,scene);
        if(scene==='board') await page.getByRole('button',{name:'אפשר להציג זמינות מגרשים לפי יום',exact:true}).waitFor();
        if(scene==='reports'){await page.getByRole('button',{name:'דיווחים',exact:true}).click();await page.getByText('הכפתור נשאר בטעינה לאחר ההרשמה',{exact:true}).waitFor();}
        if(scene==='support') await page.getByText('יש דרך לסנן מחזורים לפי השעה?',{exact:true}).waitFor();
        if(width===390)await page.screenshot({path:path.join(out,scene+'-'+phase+'.png'),fullPage:true});
        const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
        if(overflow)throw Error('Horizontal overflow '+phase+' '+scene+' '+width);results.push({phase,scene,width,overflow});
      }
    }
    await open('after','reports');await page.getByRole('button',{name:'הצעות',exact:true}).click();
    await page.getByText('אפשר להציג זמינות מגרשים לפי יום',{exact:true}).waitFor();
    if(await page.getByText('הכפתור נשאר בטעינה לאחר ההרשמה',{exact:true}).isVisible())throw Error('bug leaked into suggestions');
    await page.getByRole('button',{name:'הפוך למשימה',exact:true}).click();
    await page.getByText('המקור שממנו נוצרה המשימה',{exact:true}).waitFor();
    if(await page.evaluate(()=>window.fixture.writes.length)!==1)throw Error('proposal not created once');
    await page.screenshot({path:path.join(out,'converted-proposal-after.png'),fullPage:true});
    await open('after','support');await page.getByText('יש דרך לסנן מחזורים לפי השעה?',{exact:true}).waitFor();
    if(await page.getByRole('button',{name:'הפוך למשימה',exact:true}).count()!==1)throw Error('outgoing message has conversion action');
    const original=await page.evaluate(()=>JSON.stringify([...window.fixture.docs].filter(([p])=>!p.startsWith('tasks/'))));
    await page.getByRole('button',{name:'הפוך למשימה',exact:true}).click();await page.getByText('המקור שממנו נוצרה המשימה',{exact:true}).waitFor();
    if(await page.evaluate(()=>window.fixture.writes.length)!==1)throw Error('message task count');
    await page.screenshot({path:path.join(out,'converted-message-after.png'),fullPage:true});
    await page.getByRole('button',{name:'פתיחת שיחת התמיכה המקורית',exact:true}).click();
    await page.getByRole('button',{name:'הפוך למשימה',exact:true}).click();await page.getByText('המקור שממנו נוצרה המשימה',{exact:true}).waitFor();
    if(await page.evaluate(()=>window.fixture.writes.length)!==1)throw Error('duplicate support task');
    const after=await page.evaluate(()=>JSON.stringify([...window.fixture.docs].filter(([p])=>!p.startsWith('tasks/'))));if(after!==original)throw Error('source changed');
    await open('after','support');await page.getByRole('button',{name:'הפוך למשימה',exact:true}).waitFor();
    await page.evaluate(()=>{window.fixture.failRead=true});await page.getByRole('button',{name:'הפוך למשימה',exact:true}).click();
    await page.getByText(/לא ניתן לאשר פתיחת משימה/).waitFor();
    if(await page.evaluate(()=>window.fixture.writes.length)!==0)throw Error('read failure created a task');
    await page.evaluate(()=>{window.fixture.failRead=false});await page.getByRole('button',{name:'הפוך למשימה',exact:true}).click();await page.getByText('המקור שממנו נוצרה המשימה',{exact:true}).waitFor();
    if(await page.evaluate(()=>window.fixture.writes.length)!==1)throw Error('retry did not recover');
    await open('after','support');await page.getByRole('button',{name:'הפוך למשימה',exact:true}).waitFor();
    await page.evaluate(()=>{window.fixture.pendingCreate=true});await page.getByRole('button',{name:'הפוך למשימה',exact:true}).click();
    await page.waitForFunction(()=>typeof window.fixture.releaseCreate==='function');await page.getByRole('button',{name:'סגירת השיחה',exact:true}).click();
    await page.evaluate(()=>{window.fixture.pendingCreate=false;window.fixture.releaseCreate()});
    await page.waitForFunction(()=>window.fixture.writes.length===1);
    if(await page.getByText('המקור שממנו נוצרה המשימה',{exact:true}).count())throw Error('late conversion reopened a closed sheet');
    if(errors.length)throw Error(errors.join('; '));
    fs.writeFileSync(path.join(out,'browser-results.json'),JSON.stringify({native:false,store:'memory',results,suggestionsSeparate:true,incomingOnly:true,conversionCreatesOne:true,repeatedConversionReuses:true,sourceUnchanged:true,readFailureRetained:true,retryRecovers:true,lateNavigationBlocked:true,errors},null,2));
    console.log(JSON.stringify({widthChecks:results.length,conversionFlows:2,reused:true,productionWrites:0,native:false}));
  } finally {await browser.close();}
}
run().catch(error=>{console.error(error);process.exitCode=1});
