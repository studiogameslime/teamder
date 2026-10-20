const fs=require('fs'),path=require('path'),ts=require('typescript');
const root=path.resolve(__dirname, '../..');
function inspect(rel){const text=fs.readFileSync(path.join(root,rel),'utf8'),sf=ts.createSourceFile(rel,text,99,true,4);const out={file:rel,imports:[],components:[],states:[],actions:[],navigation:[],labels:[],failureHandling:[]};
const line=n=>sf.getLineAndCharacterOfPosition(n.getStart(sf)).line+1;
function walk(n){if(ts.isImportDeclaration(n))out.imports.push({source:n.moduleSpecifier.text,bindings:n.importClause?.getText(sf)});
if(ts.isJsxOpeningElement(n)||ts.isJsxSelfClosingElement(n)){const tag=n.tagName.getText(sf);out.components.push(tag);for(const a of n.attributes.properties)if(ts.isJsxAttribute(a)&&/^on[A-Z]/.test(a.name.text))out.actions.push({line:line(a),event:a.name.text,code:a.initializer?.getText(sf)});}
if(ts.isCallExpression(n)){const e=n.expression.getText(sf);if(e==='useState')out.states.push({line:line(n),code:n.parent.getText(sf)});if(/navigate$|^go$/.test(e))out.navigation.push({line:line(n),code:n.getText(sf)});if(/\.catch$/.test(e))out.failureHandling.push({line:line(n),code:n.getText(sf)});}
if(ts.isCatchClause(n))out.failureHandling.push({line:line(n),code:n.getText(sf)});
if((ts.isStringLiteral(n)||ts.isJsxText(n))&&/[א-ת]/.test(n.text))out.labels.push(n.text.trim());ts.forEachChild(n,walk);}walk(sf);out.components=[...new Set(out.components)];out.labels=[...new Set(out.labels)];return out;}
const screens=fs.readdirSync(root+'/pulse/src/screens').filter(f=>f.endsWith('.tsx')).sort().map(f=>inspect('pulse/src/screens/'+f));
const components=fs.readdirSync(root+'/pulse/src/components').filter(f=>f.endsWith('.tsx')).sort().map(f=>inspect('pulse/src/components/'+f));
fs.mkdirSync(root+'/docs/audits/evidence/pulse-structure',{recursive:true});fs.writeFileSync(root+'/docs/audits/evidence/pulse-structure/'+(process.argv[2]||'screen-inventory-current.json'),JSON.stringify({date:'2026-10-18',method:'TypeScript AST, static analysis only; no runtime claims',screens,components},null,2)+'\n');
console.log(JSON.stringify({screens:screens.length,components:components.length}));
