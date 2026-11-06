// Read the two real season summary views with a known season model that has no clock records.
// Only presentation primitives, optional media/share surfaces and external effects are replaced.
const fs=require('fs'),vm=require('vm'),ts=require('typescript'),path=require('path');
const model=JSON.parse(fs.readFileSync('artifacts/detail-performance-2026-11-04/season-preview-data.json','utf8'));
const noop=()=>null, make=(type,props,...children)=>({type,props:{...props,children}});
let states=[];
const react={createElement:make,Fragment:'Fragment',useState:init=>[states.length?states.shift():init,noop],useMemo:fn=>fn(),
  useCallback:fn=>fn,useEffect:noop,useRef:current=>({current})};
const host=new Proxy({StyleSheet:{create:s=>s,hairlineWidth:1,absoluteFillObject:{}}},{get:(o,k)=>o[k]||String(k)});
const fallback=new Proxy({},{get:(_o,k)=>k==='__esModule'?true:noop});
const deps={react,'react-native':host,'@react-navigation/native':{useRoute:()=>({params:{groupId:'club',seasonId:'s2'}})},
  '@/store/userStore':{useUserStore:selector=>selector({currentUser:{id:'owner',name:'שחקן'}})},
  '@/theme':{colors:{},spacing:{},RTL_LABEL_ALIGN:'left'},'@/theme/rtl':{RTL_LABEL_ALIGN:'left'},
  '@/utils/seasonAwards':{SEASON_TITLE_KEYS:[]},'react-native-safe-area-context':{SafeAreaView:'View'}};
function load(file){
 const m={exports:{}};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{jsx:ts.JsxEmit.React,module:ts.ModuleKind.CommonJS,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText,
  {module:m,exports:m.exports,require:id=>deps[id]||fallback});
 return m.exports;
}
deps['@/i18n/he']=load('src/i18n/he.ts');
deps['@/components/summary/SeasonClubSummary']=load('src/components/summary/SeasonClubSummary.tsx');
const {SeasonSummaryScreen}=load('src/screens/profile/SeasonSummaryScreen.tsx');
function textOf(v) {
 if(!v||typeof v==='boolean')return '';
 if(typeof v==='string'||typeof v==='number')return String(v)+' ';
 if(Array.isArray(v))return v.map(textOf).join('');
 if(typeof v.type==='function')return textOf(v.type(v.props));
 return textOf(v.props?.children);
}
const views={};
for(const tab of ['personal','club']){
 states=[tab,model,JSON.stringify(['club','owner',false,'s2']),false,false,false,false,false];
 const text=textOf(SeasonSummaryScreen());
 if(/דקות|זמן משחק/.test(text)||!text.includes('מחזורים')||!text.includes('משחק'))throw Error('Unknown or fabricated time in '+tab+': '+text);
 views[tab]=text.trim();
}
fs.writeFileSync(path.join(__dirname,'season-screen-result.json'),JSON.stringify({evidence:'source-components-no-native-render',views},null,2)+'\n');
console.log(Object.keys(views).join(', '));
