/** Local-only diagnostic flight recorder. No network or analytics dependencies. */
export type DiagnosticKind = 'launch' | 'tap' | 'nav' | 'act' | 'err' | 'scroll' | 'press' | 'gesture';
export type DiagnosticEntry = { seq:number; ms:number; kind:DiagnosticKind; name:string; screen?:string; data?:Record<string,string|number|boolean> };
export type DiagnosticSnapshot = { schema:1; sessionId:string; startedAt:number; capturedAt:number; total:number; omitted:number; entries:DiagnosticEntry[]; context?:Record<string,string|number|boolean>; operations?:DiagnosticOperation[]; operationsOmitted?:number };
export type DiagnosticOperation = {id:string;name:string;startedAt:number;finishedAt?:number;durationMs?:number;result:'pending'|'success'|'failure';code?:string;before:Record<string,string|number|boolean>;after?:Record<string,string|number|boolean>;outcome?:Record<string,string|number|boolean>};
let contextProvider:(()=>unknown)|undefined;
let environment:Record<string,string|number|boolean>={};
let operations:DiagnosticOperation[]=[];
let pendingOperations=0,operationTotal=0;
let operationErrors=new WeakMap<object,DiagnosticOperation>();
let routeContext:Record<string,string|number|boolean>={};
const entityState=new Map<string,Record<string,string|number|boolean>>();
export function diagnosticEntity(kind:'game'|'profile',id:string,data:unknown):void{
 const key=`${kind}:${id}`;entityState.delete(key);entityState.set(key,{...diagnosticData(data),stateCapturedAt:Date.now()});
 if(entityState.size>30)entityState.delete(entityState.keys().next().value!);
}
export function setDiagnosticContextProvider(provider:()=>unknown):void{contextProvider=provider;}
export function setDiagnosticEnvironment(data:unknown):void{environment={...environment,...diagnosticData(data)};}
export function diagnosticContext():Record<string,string|number|boolean>{
 let state:unknown;try{state=contextProvider?.();}catch{/* Unknown is preferable to disrupting an operation. */}
 const game=typeof routeContext.gameId==='string'?entityState.get(`game:${routeContext.gameId}`):undefined;
 const profile=typeof owner==='string'?entityState.get(`profile:${owner}`):undefined;
 return {authPhase:'unknown',profileSource:'unknown',dataSource:'unknown',networkConnected:'unknown',internetReachable:'unknown',nativeBuild:'unknown',codeRevision:'unknown',...environment,...diagnosticData(state),...routeContext,...game,...profile,pendingRequests:pendingOperations};
}
export async function runDiagnosticOperation<T>(name:string,data:unknown,work:()=>Promise<T>,id?:string):Promise<T>{
 const span=beginDiagnosticOperation(name,data,id);
 try{const result=await work();span.finish(undefined,false,result);return result;}catch(error){span.finish(error,true);throw error;}
}
export function diagnosticErrorOperation(error:unknown):DiagnosticOperation|undefined{
 return error&&typeof error==='object'?operationErrors.get(error):undefined;
}
/** Explicit handle, never a global async current-operation slot. Concurrent calls stay separate. */
export function beginDiagnosticOperation(name:string,data?:unknown,id?:string){
 const session=sessionId;
 const operation:DiagnosticOperation={id:id&&/^[a-z0-9-]{10,100}$/.test(id)?id:makeId(),name:/^[\w.:-]{1,100}$/.test(name)?name:'operation',startedAt:Date.now(),result:'pending',before:{...diagnosticContext(),...diagnosticData(data)}};
 operationTotal++;pendingOperations++;operations.push(operation);if(operations.length>20)operations.splice(0,operations.length-20);
 recordDiagnostic('act',operation.name,{...data as object,phase:'start',operationId:operation.id});
 return {id:operation.id,finish(error?:unknown,failed=false,result?:unknown){
  if(session!==sessionId||operation.result!=='pending')return;
  operation.finishedAt=Date.now();operation.durationMs=Math.max(0,operation.finishedAt-operation.startedAt);
  pendingOperations=Math.max(0,pendingOperations-1);
  operation.result=failed||error!==undefined?'failure':'success';operation.after=diagnosticContext();
  const outcome=diagnosticData(result);if(Object.keys(outcome).length)operation.outcome=outcome;
  const code=(error as {code?:unknown}|null)?.code;
  if(typeof code==='string')operation.code=/^[\w/.-]{1,100}$/.test(code)?code:'unknown';
  // The innermost failed request owns correlation; an outer user action must
  // not replace its server request id while rethrowing the same exception.
  if(error&&typeof error==='object'&&!operationErrors.has(error))operationErrors.set(error,operation);
  recordDiagnostic('act',operation.name,{phase:operation.result,operationId:operation.id,durationMs:operation.durationMs});
 }};
}
const MAX_ENTRIES=5000;
const HEAD=100;
const REPORT_CHARS=60000;
const ALLOWED=new Set(['gameId','groupId','matchId','roundId','game_id','group_id','match_id','round_id','tab','type','status','index','selected','enabled','x','y','dx','dy','offsetX','offsetY','width','height','target','surface','direction','phase']);
for(const key of ['bucket','success','accepted'])ALLOWED.add(key);
ALLOWED.add('joinTappedAt');
for(const key of ['profileDocumentPresent','profileHasPendingWrites','seasonId','operationId','attempt','durationMs','pendingRequests','authPhase','profilePresent','profileComplete','onboardingComplete','authHydrated','profileRestoreFailed','groupHydrated','role','memberCount','playerCount','waitlistCount','maxPlayers','gameStatus','profileSource','dataSource','hasPendingWrites','stateCapturedAt','networkConnected','internetReachable','networkType','networkObservedAt','appState','lastResumeAt','appVersion','nativeBuild','buildId','codeRevision','runtimeVersion','sportsActivityEnabled','networkObserver'])ALLOWED.add(key);
let startedAt=Date.now(), sessionId=makeId(), total=0, entries:DiagnosticEntry[]=[], screen:string|undefined;
let owner:string|null|undefined;
let changeListener:(()=>void)|undefined;
function makeId(){return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10).padEnd(8,'0')}`;}
/** Explicit allowlist: never copy route params, typed text, names, URLs or tokens. */
export function diagnosticData(value:unknown):Record<string,string|number|boolean> {
 const out:Record<string,string|number|boolean>={};
 if(!value||typeof value!=='object')return out;
 for(const [key,v] of Object.entries(value)){
  if(!ALLOWED.has(key))continue;
  if(typeof v==='number'&&Number.isFinite(v))out[key]=Math.round(v*100)/100;
  else if(typeof v==='boolean')out[key]=v;
  else if(typeof v==='string'&&(['appVersion','runtimeVersion'].includes(key)?/^[a-zA-Z0-9_.-]{1,128}$/:/^[a-zA-Z0-9_-]{1,128}$/).test(v))out[key]=v;
 }
 return out;
}
export function recordDiagnostic(kind:DiagnosticKind,name:string,data?:unknown):void {
 try{
  // Callers supply stable code labels, never user-generated visible strings.
  const label=/^[a-zA-Z0-9_.:/,-]{1,120}$/.test(name)?name:'control';
  const safe=diagnosticData(data);
  entries.push({seq:++total,ms:Math.max(0,Date.now()-startedAt),kind,name:label,...(screen?{screen}:{}),...(Object.keys(safe).length?{data:safe}:{})});
  if(entries.length>MAX_ENTRIES)entries.splice(HEAD,entries.length-MAX_ENTRIES);
  changeListener?.();
 }catch{/* Diagnostics must never affect the operation being observed. */}
}
export function diagnosticRoute(name:string,params?:unknown):void {
 if(!/^[a-zA-Z0-9_-]{1,100}$/.test(name))return;
 const safe=diagnosticData(params), last=entries[entries.length-1];
 if(last?.kind==='nav'&&last.name===name&&JSON.stringify(last.data??{})===JSON.stringify(safe))return;
 screen=name;routeContext=safe;recordDiagnostic('nav',name,safe);
}
export function resetDiagnosticJournal():void {
 operations=[];pendingOperations=0;operationTotal=0;operationErrors=new WeakMap();routeContext={};entityState.clear();
  startedAt=Date.now();sessionId=makeId();total=0;entries=[];screen=undefined;changeListener?.();
 recordDiagnostic('launch','session_start');
}
export function diagnosticOwner():string|null|undefined{return owner;}
/** First auth hydration preserves startup; a later account change starts clean. */
export function bindDiagnosticOwner(uid:string|null):boolean {
 const changed=owner!==undefined&&owner!==uid;
 if(changed)resetDiagnosticJournal();
  owner=uid;
 changeListener?.();
 return changed;
}
export function diagnosticSnapshot():DiagnosticSnapshot {
 return {schema:1,sessionId,startedAt,capturedAt:Date.now(),total,omitted:total-entries.length,context:diagnosticContext(),operations:JSON.parse(JSON.stringify(operations)),operationsOmitted:Math.max(0,operationTotal-operations.length),entries:entries.map(e=>({...e,...(e.data?{data:{...e.data}}:{})}))};
}
export function diagnosticReportScreen():string|undefined {
 return [...entries].reverse().find(e=>e.kind==='nav'&&e.name!=='Feedback')?.name;
}
/** Keep the start AND the tail, and explicitly disclose any middle removed. */
export function diagnosticAttachment(maxChars=REPORT_CHARS):string {
 return compactDiagnosticAttachment(diagnosticSnapshot(),maxChars);
}
export function compactDiagnosticAttachment(snapshot:DiagnosticSnapshot,maxChars=REPORT_CHARS):string {
 const snap:DiagnosticSnapshot=JSON.parse(JSON.stringify(snapshot));
 // Bound the richer envelope too; retain explicit incompleteness rather than returning a blank report.
 if(maxChars<10000){delete snap.operations;delete snap.context;}
 let json=JSON.stringify(snap);
 while(json.length>maxChars&&snap.entries.length>2){
  const first=Math.min(HEAD,Math.floor(snap.entries.length/4));
  const remove=Math.max(1,Math.ceil(snap.entries.length/5));
  snap.entries.splice(first,remove);snap.omitted=snap.total-snap.entries.length;
  json=JSON.stringify(snap);
 }
 while(json.length>maxChars&&snap.operations&&snap.operations.length>1){
  snap.operations.splice(0,1);snap.operationsOmitted=(snap.operationsOmitted??0)+1;json=JSON.stringify(snap);
 }
 return json.length<=maxChars?json:'';
}
export function compactCapturedDiagnosticAttachment(raw:string,maxChars=REPORT_CHARS):string{
 try{const snap=JSON.parse(raw);return snap?.schema===1&&Array.isArray(snap.entries)?compactDiagnosticAttachment(snap,maxChars):'';}catch{return '';}
}
export function observeDiagnosticJournal(listener:()=>void):()=>void {
 changeListener=listener;return ()=>{if(changeListener===listener)changeListener=undefined;};
}
recordDiagnostic('launch','app_launch');
