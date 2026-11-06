const fs=require('fs'),path=require('path'),ts=require('typescript');
const {pathToFileURL}=require('url');
const out=path.resolve('artifacts/shared-score-implementation-2026-11-06');
process.env.TEMP=process.env.TMP=path.join(out,'tmp');fs.mkdirSync(process.env.TEMP,{recursive:true});
const rn=`const React=require('react');const flat=s=>!s?{}:Array.isArray(s)?Object.assign({},...s.map(flat)):typeof s==='function'?flat(s({pressed:false})):s;const css=style=>Object.fromEntries(Object.entries(flat(style)).flatMap(([k,v])=>v==null?[]:/^(padding|margin)(Horizontal|Vertical)$/.test(k)?(k.endsWith('Horizontal')?['Left','Right']:['Top','Bottom']).map(s=>[k.replace(/Horizontal|Vertical/,'')+s,v]):[[k,k==='textAlign'&&v==='left'?'right':k==='fontSize'?v*window.fontScale:k==='lineHeight'?v*window.fontScale+'px':v]]));
const p=(tag,base)=>({children,style,contentContainerStyle,onPress,accessibilityRole,...props})=>React.createElement(tag,{style:{boxSizing:'border-box',...base,...css(style)},onClick:onPress,role:accessibilityRole},contentContainerStyle?React.createElement('div',{style:{display:'flex',flexDirection:'column',...css(contentContainerStyle)}},children):children);
exports.View=p('div',{display:'flex',flexDirection:'column',minWidth:0,flexShrink:0});exports.Text=p('span',{fontFamily:'Arial',whiteSpace:'pre-wrap',overflowWrap:'anywhere'});exports.Pressable=p('button',{display:'flex',border:0,cursor:'pointer'});exports.ScrollView=p('div',{overflowY:'auto',minHeight:0});exports.StyleSheet={create:s=>s};`;
function bundle(phase){
 const modules={},ids=new Map();
 const virtual={rn,rtl:`exports.RTL_LABEL_ALIGN='left';`,icons:`exports.Ionicons=({size,color})=>require('react').createElement('span',{style:{width:size,minWidth:size,color,fontSize:size},'aria-hidden':true},'●');`,
 sheet:`exports.DraggableMenuSheet=({visible,children})=>visible?require('react').createElement('div',{style:{display:'flex',flexDirection:'column',maxHeight:'90vh',paddingTop:18,background:'white',borderRadius:22}},children):null;`,
 entry:`const React=require('react'),{createRoot}=require('react-dom/client');const {EveningScoreInfoSheet}=require('@/components/summary/EveningScoreInfoSheet');const root=createRoot(document.getElementById('root'));window.draw=shared=>root.render(React.createElement(EveningScoreInfoSheet,{visible:true,shared,onClose:()=>root.render(null)}));window.draw(${phase==='after'});`};
 function resolve(name,from){const special={'react-native':'rn','@expo/vector-icons':'icons','@/theme/rtl':'rtl','@/components/DraggableMenuSheet':'sheet'};if(special[name])return 'virtual:'+special[name];
 if(name.startsWith('.'))return require.resolve(path.resolve(path.dirname(from),name));
 if(!name.startsWith('@/'))return require.resolve(name,{paths:[process.cwd()]});return path.resolve('src',name.slice(2))+'.tsx';}
 function add(file){if(ids.has(file))return ids.get(file);const id=ids.size;ids.set(file,id);
 const prior=path.join(out,'before-src',path.relative(process.cwd(),file));
 const source=file.startsWith('virtual:')?virtual[file.slice(8)]:fs.readFileSync(phase==='before'&&fs.existsSync(prior)?prior:file,'utf8');
 let code=/\.tsx?$/.test(file)?ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText:source;
 code=code.replace(/require\(['"]([^'"]+)['"]\)/g,(_,name)=>`require(${add(resolve(name,file))})`);modules[id]=code;return id;}
 const entry=add('virtual:entry');return `(function(){const process={env:{NODE_ENV:'production'}};const modules={${Object.entries(modules).map(([id,code])=>`${id}:function(require,module,exports){${code}\n}`).join(',')}};const cache={};function require(id){if(cache[id])return cache[id].exports;const module=cache[id]={exports:{}};modules[id](require,module,module.exports);return module.exports;}require(${entry});})()`;
}
async function main(){
 const {chromium}=require('C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 const results=[],errors=[];
 try{const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));
 for(const phase of ['before','after']){
  const file=path.join(out,'info-'+phase+'.html');fs.writeFileSync(file,`<!doctype html><html lang="he" dir="rtl"><meta charset="utf-8"><style>body{margin:0;background:#eef2f8;font-family:Arial}#root{padding:16px}</style><div id="root"></div><script>${bundle(phase).replace(/<\/script/gi,'<\\/script')}</script></html>`);
  for(const width of [320,390,430])for(const fontScale of [1,1.5]){
   await page.setViewportSize({width,height:950});await page.addInitScript(scale=>window.fontScale=scale,fontScale);await page.goto(pathToFileURL(file).href);
   await page.getByText('איך מחושב הציון?',{exact:true}).waitFor();
   const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);if(overflow)throw Error('Horizontal overflow');
   if(width===390&&fontScale===1)await page.screenshot({path:path.join(out,'info-'+phase+'.png'),fullPage:true});
   if(phase==='after'){
    if(!await page.getByText('שער נקי',{exact:true}).isVisible())throw Error('Missing clean sheets');
    await page.getByText('המיקום במחזור מבוסס על הציון. טבלת המועדון והעונה מדורגת קודם לפי ניצחונות, ובשוויון לפי שערים ואז בישולים.',{exact:true}).scrollIntoViewIfNeeded();
    await page.evaluate(()=>window.draw(false));
    if(await page.getByText('שער נקי',{exact:true}).count())throw Error('Legacy explanation changed');
    await page.evaluate(()=>window.draw(true));
   }
   await page.getByRole('button',{name:'הבנתי',exact:true}).click();if(await page.getByText('איך מחושב הציון?',{exact:true}).count())throw Error('Close failed');
   results.push({phase,width,fontScale,overflow});
  }
 }
 if(errors.length)throw Error(errors.join(';'));
 fs.writeFileSync(path.join(out,'browser-results.json'),JSON.stringify({sourceJsx:true,native:false,datastore:'fixture',results,errors},null,2));
 console.log(JSON.stringify({cases:results.length,errors}));
 }finally{await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
