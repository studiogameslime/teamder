import fs from 'fs';
import { commitFreshSeasonBatch } from '../../functions/src/commitFreshSeasonBatch';
import vm from 'vm';
import ts from 'typescript';
import * as types from '@/types';
import * as draftColors from '@/utils/draftColors';
import * as engine from '@/services/rotationEngine';
import * as edit from '@/utils/liveTeamsEdit';
import * as tally from '@/utils/goalTally';
import * as decision from '@/utils/roundDecision';
import * as shootout from '@/utils/shootoutDecision';
import * as played from '@/utils/eveningPlayed';
import * as narrative from '@/utils/eveningNarrative';
import * as highlights from '@/utils/eveningHighlights';
import * as eveningStats from '@/utils/eveningStats';
import {eveningScore} from '@/utils/eveningScore';
import {rotationWriteSource} from '@/services/rotationWriteSource';
import {stripUndefined} from '@/utils/stripUndefined';
import {liveLineupFingerprint} from '@/utils/liveLineupFingerprint';
import {alternativeRoundFingerprint} from '@/utils/alternativeRoundDecision';
import {buildShootoutPenaltyPayload} from '@/utils/penaltyStats';
import * as inPlayPenalty from '@/utils/inPlayPenalty';
import {verifiedInPlayPenalties,penaltyParticipants} from '../../functions/src/inPlayPenalties';
import {sortRounds} from '@/utils/roundHistoryOrder';
import {buildRoundSides} from '../../functions/src/roundSides';
import {roundParticipantSides} from '../../functions/src/roundParticipants';
import {liveRoundKey,matchesLiveRound} from '../../functions/src/liveRoundCommit';
import {StatBatch,MAX_ROUND_BATCH_OPS} from '../../functions/src/statBatch';
import {commitRoundInOrder} from '../../functions/src/commitProtocol';
import {liveSeasonStamp} from '../../functions/src/liveSeasonStamp';
import {assertSeasonOpenForGame} from '../../functions/src/seasonLock';
import {eveningScoreServer} from '../../functions/src/eveningScoreCore';
import {computeMovement} from '../../functions/src/eveningMovement';
import {buildRoundSummary,nextRecordBaseline} from '../../functions/src/roundSummary';
import {pairsFromRounds,pairMembers} from '../../functions/src/clubChemistry';
import {liveTeamsFixture} from './liveTeamsWorld';

const compile=(code:string)=>ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const backend=ts.createSourceFile('server.ts',fs.readFileSync('functions/src/index.ts','utf8'),ts.ScriptTarget.Latest,true);
function sourceNode(predicate:(n:ts.Node)=>boolean):ts.Node {
 let found:ts.Node|undefined;function visit(n:ts.Node){if(predicate(n))found=n;else ts.forEachChild(n,visit);}visit(backend);
 if(!found)throw Error('Missing production source');return found;
}
const callableSource=(sourceNode(n=>ts.isVariableDeclaration(n)&&n.name.getText(backend)==='commitRoundStats') as ts.VariableDeclaration).initializer!.getText(backend);
const finishSource=sourceNode(n=>ts.isIfStatement(n)&&n.expression.getText(backend).includes('!wasHappened')&&n.expression.getText(backend).includes('isHappened')).getText(backend);
const clone=<T,>(value:T):T=>structuredClone(value);

/** Real client, callable, finish-stage body, converters and summary reader.
 * Only SDK storage/auth/notifications are replaced. No account or network. */
