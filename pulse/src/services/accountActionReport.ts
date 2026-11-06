import { pulseFetch } from './adminTransport';
import { googleAccessToken } from './auth';
import { config } from '../config';
import { recordRead } from './readMeter';
import { usageCutoff } from './usageActivity';
import { EVENT_LABEL, type RangeKey } from './analyticsFull';
import { type ActionRow } from './actionReports';
import controlLabels from '../data/controlActions.json';
import { isProductKey } from './usageActivityCatalog';

type WireField = {stringValue?:string; integerValue?:string; referenceValue?:string};
type WireRow = {document?:{name:string;fields?:Record<string,WireField>};readTime?:string};
export interface AccountActionReport {
  rows: ActionRow[]; accounts: number; accepted: number; partial: boolean; readTime: string;
  timeQuality: { device: number; received: number; unknown: number };
}
const DAY = 86400000;
const PAGE_SIZE = 200;
export const ACCOUNT_ACTION_LIMIT = 1000;
const labels:Record<string,string> = {...EVENT_LABEL,...controlLabels};
const fieldFilter=(fieldPath:string,op:string,value:WireField)=>({fieldFilter:{field:{fieldPath},op,value}});

export function accountRange(key:RangeKey,now:number) {
  const today=usageCutoff('day',now);
  const end = key==='yesterday'?today-1:now;
  const start = key==='yesterday'?usageCutoff('day',today-1):key==='today'?today:
    key==='7d'?usageCutoff('day',today-6*DAY+12*3600000):now-30*DAY;
  return {start:Math.max(start,now-30*DAY),end};
}

/** Pinned snapshot. Return only aggregate counts; uid sets live only for this request. */
export async function readAccountActions(
  request:(body:object)=>Promise<WireRow[]>,range:RangeKey,now=Date.now(),isCurrent=()=>true,
):Promise<AccountActionReport> {
  const {start,end}=accountRange(range,now);
  const base={
    from:[{collectionId:'usageActivity'}],
    where:{compositeFilter:{op:'AND',filters:[
      fieldFilter('action','EQUAL',{stringValue:'product_action'}),
      fieldFilter('sortAt','GREATER_THAN_OR_EQUAL',{integerValue:String(start)}),
      fieldFilter('sortAt','LESS_THAN_OR_EQUAL',{integerValue:String(end)}),
    ]}},
    orderBy:[{field:{fieldPath:'sortAt'},direction:'ASCENDING'},{field:{fieldPath:'__name__'},direction:'ASCENDING'}],
  };
  // Ask for the snapshot time first; all data pages, including the first, use the identical read time.
  const anchor=await request({structuredQuery:{...base,select:{fields:[{fieldPath:'__name__'}]},limit:1}});
  const readTime=anchor.map(r=>r.readTime).filter((v):v is string=>!!v).pop();
  if(!readTime || !Number.isFinite(Date.parse(readTime)))throw Error('ACCOUNT_ACTION_SNAPSHOT_MISSING');

  const accounts=new Set<string>(),seen=new Set<string>();
  const perKey=new Map<string,{events:number;users:Set<string>}>();
  let cursor:WireField[]|undefined, partial=false, accepted=0,scanned=0;
  const timeQuality={device:0,received:0,unknown:0};
  do {
    if(!isCurrent())throw Error('ACCOUNT_ACTION_CANCELLED');
    const max=Math.min(PAGE_SIZE,ACCOUNT_ACTION_LIMIT-scanned);
    const response=await request({readTime,structuredQuery:{...base,
      select:{fields:['uid','productKey','sortAt','timeQuality'].map(fieldPath=>({fieldPath}))},
      ...(cursor?{startAt:{values:cursor,before:false}}:{}),limit:max+1}});
    if(response.some(r=>r.readTime && r.readTime!==readTime))throw Error('ACCOUNT_ACTION_SNAPSHOT_CHANGED');
    const docs=response.flatMap(r=>r.document?[r.document]:[]);
    if(docs.length>max+1)throw Error('ACCOUNT_ACTION_PAGE_OVERSIZE');
    for(const doc of docs.slice(0,max)){
      if(seen.has(doc.name))throw Error('ACCOUNT_ACTION_PAGE_REPEATED');
      seen.add(doc.name);scanned++;
      const fields=doc.fields??{},at=Number(fields.sortAt?.integerValue);
      if(!Number.isSafeInteger(at)||at<start||at>end||!doc.name)throw Error('ACCOUNT_ACTION_CURSOR_INVALID');
      cursor=[{integerValue:String(at)},{referenceValue:doc.name}];
      const id=fields.productKey?.stringValue,uid=fields.uid?.stringValue;
      if(!uid || !isProductKey(id)){partial=true;continue;}
      const row=perKey.get(id)??{events:0,users:new Set<string>()};
      row.events++;row.users.add(uid);perKey.set(id,row);accounts.add(uid);accepted++;
      if(fields.timeQuality?.stringValue==='device')timeQuality.device++;
      else if(fields.timeQuality?.stringValue==='unreliable')timeQuality.received++;
      else timeQuality.unknown++;
    }
    if(docs.length<=max)break;
    if(scanned>=ACCOUNT_ACTION_LIMIT){partial=true;break;}
  }while(cursor);
  return {accounts:accounts.size,accepted,partial,readTime,timeQuality,
    rows:[...perKey].map(([id,r])=>({id,label:labels[id]??'פעולה מתועדת ללא תווית',users:r.users.size,events:r.events}))};
}

export async function fetchAccountActions(range:RangeKey,isCurrent=()=>true) {
  const token=await googleAccessToken('https://www.googleapis.com/auth/datastore');
  const url=`https://firestore.googleapis.com/v1/projects/${config.firebase.projectId}/databases/(default)/documents:runQuery`;
  return readAccountActions(async body=>{
    const response=await pulseFetch(url,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
    if(!response.ok)throw Error('ACCOUNT_ACTION_READ_'+response.status);
    const rows:WireRow[]=await response.json();
    if(!Array.isArray(rows))throw Error('ACCOUNT_ACTION_READ_INVALID');
    recordRead('usageActivity',Math.max(1,rows.filter(row=>row.document).length));
    return rows;
  },range,Date.now(),isCurrent);
}
