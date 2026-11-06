// Real match tab/card JSX, React state and service boundary. Browser primitives,
// avatars/navigation and saved-history fixtures are adapters; no backend writes.
const fs = require('fs'), path = require('path'), ts = require('typescript');
const { pathToFileURL } = require('url');
const out = path.resolve('artifacts/round-penalties-2026-11-06');
process.env.TEMP = process.env.TMP = path.join(out, 'tmp');
fs.mkdirSync(process.env.TEMP, { recursive: true });
const virtual = {
  rn: `const React=require('react');
const flat=s=>!s?{}:Array.isArray(s)?Object.assign({},...s.map(flat)):typeof s==='function'?flat(s({pressed:false})):s;
const css=s=>Object.fromEntries(Object.entries(flat(s)).flatMap(([k,v])=>v==null||k==='elevation'||k.startsWith('shadow')||k==='transform'?[]:/^(padding|margin)(Horizontal|Vertical)$/.test(k)?(k.endsWith('Horizontal')?['Left','Right']:['Top','Bottom']).map(x=>[k.replace(/Horizontal|Vertical/,'')+x,v]):[[k,k==='fontFamily'?'Arial':k==='textAlign'&&v==='left'?'right':k==='fontSize'?v*(window.fontScale||1):k==='lineHeight'?v*(window.fontScale||1)+'px':v]]));
const primitive=(tag,base={})=>React.forwardRef(({children,style,onPress,disabled,accessibilityRole,accessibilityState,accessibilityLabel,testID},ref)=>React.createElement(tag,{ref,'data-testid':testID,style:{boxSizing:'border-box',borderWidth:0,borderStyle:'solid',...base,...css(style)},onClick:onPress,disabled,role:accessibilityRole,'aria-selected':accessibilityState?.selected,'aria-expanded':accessibilityState?.expanded,'aria-label':accessibilityLabel},children));
exports.View=primitive('div',{display:'flex',flexDirection:'column',position:'relative',minWidth:0,flexShrink:0});
exports.Text=primitive('span',{fontFamily:'Arial',whiteSpace:'pre-wrap',overflowWrap:'anywhere'});
exports.Pressable=primitive('button',{display:'flex',flexDirection:'column',font:'inherit',color:'inherit',padding:0,background:'transparent',cursor:'pointer'});
exports.ActivityIndicator=()=>React.createElement('span',{role:'status'},'טוענים');
exports.ScrollView=exports.View;exports.RefreshControl=()=>null;exports.Appearance={getColorScheme:()=> 'light'};
exports.StyleSheet={create:s=>s,hairlineWidth:1,absoluteFill:{position:'absolute',inset:0},absoluteFillObject:{position:'absolute',inset:0}};`,
  nav: `exports.useFocusEffect=callback=>require('react').useEffect(callback,[callback]);`,
  icons: `exports.Ionicons=({name,size=16,color,style})=>require('react').createElement('span',{'aria-hidden':true,style:{fontSize:size,color,width:size,minWidth:size,textAlign:'center'}},name.includes('chevron')?'⌄':name.includes('football')?'⚽':'●');exports.MaterialCommunityIcons=exports.Ionicons;`,
  svg: `exports.__esModule=true;const React=require('react');for(const [name,tag] of Object.entries({default:'svg',Svg:'svg',Circle:'circle',Line:'line',Path:'path',Rect:'rect'}))exports[name]=({children,...props})=>React.createElement(tag,props,children);`,
  animated: `const React=require('react');exports.__esModule=true;exports.default={View:require('react-native').View};exports.useSharedValue=x=>({value:x});exports.useAnimatedStyle=fn=>fn();exports.cancelAnimation=()=>{};exports.withDelay=(d,x)=>x;exports.withTiming=x=>x;exports.Easing={inOut:x=>x,cubic:0};`,
  ambient: `exports.useAmbientMotion=()=>false;`,
  avatar: `exports.UserAvatar=({user,size=32})=>require('react').createElement(require('react-native').View,{style:{width:size,height:size,borderRadius:size/2,backgroundColor:'#DDE9FB',alignItems:'center',justifyContent:'center'}},require('react').createElement(require('react-native').Text,{style:{fontSize:13,color:'#13213F'}},user?.name?.[0]||'?'));`,
  shellScroll: `exports.ScrollSurface=require('react-native').View;`,
  championship: `exports.GameChampionship=()=>null;`,
  skeleton: `exports.RoundStatisticsSkeleton=()=>null;`,
  rotation: `exports.teamName=()=>'';exports.teamColor=()=>'';`,
  shirt: `exports.TeamShirt=()=>null;`,
  user: `exports.useUserStore=Object.assign(select=>select({currentUser:{id:'viewer'}}),{getState:()=>({currentUser:{id:'viewer'}})});`,
  errors: `exports.observedRejection=fn=>fn;`,
  services: `exports.gameService={getRoundHistory:async()=>{if(window.failHistory)throw Error('offline');return window.fixtureHistory}};`,
  entry: `const React=require('react'),{createRoot}=require('react-dom/client'),{MatchStatsTab}=require('@/components/match/tabs/MatchStatsTab');
const names={a:'אלירן',b:'אדיר',c:'גל','guest:one':'אורח לדוגמה',keeper:'איתן',legacy:'שוער עם מידע ישן'};
const rounds=[1,2].map(n=>({roundId:String(n),at:n,teamA:['a','b'],teamB:['c','keeper'],scoreA:2,scoreB:2,winnerSide:'tie',goals:[]}));
rounds[0].inPlayPenalties=[{id:'ip1',team:'A',kickerId:'a',keeperId:'keeper',outcome:'goal',minute:2,at:1},{id:'ip2',team:'A',kickerId:'b',keeperId:'keeper',outcome:'save',minute:5,at:2}];
rounds[1].penalties=[...['goal','goal','goal','save'].map(outcome=>({kickerId:'a',keeperId:'keeper',scored:outcome==='goal',outcome,team:'A'})),...['goal','goal'].map(outcome=>({kickerId:'b',keeperId:'keeper',scored:true,outcome,team:'A'})),{kickerId:'c',keeperId:'keeper',scored:false,outcome:'miss',team:'A'},{kickerId:'guest:one',keeperId:'legacy',scored:false,team:'A'}];
window.fixtureHistory=rounds;
window.fixtureProps={game:{id:'fixture',status:'finished',players:['a','b','c'],guests:[]},summary:{stats:{rounds:2,goals:4,assists:2,shootouts:1},events:[],leaders:{},teamHighlights:{best:[],worst:[]},pairHighlight:null},hasPlayed:true,nameOf:id=>names[id]||'',userOf:id=>({id,name:names[id]||''}),showPersonalSummary:false,onOpenPersonalSummary:()=>{}};
const root=createRoot(document.getElementById('root'));window.renderFixture=()=>root.render(React.createElement(MatchStatsTab,window.fixtureProps));window.renderFixture();`,
};
const fileVirtual = {
  'src/components/UserAvatar.tsx':'avatar','src/components/ScrollSurface.tsx':'shellScroll',
  'src/components/match/GameChampionship.tsx':'championship','src/components/loading/CentralSkeletons.tsx':'skeleton',
  'src/components/match/rotationView.tsx':'rotation','src/components/match/TeamShirt.tsx':'shirt',
  'src/store/userStore.ts':'user','src/services/index.ts':'services','src/utils/errorObservation.ts':'errors',
  'src/hooks/animations/useAmbientMotion.ts':'ambient',
};
function bundle(phase) {
  const modules={},ids=new Map();
  function resolve(name,from) {
    const specials={'react-native':'rn','@react-navigation/native':'nav','@expo/vector-icons':'icons','react-native-svg':'svg','react-native-reanimated':'animated'};
    if(specials[name])return 'virtual:'+specials[name];
    if(!name.startsWith('.')&&!name.startsWith('@/'))return require.resolve(name,{paths:[process.cwd()]});
    const base=name.startsWith('@/')?path.resolve('src',name.slice(2)):path.resolve(path.dirname(from),name);
    const file=[base,base+'.ts',base+'.tsx',base+'.js',path.join(base,'index.ts')].find(p=>fs.existsSync(p)&&fs.statSync(p).isFile());
    if(!file)throw Error('Missing '+name+' from '+from);
    const key=path.relative(process.cwd(),file).replace(/\\/g,'/');return fileVirtual[key]?'virtual:'+fileVirtual[key]:file;
  }
  function add(file) {
    if(ids.has(file))return ids.get(file);const id=ids.size;ids.set(file,id);
    const prior=file.startsWith('virtual:')?null:path.join(out,'before-src',path.relative(process.cwd(),file));
    const raw=file.startsWith('virtual:')?virtual[file.slice(8)]:fs.readFileSync(phase==='before'&&fs.existsSync(prior)?prior:file,'utf8');
    let code=/\.tsx?$/.test(file)?ts.transpileModule(raw,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText:raw;
    code=code.replace(/require\(['"]([^'"]+)['"]\)/g,(_,name)=>`require(${add(resolve(name,file))})`);modules[id]=code;return id;
  }
  const entry=add('virtual:entry');
  return `(function(){const process={env:{NODE_ENV:'production'}},__DEV__=false;const modules={${Object.entries(modules).map(([id,code])=>`${id}:function(require,module,exports){${code}\n}`).join(',')}};const cache={};function require(id){if(cache[id])return cache[id].exports;const module=cache[id]={exports:{}};modules[id](require,module,module.exports);return module.exports;}require(${entry});})()`;
}
async function main(){
  const {chromium}=require('C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
  const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
  const errors=[],results=[];
  try {
    const page=await browser.newPage();page.on('pageerror',e=>{errors.push(e.message);console.error(e.message);});
    for(const phase of ['before','after']) {
      const filename=path.join(out,phase+'.html');
      fs.writeFileSync(filename,`<!doctype html><html lang="he" dir="rtl"><meta charset="utf-8"><style>body{margin:0;background:#F4F7FB;font-family:Arial}#root{padding:16px}button:focus-visible{outline:2px solid #2463F5}</style><div id="root"></div><script>${bundle(phase).replace(/<\/script/gi,'<\\/script')}</script></html>`);
      for(const width of [320,390,430])for(const fontScale of [1,1.5]){
        await page.setViewportSize({width,height:950});await page.addInitScript(scale=>window.fontScale=scale,fontScale);await page.goto(pathToFileURL(filename).href);
        await page.getByText('המחזור במספרים',{exact:true}).waitFor();
        if(phase==='after')await page.getByTestId('round-penalties-card').waitFor();
        const overflow=async()=>page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
        if(await overflow())throw Error('Overflow '+phase+' '+width+' '+fontScale);
        if(width===390&&fontScale===1)await page.screenshot({path:path.join(out,'stats-'+phase+'.png'),fullPage:true});
        if(phase==='after'){
          await page.getByRole('tab',{name:'פנדלי הכרעה',exact:true}).click();
          await page.getByRole('button',{name:'פירוט הבעיטות של אלירן',exact:true}).click();
          if(!await page.getByText('משחק 2',{exact:true}).first().isVisible())throw Error('Details missing');
          if(await overflow())throw Error('Expanded overflow');
          if(width===390&&fontScale===1)await page.screenshot({path:path.join(out,'kicker-details-after.png'),fullPage:true});
          await page.getByRole('tab',{name:'שוערים',exact:true}).click();
          if(!await page.getByText('1 מתוך 7',{exact:true}).isVisible())throw Error('Save/miss count incorrect');
          await page.getByRole('button',{name:'פירוט הבעיטות של שוער עם מידע ישן',exact:true}).click();
          if(!await page.getByText('חסר פירוט',{exact:true}).isVisible())throw Error('Legacy data invented');
          if(await overflow())throw Error('Keeper overflow');
          if(width===390&&fontScale===1)await page.screenshot({path:path.join(out,'keeper-details-after.png'),fullPage:true});
          await page.getByRole('tab',{name:'במהלך המשחק',exact:true}).click();
          if(!await page.getByText('1 מתוך 2',{exact:true}).isVisible())throw Error('Phase totals mixed');
        }
        results.push({phase,width,fontScale,horizontalOverflow:false});
      }
    }
    if(errors.length)throw Error(errors.join('; '));
    fs.writeFileSync(path.join(out,'browser-results.json'),JSON.stringify({native:false,sourceJsx:true,datastore:'fixture',results,errors},null,2));
    console.log(JSON.stringify({widthChecks:results.length,interactiveCases:results.filter(r=>r.phase==='after').length,errors}));
  } finally {await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
