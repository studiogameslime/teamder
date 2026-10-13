// No Firebase CLI, credentials, export/import or production project is used.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const net=require('node:net'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
const root=path.resolve(__dirname,'../..'),out=path.join(root,'artifacts');
if(process.argv.slice(2).some(arg=>!['--lifecycle','--approved'].includes(arg)))throw Error('Unsupported runner argument');
const lifecycle=process.argv.includes('--lifecycle');
const approved=process.argv.includes('--approved');
if(approved&&!lifecycle)throw Error('Approved policy mode requires lifecycle tests');
const prefix=approved?'approved-statistics-lifecycle':lifecycle?'night-ninth':'night-eighth';
const files=lifecycle?['tests/integration/seasonLifecycle.firestore.cjs']:['tests/integration/seasonRollover.firestore.cjs','tests/integration/retroGoals.firestore.cjs'];
const host='127.0.0.1',port=8185,project=lifecycle?'demo-teamder-season-lifecycle':'demo-teamder-night-audit';
const jar=process.env.TEAMDER_FIRESTORE_EMULATOR_JAR||path.join(os.homedir(),'.cache/firebase/emulators/cloud-firestore-emulator-v1.22.0.jar');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex');
function run(command,args,log,options={}){
 return new Promise((resolve,reject)=>{
  const child=spawn(command,args,{cwd:root,windowsHide:true,...options});let output='';
  for(const stream of [child.stdout,child.stderr])stream?.on('data',chunk=>{log.write(chunk);output+=chunk.toString();});
  child.on('error',reject);child.on('close',(code,signal)=>resolve({code,signal,output}));
 });
}
async function assertPortFree(){
 await new Promise((resolve,reject)=>{const server=net.createServer();server.once('error',reject);server.listen(port,host,()=>server.close(resolve));});
}
async function listening(){
 return new Promise(resolve=>{const socket=net.connect({host,port});socket.once('connect',()=>{socket.destroy();resolve(true);});socket.once('error',()=>resolve(false));socket.setTimeout(500,()=>{socket.destroy();resolve(false);});});
}
(async()=>{
 if(!project.startsWith('demo-')||host!=='127.0.0.1')throw Error('Local demo target required');
 if(!fs.existsSync(jar))throw Error('Cached emulator JAR missing; no download attempted');
 fs.mkdirSync(out,{recursive:true});await assertPortFree();
 const buildLog=fs.createWriteStream(path.join(out,prefix+'-functions.log'));
 const build=await run(process.platform==='win32'?'cmd.exe':'npm',process.platform==='win32'?['/d','/s','/c','npm --prefix functions run build']:['--prefix','functions','run','build'],buildLog);buildLog.end();
 if(build.code!==0)throw Error('Local functions build failed; see '+prefix+'-functions.log');
 const emulatorLog=fs.createWriteStream(path.join(out,prefix+'-emulator.log'));
 const emulator=spawn('java',['-jar',jar,'--host='+host,'--port='+port,'--project_id='+project],{cwd:root,windowsHide:true});
 for(const stream of [emulator.stdout,emulator.stderr])stream.on('data',chunk=>emulatorLog.write(chunk));
 let emulatorExited=false,emulatorError=null;
 const stopped=new Promise(resolve=>{emulator.once('close',()=>{emulatorExited=true;resolve();});emulator.once('error',error=>{emulatorError=error;emulatorExited=true;resolve();});});
 let result;
 try{
  let ready=false;
  for(let i=0;i<150;i++){if(emulatorExited)throw emulatorError||Error('Local emulator exited');if(await listening()){ready=true;break;}await sleep(200);}
  if(!ready)throw Error('Local emulator did not become ready');
  const log=fs.createWriteStream(path.join(out,prefix+'-integration.log'));
  result=await run(process.execPath,['--test','--test-concurrency=1',...files],log);log.end();
 } finally {
  if(!emulatorExited)emulator.kill();
  await Promise.race([stopped,sleep(5000)]);
  if(!emulatorExited){emulator.kill('SIGKILL');await stopped;}
  emulatorLog.end();
 }
 const metadata={runAt:new Date().toISOString(),project,endpoint:host+':'+port,productionAccess:false,authAccountsCreated:0,emulatorStopped:emulatorExited,exitCode:result.code,
  sources:Object.fromEntries(['functions/src/seasonRollover.ts','functions/lib/seasonRollover.js','functions/src/index.ts','functions/src/seasonOperation.ts','tests/integration/run-statistics-firestore.cjs',...files].map(file=>[file,hash(file)]))};
 fs.writeFileSync(path.join(out,prefix+'-integration-metadata.json'),JSON.stringify(metadata,null,2)+'\n');
 if(result.code!==0)throw Error('Integration tests failed; see '+prefix+'-integration.log');
 console.log('Local integration tests passed; emulator stopped.');
 console.log(result.output.split(/\r?\n/).filter(line=>/^\s*(?:#|ℹ)\s*(?:tests|pass|fail|duration_ms)\b/.test(line)).join('\n'));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
