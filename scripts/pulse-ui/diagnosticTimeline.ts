export type Step={seq:number;ms:number;kind:string;name:string;screen?:string;data?:Record<string,string|number|boolean>};
export type Operation={id:string;name:string;startedAt:number;durationMs?:number;result:'pending'|'success'|'failure';code?:string;before:Record<string,string|number|boolean>;after?:Record<string,string|number|boolean>;outcome?:Record<string,string|number|boolean>};
export type Journal={sessionId:string;total:number;omitted:number;entries:Step[];context?:Record<string,string|number|boolean>;operations?:Operation[];operationsOmitted?:number};
function primitiveState(raw:unknown):Record<string,string|number|boolean>{
 const out:Record<string,string|number|boolean>={};
 if(raw&&typeof raw==='object'&&!Array.isArray(raw))for(const [k,v]of Object.entries(raw).slice(0,60)){
  if(typeof v==='string')out[k.slice(0,60)]=v.slice(0,160);else if(typeof v==='boolean'||typeof v==='number'&&Number.isFinite(v))out[k.slice(0,60)]=v;
 }return out;
}

export function parseJournal(raw:unknown):Journal|null {
 try{
  if(typeof raw!=='string'||raw.length>350000)return null;
  const v=JSON.parse(raw);
  if(v.schema!==1||!Array.isArray(v.entries)||v.entries.length>5000)return null;
  if(!Number.isInteger(v.total)||v.total<0||!Number.isInteger(v.omitted)||v.omitted<0)return null;
  const entries=v.entries.filter((e:Step)=>e&&Number.isInteger(e.seq)&&e.seq>0&&Number.isFinite(e.ms)&&e.ms>=0&&typeof e.kind==='string'&&typeof e.name==='string').map((e:Step)=>{
   const data:Record<string,string|number|boolean>={};
   if(e.data&&typeof e.data==='object')for(const [key,value]of Object.entries(e.data)){
    if(typeof value==='string')data[key.slice(0,60)]=value.slice(0,160);
    else if(typeof value==='boolean'||(typeof value==='number'&&Number.isFinite(value)))data[key.slice(0,60)]=value;
   }
   return {seq:e.seq,ms:e.ms,kind:e.kind.slice(0,30),name:e.name.slice(0,120),screen:typeof e.screen==='string'?e.screen.slice(0,100):undefined,data};
  }).sort((a:Step,b:Step)=>a.seq-b.seq);
  const operations:Operation[]=Array.isArray(v.operations)?v.operations.slice(-20).flatMap((op:any)=>{
   if(!op||typeof op.id!=='string'||typeof op.name!=='string'||!Number.isFinite(op.startedAt)||!['pending','success','failure'].includes(op.result))return [];
   return [{id:op.id.slice(0,100),name:op.name.slice(0,100),startedAt:op.startedAt,result:op.result,
    ...(Number.isFinite(op.durationMs)&&op.durationMs>=0?{durationMs:op.durationMs}:{}),...(typeof op.code==='string'?{code:op.code.slice(0,100)}:{}),outcome:primitiveState(op.outcome),before:primitiveState(op.before),...(op.after?{after:primitiveState(op.after)}:{})}];
  }):[];
  return {operationsOmitted:Number.isSafeInteger(v.operationsOmitted)&&v.operationsOmitted>=0?v.operationsOmitted:0,context:v.context?primitiveState(v.context):undefined,operations,sessionId:String(v.sessionId??'').slice(0,100),total:v.total,omitted:Math.max(v.omitted,v.total-entries.length),entries};
 }catch (caughtError756efbc373){
    return null;}
}
const names:Record<string,string>={app_launch:'פתיחת האפליקציה',session_start:'תחילת הפעלה',touch_start:'נגיעה במסך',drag:'גרירה',drag_start:'תחילת גלילה',drag_end:'סיום גרירה',momentum_end:'סיום גלילה',main_tab:'בחירת טאב',club_tab:'בחירת לשונית במועדון',round_tab:'בחירת לשונית במחזור',open_round:'פתיחת מחזור',open_club:'פתיחת מועדון',round_primary:'פעולה בכרטיס המחזור',menu_item:'בחירת פריט בתפריט',menu_toggle:'שינוי מתג',control:'לחיצה על רכיב',button:'לחיצה על כפתור',viewport:'מידות המסך',long_press:'לחיצה ארוכה'};
export const kindLabels:Record<string,string>={launch:'פתיחה',nav:'מעבר מסך',tap:'מגע',press:'לחיצה',act:'פעולה',scroll:'גלילה',gesture:'מחווה',err:'שגיאה'};
export function stepLabel(step:Step):string{return names[step.name]??kindLabels[step.kind]??'פעולה';}
export function stepTime(ms:number):string {const seconds=Math.floor(ms/1000);return `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}.${String(Math.floor(ms%1000)).padStart(3,'0')}`;}
export function copyJournal(j:Journal):string {
 let last=0;
 return [JSON.stringify({context:j.context,operations:j.operations}),`הפעלה: ${j.sessionId} | פעולות: ${j.total} | הושמטו: ${j.omitted}`,...j.entries.flatMap(e=>{
  const gap=e.seq>last+1?[`[חסרות ${e.seq-last-1} פעולות]`]:[];last=e.seq;
  return [...gap,`${e.seq}. ${stepTime(e.ms)} | ${stepLabel(e)} | ${e.screen??''} | ${e.name} | ${JSON.stringify(e.data??{})}`];
 })].join('\n');
}
