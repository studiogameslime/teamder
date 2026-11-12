const fs=require('fs'),path=require('path'),{pathToFileURL}=require('url');
const {chromium}=require('C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async()=>{
  const out=path.resolve('artifacts/live-round-edit-2026-11-12'),results=[];
  const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  const page=await browser.newPage();
  for(const [width,scale,scheme]of [[390,1,'light'],[320,1.4,'light'],[600,1,'light'],[390,1,'dark']])for(const state of ['before','settings','teams','review','reset']){
    const file=`${state}-${width}-${scale}-${scheme}`;
    await page.setViewportSize({width,height:850});await page.goto(pathToFileURL(path.join(out,file+'.html')).href);await page.evaluate(()=>document.fonts.ready);
    const metrics=await page.evaluate(()=>{
      const rect=e=>e?.getBoundingClientRect().toJSON();
      return {overflow:document.documentElement.scrollWidth>innerWidth,button:rect(document.querySelector('[data-testid=live-round-next]')),
        format:rect(document.querySelector('[data-testid=live-round-format]')),text:document.getElementById('root').innerText,
        title:rect([...document.querySelectorAll('span')].find(e=>e.textContent==='עריכת המחזור')),
        back:rect(document.querySelector('[aria-label="ביטול העריכה"]'))};
    });
    if(metrics.overflow)throw Error('Horizontal overflow '+file);
    if(state!=='before'&&(!metrics.button||metrics.button.top<0||metrics.button.bottom>850))throw Error('Save outside viewport '+file);
    if(state!=='before'&&!metrics.text.includes('5 על 5'))throw Error('Missing pitch format '+file);
    if(state==='settings'&&metrics.title.left<=metrics.back.left)throw Error('Heading is not RTL '+file);
    if(state==='reset'&&(!metrics.text.includes('המשחק הנוכחי')||!metrics.text.includes('06:42')||!metrics.text.includes('00:00')))throw Error('Reset information missing '+file);
    results.push({state,width,scale,scheme,...metrics});
    if(width===390&&scale===1||width===320&&state==='reset')await page.screenshot({path:path.join(out,file+'.png')});
  }
  await browser.close();fs.writeFileSync(path.join(out,'browser-results.json'),JSON.stringify(results,null,2)+'\n');
  console.log(JSON.stringify({sourcePreviews:results.length,overflow:results.filter(r=>r.overflow).length}));
})().catch(error=>{console.error(error);process.exitCode=1;});
