// Freeze a source identity during Expo configuration, including uncommitted fixes.
// Never scan environment files, credentials or arbitrary workspace artifacts.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
module.exports=({config})=>{
 const hash=crypto.createHash('sha256');
 function visit(relative){
  const full=path.join(__dirname,relative);
  if(!fs.existsSync(full))return;
  if(fs.statSync(full).isDirectory()){for(const name of fs.readdirSync(full).sort())visit(path.join(relative,name));return;}
  if(!/\.(tsx?|jsx?|json|kt|swift|xml|gradle|m|h|patch)$/.test(relative))return;
  hash.update(relative.replace(/\\/g,'/'));hash.update(fs.readFileSync(full));
 }
 for(const file of ['src','App.tsx','app.json','package.json','package-lock.json','app.config.js','plugins','modules','patches','vendor/joryio'])visit(file);
 return {...config,extra:{...config.extra,diagnosticRevision:hash.digest('hex').slice(0,24),
  diagnosticBuildId:process.env.EAS_BUILD_ID??'unknown'}};
};
