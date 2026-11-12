// Source-component previews. Native primitives are adapted to browser CSS;
// this is deliberately not presented as an emulator or production-server run.
const fs=require('fs'),path=require('path');
const out=path.resolve('artifacts/live-round-edit-2026-11-12');fs.mkdirSync(out,{recursive:true});
let base=fs.readFileSync('artifacts/pulse-review-2026-11-05/render.cjs','utf8').split('const fonts=')[0];
base=base.replace("let phase='after',page='',cache={},renderWidth=390,renderScale=1;", "let phase='after',page='',cache={},renderWidth=390,renderScale=1,renderStep=0,hookIndex=0,renderPlan=null,renderTheme='light';");
base=base.replace("if(name==='react')return React;", "if(name==='react'&&file.endsWith('LiveRoundEditModal.tsx'))return {...React,useState:initial=>{const i=hookIndex++;const overrides={0:renderPlan,1:renderStep,6:false};return [i in overrides?overrides[i]:typeof initial==='function'?initial():initial,noop];}};if(name==='react')return React;");
base=base.replace("getColorScheme:()=> 'light'","getColorScheme:()=>renderTheme");
base=base.replace("style:{minHeight:320,backgroundColor:'#F4F7FA'}","style:{height:850,backgroundColor:'#EDF2F7'}");
const scenes=String.raw`
const ids=Array.from({length:15},(_,i)=>'p'+i);
const names=Object.fromEntries(ids.map((id,i)=>[id,['איתי כהן','נועם לוי','דניאל ישראלי','עומר בן דוד','יובל אברהמי','רועי מזרחי','אור בן שושן','אופיר דוד','נדב אלוני','שחר פרידמן','דור רוזן','אלון יעקבי','אדם לוי','אביב כהן','תומר רז'][i]]));
const fixture={...game,id:'audit',status:'active',format:'5v5',numberOfTeams:3,createdBy:'owner',players:ids,advancedMode:true,advancedFillMode:'temporary',matchDurationMinutes:10,
 draftTeams:{method:'regular',numTeams:3,createdAt:1,createdBy:'owner',teams:[0,1,2].map(index=>({index,captainId:ids[index*5],playerIds:ids.slice(index*5,index*5+5)}))},
 rotation:{playing:[0,1],waiting:[2],round:5,roundInstanceRound:5,roundInstanceId:'fifth',loans:[],wins:{0:2,1:1,2:1}},
 liveMatch:{scoreA:2,scoreB:1,timerRunning:false,timerAccumulatedMs:402000,goals:[],phase:'roundRunning',assignments:{},benchOrder:[]}};
for(const [width,scale,scheme]of [[390,1,'light'],[320,1.4,'light'],[600,1,'light'],[390,1,'dark']])for(const state of ['before','settings','teams','review','reset']){
 renderWidth=width;renderScale=scale;renderTheme=scheme;cache={};hookIndex=0;
 const {initialLiveRoundPlan}=load('src/utils/liveRoundEdit.ts');
 renderPlan={...initialLiveRoundPlan(fixture),method:'random',activeIds:ids.slice(0,12),teams:[0,1,2].map(index=>({index,captainId:ids[index*4],playerIds:ids.slice(index*4,index*4+4)}))};
 renderStep={settings:0,teams:2,review:3,reset:4}[state]??0;
 const element=state==='before'?React.createElement(load('src/components/match/LiveTeamsEditModal.tsx').LiveTeamsEditModal,{original:fixture.rotation,draft:fixture.draftTeams,roundNumber:5,busy:false,stale:false,onSave:noop,onClose:noop}):
 React.createElement(load('src/components/match/LiveRoundEditModal.tsx').LiveRoundEditModal,{game:fixture,players:Object.fromEntries(Object.entries(names).map(([id,name])=>[id,{id,name}])),ratings:{},canUseRating:true,loadHistory:async()=>[],busy:false,stale:false,onSave:noop,onClose:noop});
 const markup=renderToStaticMarkup(element),font=fs.readFileSync('node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/Ionicons.ttf').toString('base64');
 fs.writeFileSync(path.join(out,state+'-'+width+'-'+scale+'-'+scheme+'.html'),'<!doctype html><html dir="rtl" lang="he"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>@font-face{font-family:Icons;src:url(data:font/ttf;base64,'+font+')}body{margin:0;font-family:Arial}*{box-sizing:border-box}#root{height:850px;display:flex;flex-direction:column}svg{flex-shrink:0}</style><div id="root">'+markup+'</div></html>');
}
`;
new Function('require','__dirname','process',base+scenes)(require,out,process);
console.log('Rendered 20 source previews.');
