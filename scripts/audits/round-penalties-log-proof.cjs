// Reuse the existing source-JSX browser adapter. This is a source render with
// fixture data, not an Android/iOS screenshot or an authenticated server test.
const fs = require('fs');
const placement = process.argv.includes('--placement');
let prelude = fs.readFileSync('scripts/audits/round-penalties-proof.cjs', 'utf8').split('async function main()')[0];
prelude = prelude.replace("path.resolve('artifacts/round-penalties-2026-11-06')", placement ? "path.resolve('artifacts/round-penalties-position-2026-11-06')" : "path.resolve('artifacts/round-penalties-log-2026-11-06')");
if (placement) {
  prelude = prelude.replace('events:[],leaders:{}', "events:[{type:'club_milestone',metric:'evenings',threshold:10}],leaders:{}");
  // Only the destination heading is a fixture; the tab/events/penalty list use
  // product JSX. The table's rendering/data is outside this placement check.
  const heading = "exports.GameChampionship=()=>require('react').createElement(require('react-native').View,{'testID':'championship-destination',style:{paddingVertical:16}},require('react').createElement(require('react-native').Text,{style:{fontSize:18,fontWeight:'800',textAlign:'left',color:'#13213F'}},require('@/i18n/he').he.gameChampTitle));";
  prelude += '\nvirtual.championship=' + JSON.stringify(heading) + ';\n';
}
// Expose native test ids/individual icon positions for geometry checks.
prelude = prelude.replace("({name,size=16,color,style})", "({name,size=16,color,style,testID})")
  .replace("{'aria-hidden':true,style:{fontSize:size", "{'aria-hidden':true,'data-testid':testID,style:{fontSize:size");
const driver = String.raw`
async function main(){
  const {chromium}=require('C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
  const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
  const errors=[],results=[];
  try {
    const page=await browser.newPage();page.on('pageerror',e=>{errors.push(e.message);console.error(e.message);});
    for(const phase of (process.argv.includes('--before-only')?['before']:['before','after'])){
      const filename=path.join(out,phase+'.html');
      fs.writeFileSync(filename,'<!doctype html><html lang="he" dir="rtl"><meta charset="utf-8"><style>body{margin:0;background:#F4F7FB;font-family:Arial}#root{padding:16px}</style><div id="root"></div><script>'+bundle(phase).replace(/<\/script/gi,'<\\/script')+'</script></html>');
      for(const width of [320,390,430])for(const fontScale of [1,1.5]){
        await page.setViewportSize({width,height:950});await page.addInitScript(scale=>window.fontScale=scale,fontScale);await page.goto(pathToFileURL(filename).href);
        const card=page.getByTestId('round-penalties-card');await card.waitFor();
        if(process.argv.includes('--placement')){
          const events=await page.getByText('מה קרה הערב',{exact:true}).boundingBox();
          const penalties=await card.boundingBox();
          const champions=await page.getByTestId('championship-destination').boundingBox();
          const correct=phase==='after'?events.y<penalties.y&&penalties.y+penalties.height<=champions.y+1:penalties.y<events.y;
          if(!correct)throw Error('Unexpected section order '+phase);
        }
        if(phase==='after'){
          if(await card.getByRole('tab').count()||await card.getByRole('button').count())throw Error('Penalty log has controls');
          if(await card.locator('[data-testid^="penalty-attempt-"]').count()!==10)throw Error('Not every saved kick is visible');
          await card.getByText('במהלך המשחק',{exact:true}).waitFor();await card.getByText('פנדלי הכרעה',{exact:true}).waitFor();
          const row=card.getByTestId('penalty-attempt-2:shootout:0');
          const copy=(await row.textContent()).replace(/[\u2066-\u2069]/g,'');
          for(const name of ['אלירן','איתן','כבש'])if(!copy.includes(name))throw Error('Pair/result missing '+copy);
          const positions=await page.evaluate(()=>[...document.querySelectorAll('[data-testid^="penalty-attempt-"]')].map(row=>{
            const text=row.querySelector('[data-testid^="penalty-result-text-"]').getBoundingClientRect();
            const icon=row.querySelector('[data-testid^="penalty-result-icon-"]').getBoundingClientRect();
            const kicker=row.querySelector('[data-testid^="penalty-kicker-"]').getBoundingClientRect();
            const keeper=row.querySelector('[data-testid^="penalty-keeper-"]').getBoundingClientRect();
            return {id:row.dataset.testid,iconLeft:icon.right<=text.left+1,kickerRight:kicker.left>keeper.left};
          }));
          if(positions.some(p=>!p.iconLeft||!p.kickerRight))throw Error('RTL or icon position is wrong '+JSON.stringify(positions));
          results.push({phase,width,fontScale,rows:positions.length,iconLeftOfText:true,kickerRightOfKeeper:true});
        }else results.push({phase,width,fontScale});
        const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
        if(overflow)throw Error('Horizontal overflow '+phase+' '+width+' '+fontScale);
        if(width===390&&fontScale===1)await page.screenshot({path:path.join(out,'stats-'+phase+'.png'),fullPage:true});
      }
    }
    if(errors.length)throw Error(errors.join('; '));
    fs.writeFileSync(path.join(out,'browser-results.json'),JSON.stringify({native:false,sourceJsx:true,datastore:'fixture',results,errors},null,2));
    console.log(JSON.stringify({widthChecks:results.length,geometryChecks:results.filter(r=>r.phase==='after').reduce((n,r)=>n+r.rows,0),errors}));
  }finally{await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
`;
new Function('require','process',prelude+'\n'+driver)(require,process);
