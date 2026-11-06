const fs=require('fs'),path=require('path'),ts=require('typescript');
const out=__dirname;
const parse=file=>ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const files=fs.readdirSync('src/navigation').filter(n=>n.endsWith('Stack.tsx')).map(n=>'src/navigation/'+n);
const stacks=[];
for(const file of files) {
  const source=parse(file),routes=[];
  function walk(node) {
    if(ts.isJsxSelfClosingElement(node)||ts.isJsxOpeningElement(node)) {
      if(node.tagName.getText(source).endsWith('.Screen')) {
        const attrs=node.attributes.properties;
        const name=attrs.find(a=>ts.isJsxAttribute(a)&&a.name.text==='name')?.initializer;
        const module=node.getText(source).match(/require\(['"](@\/[^'"]+)['"]\)/)?.[1];
        if(name&&ts.isStringLiteral(name))routes.push({route:name.text,module});
      }
    }
    ts.forEachChild(node,walk);
  }
  walk(source);stacks.push({file,routes});
}
const tabs=fs.readFileSync('src/navigation/MainTabs.tsx','utf8');
const global=new Set([...tabs.matchAll(/<Tab.Screen\s+name="([^"]+)"/g)].map(m=>m[1]));
const checked=[],missing=[];
for(const s of stacks)for(const r of s.routes) {
  if(!r.module)continue;
  const module=r.module.replace('@/','src/')+'.tsx';
  if(!fs.existsSync(module))continue;
  const source=parse(module),targets=new Set();
  function walk(node) {
    if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&node.expression.name.text==='navigate') {
      const a=node.arguments[0];if(a&&ts.isStringLiteral(a))targets.add(a.text);
    }
    ts.forEachChild(node,walk);
  }
  walk(source);
  for(const target of targets) {
    const valid=s.routes.some(x=>x.route===target)||global.has(target);
    const row={stack:s.file,parent:r.route,target,registered:valid};
    checked.push(row);if(!valid)missing.push(row);
  }
}
const result={method:'static source census of direct literal screen navigation',stackCount:stacks.length,registrationCount:stacks.reduce((n,s)=>n+s.routes.length,0),checked,missing};
fs.writeFileSync(path.join(out,'navigation-census.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({stacks:result.stackCount,registrations:result.registrationCount,edges:checked.length,missing}));
