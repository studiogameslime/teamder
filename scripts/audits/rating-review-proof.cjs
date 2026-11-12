// Source JSX proof using the repository's existing RTL browser adapter.
// This does not impersonate a native screenshot or a production session.
const fs=require('fs');
const source=fs.readFileSync('scripts/audits/detail-performance-proof.cjs','utf8');
const start=source.indexOf('const extension = String.raw`')+'const extension = String.raw`'.length;
let adapter=source.slice(start,source.indexOf('const card = JSON.parse',start));
let prelude=fs.readFileSync('scripts/audits/screen-performance-proof.cjs','utf8').split('const scenes = []')[0];
prelude=prelude.replace("path.resolve('artifacts/performance-2026-11-04')","path.resolve('artifacts/rating-review-2026-11-11')")
  .replace("    if (name === 'react') return React;","    const special = specialDependency(name,file); if(special!==null)return special;\n    if (name === 'react') return React;")
  .replace("key === 'fontFamily' ? 'Arial'", "key === 'fontSize' ? value * proofScale : key === 'fontFamily' ? 'Arial'")
  .replace('`${value}px`','`${value*proofScale}px`');
const driver=String.raw`
const scenes=[];
function render(id,phaseValue,sim,file,name,props={},scale=1){
 phase=phaseValue;simulation=sim;cache={};proofScale=scale;
 theme={RTL_LABEL_ALIGN:'left',...load('src/theme/colors.ts'),...load('src/theme/spacing.ts'),...load('src/theme/typography.ts'),...load('src/theme/clubAccents.ts')};
 const html=renderToStaticMarkup(jsx(load(file)[name],props)),filename=id+'-'+scale+'.html';
 fs.writeFileSync(path.join(out,filename),'<!doctype html><html lang="he" dir="rtl"><meta charset="utf-8"><style>body{margin:0;padding:12px;background:#F3F7FC;font-family:Arial}button{font:inherit}*{box-sizing:border-box}svg{max-width:100%}</style><main>'+html+'</main></html>');
 scenes.push({id,phase:phaseValue,filename,scale});
}
phase='after';cache={};simulation={};
const {reviewPlayer}=load('src/utils/ratingReview.ts'),{reviewNights,reviewNow}=load('tests/fixtures/ratingReview.ts');
const props={busy:false,onDecision:noop,onEdit:noop,onRound:noop,name:'שחקן לדוגמה עם שם ארוך'};
for(const scale of [1,1.5])for(const state of ['up','down','missing','watch','conflict','collecting','unrated','disabled']){
 const nights=reviewNights(state==='collecting'?3:8,state==='down');
 if(state==='missing')nights.forEach(n=>n.snapshot=null);
 if(state==='watch')nights.forEach(n=>n.scores.a=7.5);
 if(state==='conflict')nights.forEach(n=>n.scores.a=6);
 const row=reviewPlayer('a',state==='unrated'?null:3.5,0,0,nights,reviewNow);
 if(state==='disabled'){row.status='disabled';row.proposed=null;}
 render('card-'+state,'after',{states:{'src/components/manager/ManagerRatingReview.tsx':{setExpanded:state==='up'}}},'src/components/manager/ManagerRatingReview.tsx','RatingReviewCard',{...props,row,renderTrend:points=>jsx(load('src/screens/communities/ManagerDashboardScreen.tsx').ManagerTrend,{points,direction:'neutral'})},scale);
}
const fixture=JSON.parse(fs.readFileSync('tests/fixtures/manager-dashboard-preview.json','utf8'));
const data=fixture.data,currentUser={id:fixture.viewerId,name:'מנהל',createdAt:0};
render('ratings-before','before',{currentUser,params:{groupId:data.group.id,initialTab:'ratings'},managerData:data,states:{'src/screens/communities/ManagerDashboardScreen.tsx':{setSnapshot:{owner:JSON.stringify([data.group.id,fixture.viewerId,false]),data},setLoading:false,setNow:fixture.now,setTab:'ratings'}}},'src/screens/communities/ManagerDashboardScreen.tsx','ManagerDashboardScreen');
async function capture(){
 const {chromium}=require('C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 const results=[];
 try{const page=await browser.newPage();for(const scene of scenes)for(const width of [320,390,430]){
  await page.setViewportSize({width,height:1000});await page.goto(pathToFileURL(path.join(out,scene.filename)).href);
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);if(overflow)throw Error('Overflow '+scene.id+' '+width+' '+scene.scale);
  if(scene.id==='card-up'){const name=await page.getByText('שחקן לדוגמה עם שם ארוך',{exact:true}).boundingBox(),badge=await page.getByText('לבחון העלאה',{exact:true}).boundingBox();if(name.x<=badge.x)throw Error('Name must be visually right of badge');}
  if(width===390&&scene.scale===1)await page.screenshot({path:path.join(out,scene.id+'.png'),fullPage:true});
  results.push({...scene,width,overflow});
 }}finally{await browser.close();}
 fs.writeFileSync(path.join(out,'browser-results.json'),JSON.stringify({native:false,sourceJsx:true,data:'fixtures',results},null,2));console.log(JSON.stringify({cases:results.length}));
}
capture().catch(error=>{console.error(error);process.exitCode=1;});
`;
new Function('require','process','__dirname','let proofScale=1;'+prelude+adapter+driver)(require,process,__dirname);