export function liveTeamsEndToEndWorld(size=4) {
 const initial=liveTeamsFixture(4,size);initial.rotation!.round=1;initial.rotation!.roundInstanceRound=1;
 initial.rotation!.roundInstanceId='first';initial.rotation!.wins={};initial.rotation!.fillUsage={};delete initial.lastCommittedRoundId;
 initial.liveMatch!.goalTally={'t0-p0':1};
 const documents=new Map<string,any>([['games/audit',initial],['groups/club',{adminIds:['owner']}]]);
 const versions=new Map<string,number>();const commits:any[][]=[];const payloads:any[]=[];let failure=false,lostAck=false,failPath:string|undefined;
 const field=(data:any,path:string)=>path.split('.').reduce((v,k)=>v?.[k],data);
 function merge(target:any,patch:any,deep:boolean){for(const [key,value]of Object.entries(patch)as[string,any][]){
  const parts=key.split('.');let parent=target;for(const part of parts.slice(0,-1))parent=parent[part]??={};const last=parts.at(-1)!;
  if(value?.__delete)delete parent[last];else if(value?.__increment!==undefined)parent[last]=(parent[last]??0)+value.__increment;
  else if(value?.__union)parent[last]=[...(parent[last]??[]),...clone(value.__union).filter((v:any)=>!(parent[last]??[]).some((x:any)=>JSON.stringify(x)===JSON.stringify(v)))];
  else if(deep&&value&&typeof value==='object'&&!Array.isArray(value))merge(parent[last]??={},value,true);
  else parent[last]=clone(value);
 }}
 const snapshot=(path:string)=>{const data=clone(documents.get(path));return{id:path.split('/').at(-1),ref:ref(path),exists:documents.has(path),updateTime:versions.get(path)??1,createTime:{toMillis:()=>1},data:()=>data,get:(key:string)=>field(data,key)};};
 function ref(path:string,filters:any[]=[],sorting?:string):any{return{path,collection:(name:string)=>ref(`${path}/${name}`),doc:(id:string)=>ref(`${path}/${id}`),
  where:(key:string,op:string,value:any)=>ref(path,[...filters,[key,op,value]],sorting),orderBy:(key:string)=>ref(path,filters,key),limit:()=>ref(path,filters,sorting),
  get:async()=>{if(path.split('/').length%2===0)return snapshot(path);
   let rows=[...documents.keys()].filter(k=>k.startsWith(path+'/')&&k.split('/').length===path.split('/').length+1&&filters.every(([key,op,value])=>op==='=='?field(documents.get(k),key)===value:op==='in'?value.includes(field(documents.get(k),key)):true)).map(snapshot);
   if(sorting)rows.sort((a,b)=>(a.get(sorting)??0)-(b.get(sorting)??0));return{docs:rows,empty:!rows.length,size:rows.length};},
  set:async(data:any,options?:any)=>apply({kind:options?.merge?'merge':'set',reference:{path},data}),
  update:async(data:any)=>apply({kind:'update',reference:{path},data}),
  create:async(data:any)=>{if(documents.has(path))throw Object.assign(Error('exists'),{code:6});apply({kind:'set',reference:{path},data});},
 };}
 function apply(write:any){const path=write.reference.path;const value=write.kind==='set'||write.kind==='create'?{}:documents.get(path)??{};
  merge(value,write.data,write.kind!=='update');documents.set(path,value);versions.set(path,(versions.get(path)??1)+1);}
 const db={collection:ref,getAll:async(...refs:any[])=>Promise.all(refs.map(r=>r.get())),batch:()=>{
  const writes:any[]=[];const batch:any={};for(const kind of ['create','set','update'])batch[kind]=(reference:any,data:any,options:any)=>{writes.push({kind:kind==='set'&&options?.merge?'merge':kind,reference,data,precondition:kind==='update'?options:undefined});return batch;};
  batch.commit=async()=>{if(failure||writes.some(w=>w.reference.path===failPath))throw Error('UNAVAILABLE');for(const w of writes){if(w.kind==='create'&&documents.has(w.reference.path))throw Object.assign(Error('exists'),{code:6});
   if(w.precondition&&w.precondition.lastUpdateTime!==(versions.get(w.reference.path)??1))throw Error('STALE_VERSION');}writes.forEach(apply);commits.push(writes.map(w=>({kind:w.kind,path:w.reference.path,data:clone(w.data)})));};return batch;}};
 const marker={increment:(__increment:number)=>({__increment}),delete:()=>({__delete:true}),arrayUnion:(...__union:any[])=>({__union})};
 const logs=jest.fn();const consoleQuiet={log:jest.fn(),warn:jest.fn(),error:logs};
 const serverContext:any={verifiedInPlayPenalties,penaltyParticipants,db,admin:{firestore:{FieldValue:marker}},Date,console:consoleQuiet,observeCaughtError:logs,
  onCall:(_:any,handler:any)=>handler,ENFORCE_APP_CHECK:false,HttpsError:class extends Error{constructor(public code:string,message:string){super(message);}},
  liveRoundKey,matchesLiveRound,buildRoundSides,roundParticipantSides,StatBatch,MAX_ROUND_BATCH_OPS,commitRoundInOrder,liveSeasonStamp,assertSeasonOpenForGame,
  isReal:(id:string)=>!id.startsWith('guest:')};
 const commit=vm.runInNewContext(compile(`(${callableSource})`),serverContext);
 const call=async(input:any)=>{payloads.push(clone(input));const data=await commit({auth:{uid:'owner'},data:input});if(lostAck){lostAck=false;throw Error('ACK_LOST');}return{data};};
 let converter:any;
 const clientSnap=(r:any)=>{const s=snapshot(r.path);return{...s,exists:()=>s.exists,data:()=>r.converted?converter.fromFirestore(s):s.data()};};
 const io:any={doc:(base:any,...path:string[])=>ref([base?.path,...path].filter(Boolean).join('/')),collection:(base:any,...path:string[])=>ref([base?.path,...path].filter(Boolean).join('/')),
  getDoc:async(r:any)=>clientSnap(r),getDocFromServer:async(r:any)=>clientSnap(r),getDocs:(r:any)=>r.get(),
  query:(r:any,...clauses:any[])=>clauses.reduce((q:any,c:any)=>q[c.method](...c.args),r),where:(...args:any[])=>({method:'where',args}),orderBy:(...args:any[])=>({method:'orderBy',args}),limit:(...args:any[])=>({method:'limit',args}),
  updateDoc:(r:any,data:any)=>r.update(data),arrayUnion:marker.arrayUnion,increment:marker.increment,deleteField:marker.delete,
  runTransaction:async(_:any,callback:any)=>{const staged:any[]=[];const reads=new Map<string,number>();await callback({get:async(r:any)=>{reads.set(r.path,versions.get(r.path)??1);return clientSnap(r);},update:(reference:any,data:any)=>staged.push({kind:'update',reference,data})});
   if(failure)throw Error('UNAVAILABLE');for(const [path,version]of reads)if((versions.get(path)??1)!==version)throw Error('STALE_VERSION');staged.forEach(apply);},
 };
 const deps:any={'@/utils/inPlayPenalty':inPlayPenalty,'../utils/errorObservation':{observeCaughtError:logs},'firebase/firestore':io,'firebase/functions':{httpsCallable:()=>call},
  '@/firebase/config':{USE_MOCK_DATA:false,getFirebase:()=>({db,functions:{}})},'@/firebase/firestore':{docs:{game:(id:string)=>({...ref(`games/${id}`),converted:true})}},
  '@/types':types,'@/services/rotationEngine':engine,'@/utils/liveTeamsEdit':edit,'@/utils/goalTally':tally,'@/utils/roundDecision':decision,'@/utils/shootoutDecision':shootout,
  '@/utils/alternativeRoundDecision':{alternativeRoundFingerprint},'@/utils/liveLineupFingerprint':{liveLineupFingerprint},'@/utils/penaltyStats':{buildShootoutPenaltyPayload},
  '@/utils/stripUndefined':{stripUndefined},'@/services/rotationWriteSource':{rotationWriteSource},'@/utils/roundParticipants':{roundParticipantSides},
  '@/utils/roundHistoryOrder':{sortRounds},'@/services/serverClock':{serverNow:()=>Date.now()},'@/services/errorLog':{logError:logs,logUnexpected:logs},
  '@/services/analyticsService':{AnalyticsEvent:{GameFinished:'finished'},logEvent:jest.fn()},
  './analyticsService':{AnalyticsEvent:{GameFinished:'finished'},logEvent:jest.fn()},
  '@/utils/eveningPlayed':played,'@/utils/eveningNarrative':narrative,'@/utils/eveningHighlights':highlights,'@/utils/eveningStats':eveningStats,'@/utils/eveningScore':{eveningScore},
  '@/services/userService':{userService:{getUserById:async(id:string)=>({id,name:id})}},'@/services/eveningRecordService':{readPersonalEveningRecords:async()=>[]}};
 function load(path:string){const exports:any={};vm.runInNewContext(compile(fs.readFileSync(path,'utf8')),{exports,require:(id:string)=>{if(id.endsWith('/joinDiagnosticId'))return require('@/utils/joinDiagnosticId');if(id.endsWith('/diagnosticJournal'))return require('@/services/diagnosticJournal');if(id==='@/services/diagnosticCallable')id='firebase/functions';return deps[id]??{};},__DEV__:false,Date,console:consoleQuiet,setTimeout,clearTimeout});return exports;}
 // The real full document converter is used on every getGameById read.
 const converterExports:any={};vm.runInNewContext(compile(fs.readFileSync('src/firebase/firestore.ts','utf8')),{exports:converterExports,Date,require:(id:string)=>{if(id.endsWith('/joinDiagnosticId'))return require('@/utils/joinDiagnosticId');if(id.endsWith('/diagnosticJournal'))return require('@/services/diagnosticJournal');if(id==='@/services/diagnosticCallable')id='firebase/functions';return id==='firebase/firestore'?{collection:()=>({withConverter:(converter:any)=>({converter})}),doc:(c:any)=>c}:id==='./config'?{getFirebase:()=>({db:{}})}:id==='@/utils/draftColors'?draftColors:types;}});
 converter=converterExports.docs.game('audit').converter;
 const read=()=>({...converter.fromFirestore({id:'audit',data:()=>clone(documents.get('games/audit'))}),matches:[]});
 const service=load('src/services/gameService.ts').gameService;service.getGameById=async()=>read();deps['@/services/gameService']={gameService:service};
 const summaryService=load('src/services/eveningSummaryService.ts').eveningSummaryService;
 const roundSummaryService=load('src/services/roundSummaryService.ts').roundSummaryService;
 const finishContext:any={...serverContext,module:{exports:{}},eveningScoreServer,computeMovement,wasHappened:false,isHappened:true,
  groupOnce:()=>ref('groups/club').get(),stampedSeasonId:'',buildRoundSummary,nextRecordBaseline,pairsFromRounds,pairMembers,
  isPersonalGroup:async()=>false,archivedClubTotals:new Map(),archNum:(v:any)=>typeof v==='number'?v:0,TONIGHT_MS:12*60*60*1000,
  createNotificationOnce:jest.fn()};
 const definitions=['archivedCareerOf','guardFinishSeasonBatch','rollUpClubPairs','sealRoundSummary'].map(name=>sourceNode(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name).getText(backend)).join('\n');
 finishContext.commitFreshSeasonBatch = commitFreshSeasonBatch;
 vm.runInNewContext(compile(definitions),finishContext);
 vm.runInNewContext(compile(`module.exports=async function(){${finishSource}}`),finishContext);
 return{documents,commits,payloads,logs,service,read,summaryService,roundSummaryService,
  state:()=>documents.get('games/audit'),fail:(on=true)=>{failure=on;},loseAck:()=>{lostAck=true;},
  failAt:(path?:string)=>{failPath=path;},
  history:()=>[...documents.entries()].filter(([p])=>p.startsWith('games/audit/roundHistory/')).map(([,v])=>clone(v)),
  finishStages:async()=>{finishContext.after=clone(documents.get('games/audit'));finishContext.event={params:{gameId:'audit'},data:{after:{ref:ref('games/audit')}}};await finishContext.module.exports();},
  finishContext,db,ref,serverContext,
  rawCall:(data:any)=>commit({auth:{uid:'owner'},data}),
 };
}
