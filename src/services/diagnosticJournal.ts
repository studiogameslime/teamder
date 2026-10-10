/** Local-only diagnostic flight recorder. No network or analytics dependencies. */
export type DiagnosticKind = 'launch' | 'tap' | 'nav' | 'act' | 'err' | 'scroll' | 'press' | 'gesture';
export type DiagnosticEntry = { seq:number; ms:number; kind:DiagnosticKind; name:string; screen?:string; data?:Record<string,string|number|boolean> };
export type DiagnosticSnapshot = { schema:1; sessionId:string; startedAt:number; capturedAt:number; total:number; omitted:number; entries:DiagnosticEntry[] };
const MAX_ENTRIES=5000;
const HEAD=100;
const REPORT_CHARS=60000;
const ALLOWED=new Set(['gameId','groupId','matchId','roundId','game_id','group_id','match_id','round_id','tab','type','status','index','selected','enabled','x','y','dx','dy','offsetX','offsetY','width','height','target','surface','direction','phase']);
let startedAt=Date.now(), sessionId=makeId(), total=0, entries:DiagnosticEntry[]=[], screen:string|undefined;
let owner:string|null|undefined;
let changeListener:(()=>void)|undefined;
function makeId(){return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}`;}
/** Explicit allowlist: never copy route params, typed text, names, URLs or tokens. */
export function diagnosticData(value:unknown):Record<string,string|number|boolean> {
 const out:Record<string,string|number|boolean>={};
 if(!value||typeof value!=='object')return out;
 for(const [key,v] of Object.entries(value)){
  if(!ALLOWED.has(key))continue;
  if(typeof v==='number'&&Number.isFinite(v))out[key]=Math.round(v*100)/100;
  else if(typeof v==='boolean')out[key]=v;
  else if(typeof v==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(v))out[key]=v;
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
 screen=name;recordDiagnostic('nav',name,safe);
}
export function resetDiagnosticJournal():void {
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
 return {schema:1,sessionId,startedAt,capturedAt:Date.now(),total,omitted:total-entries.length,entries:entries.map(e=>({...e,...(e.data?{data:{...e.data}}:{})}))};
}
export function diagnosticReportScreen():string|undefined {
 return [...entries].reverse().find(e=>e.kind==='nav'&&e.name!=='Feedback')?.name;
}
/** Keep the start AND the tail, and explicitly disclose any middle removed. */
export function diagnosticAttachment(maxChars=REPORT_CHARS):string {
 const snap=diagnosticSnapshot();
 let json=JSON.stringify(snap);
 while(json.length>maxChars&&snap.entries.length>2){
  const first=Math.min(HEAD,Math.floor(snap.entries.length/4));
  const remove=Math.max(1,Math.ceil(snap.entries.length/5));
  snap.entries.splice(first,remove);snap.omitted=snap.total-snap.entries.length;
  json=JSON.stringify(snap);
 }
 return json.length<=maxChars?json:'';
}
export function observeDiagnosticJournal(listener:()=>void):()=>void {
 changeListener=listener;return ()=>{if(changeListener===listener)changeListener=undefined;};
}
recordDiagnostic('launch','app_launch');
