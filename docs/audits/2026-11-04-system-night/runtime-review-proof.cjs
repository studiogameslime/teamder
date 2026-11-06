const fs=require('fs'),path=require('path');
const crypto=require('crypto');
const inv=require('./controls.json');
const catalogue=new Set(inv.map(x=>x.id));
const proof={checkedAt:new Date().toISOString(),catalogue:{sites:inv.length,actions:catalogue.size},bundles:[]};
for(const folder of ['android-export','android-verified','mock-night-final','android-final']) {
  const dir=path.resolve('artifacts/system-night',folder,'_expo/static/js/android');
  if(!fs.existsSync(dir))continue;
  const file=fs.readdirSync(dir).find(x=>x.endsWith('.hbc'));if(!file)continue;
  const bytes=fs.readFileSync(path.join(dir,file)),raw=bytes.toString('latin1');
  const strings=new Set(raw.match(/ui_[a-f0-9]{18}/g)||[]);
  const row={folder,file,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,
    idStrings:strings.size,idStringsInCurrentCatalogue:[...strings].filter(id=>catalogue.has(id)).length,
    oldUnqualifiedHelperString:raw.includes('_trackControl')};
  const mapfile=fs.readdirSync(dir).find(x=>x.endsWith('.hbc.map'));
  if(mapfile) {
    const map=JSON.parse(fs.readFileSync(path.join(dir,mapfile),'utf8'));
    const present=new Set(map.sources.filter(s=>s.includes('/src/')&&!s.includes('node_modules')).map(s=>s.slice(s.lastIndexOf('/src/')+1)));
    row.sourceMap={sources:map.sources.length,appSources:present.size,inventorySitesInSourceMap:inv.filter(s=>present.has(s.filename)).length,
      catalogueFilesOutsideMap:[...new Set(inv.filter(s=>!present.has(s.filename)).map(s=>s.filename))]};
  }
  proof.bundles.push(row);
}
const disasmFile=process.argv[2]||'artifacts/system-night/runtime-review-disassembly.log';
if(fs.existsSync(disasmFile)) {
  const text=fs.readFileSync(disasmFile,'utf8');
  const prefixes=[...text.matchAll(/^\s*LoadConstString\s+\w+, "(ui_[a-f0-9]+)/gm)].map(m=>m[1]);
  const unique=new Set(prefixes);
  const ambiguous=[...unique].filter(prefix=>[...catalogue].filter(id=>id.startsWith(prefix)).length!==1);
  const loaded=new Set([...catalogue].filter(id=>[...unique].some(prefix=>id.startsWith(prefix))));
  proof.disassembly={file:disasmFile,controlStringLoads:prefixes.length,uniquePrefixes:unique.size,
    ambiguousOrUnknownPrefixes:ambiguous,matchingControlActions:loaded.size,matchingControlSites:inv.filter(s=>loaded.has(s.id)).length,
    filesWithoutLoadedControl:[...new Set(inv.filter(s=>!loaded.has(s.id)).map(s=>s.filename))]};
}
fs.writeFileSync(path.join(__dirname,'runtime-review-result.json'),JSON.stringify(proof,null,2)+'\n');
console.log(JSON.stringify(proof,null,2));
