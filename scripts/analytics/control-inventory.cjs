const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const t = require('@babel/types');
const { root, supported, discover, relative } = require('./control-sites.cjs');
const { labelFor } = require('./control-labels.cjs');
const registry = require('../../docs/features/status/state.json');
const titles = Object.fromEntries(registry.features.map(feature => [feature.id,feature.title]));
const ast = file => parser.parse(fs.readFileSync(file,'utf8'), {sourceType:'module', plugins:['jsx','typescript','decorators-legacy']});
function files(dir) {
  return fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry => {
    const name = path.join(dir,entry.name);
    return entry.isDirectory() ? files(name) : [name];
  });
}
const translations = {};
traverse(ast(path.join(root,'src/i18n/he.ts')),{ObjectProperty(p) {
  if(t.isIdentifier(p.node.key) && t.isStringLiteral(p.node.value)) translations[p.node.key.name] = p.node.value.value;
}});
const sites = [];
const signatures = new Map();
for(const file of [...files(path.join(root,'src')),path.join(root,'App.tsx')].sort()) {
  const name = relative(file);
  if(!supported(name)) continue;
  traverse(ast(file),{Program(p) {
    for(const {id,label,filename,line,scope,kind,handler,signature} of discover(p,name,translations)) {
      if(signatures.has(id) && signatures.get(id)!==signature) throw Error('Control ID collision');
      signatures.set(id,signature);
      sites.push({id,label,filename,line,scope,kind,handler});
    }
    p.stop();
  }});
}
const catalog = Object.fromEntries(sites.map(s => [s.id,labelFor(s,registry.screens,titles)]));
const generated = path.join(root,'pulse/src/data/controlActions.json');
const body = JSON.stringify(catalog,null,2)+'\n';
if(process.argv.includes('--check')) {
  if(fs.readFileSync(generated,'utf8') !== body) throw Error('Regenerate the control inventory');
} else {
  fs.mkdirSync(path.dirname(generated),{recursive:true});
  fs.writeFileSync(generated,body);
}
if(process.argv.includes('--evidence')) {
  const out = path.join(root,'docs/audits/2026-11-04-system-night/controls.json');
  fs.writeFileSync(out,JSON.stringify(sites)+'\n');
}
const analyticsSource = fs.readFileSync(path.join(root,'src/services/analyticsService.ts'),'utf8');
const businessKeys = [...analyticsSource.matchAll(/^\s+[A-Z]\w*:\s*'([a-z0-9_]+)'/gm)].map(m=>m[1]);
const approved = JSON.stringify([...new Set([...businessKeys,...Object.keys(catalog)])].sort())+'\n';
for (const dir of ['src/utils','functions/src','pulse/src/services']) {
  const dest = path.join(root,dir,'productActionKeys.json');
  if (process.argv.includes('--check')) {
    if (fs.readFileSync(dest,'utf8') !== approved) throw Error('Product key copy is stale: '+dir);
  } else fs.writeFileSync(dest,approved);
}
console.log(JSON.stringify({sites:sites.length,actions:signatures.size,files:new Set(sites.map(s=>s.filename)).size,staticLabels:sites.filter(s=>!s.label.includes(' במסך ') && s.label !== 'בחירה בחלונית').length}));
