import AsyncStorage from '@react-native-async-storage/async-storage';
import { diagnosticAttachment, diagnosticOwner, observeDiagnosticJournal } from './diagnosticJournal';

const JOURNAL_KEY='teamder.diagnostic.current.v1';
const PENDING_KEY='teamder.diagnostic.errors.v1';
const PREVIOUS_KEY='teamder.diagnostic.previous.v1';
let timer:ReturnType<typeof setTimeout>|undefined;
let writes=Promise.resolve();
let initialized=false;
/** Serialize writes so sign-out cleanup cannot be overtaken by an older write. */
function enqueue(work:()=>Promise<unknown>):Promise<void>{
 writes=writes.then(work,work).then(()=>{},()=>{});return writes;
}
export function startDiagnosticStorage():void {
 if(initialized)return;initialized=true;
 // Archive one preceding process locally. Never merge it into a new account.
 void enqueue(async()=>{const previous=await AsyncStorage.getItem(JOURNAL_KEY);if(previous&&previous.length<350000)await AsyncStorage.setItem(PREVIOUS_KEY,previous);});
 observeDiagnosticJournal(()=>{
  if(timer)return;
  timer=setTimeout(()=>{timer=undefined;void persistDiagnosticJournal();},2000);
 });
 void persistDiagnosticJournal();
}
export function persistDiagnosticJournal():Promise<void>{
 if(timer){clearTimeout(timer);timer=undefined;}
 const json=JSON.stringify({owner:diagnosticOwner()??null,journal:diagnosticAttachment(300000)});
 return enqueue(()=>AsyncStorage.setItem(JOURNAL_KEY,json));
}
export function savePendingDiagnosticErrors(rows:unknown[]):Promise<void>{
 // Existing error reports only, never ordinary actions. At most 3 snapshots.
 const json=JSON.stringify(rows.slice(-3));
 return enqueue(()=>AsyncStorage.setItem(PENDING_KEY,json));
}
export async function readPendingDiagnosticErrors():Promise<unknown[]> {
 await writes;
 try{const raw=await AsyncStorage.getItem(PENDING_KEY);if(!raw||raw.length>240000)return [];
  const rows:unknown=JSON.parse(raw);return Array.isArray(rows)?rows.slice(-3):[];
 }catch{return [];}
}
export function clearDiagnosticStorage():Promise<void>{
 if(timer){clearTimeout(timer);timer=undefined;}
 return enqueue(()=>AsyncStorage.multiRemove([JOURNAL_KEY,PENDING_KEY,PREVIOUS_KEY]));
}
export async function readPreviousDiagnosticJournal(viewerId:string):Promise<string|undefined>{
 await writes;
 try{const raw=await AsyncStorage.getItem(PREVIOUS_KEY);if(!raw||raw.length>350000)return;
  const saved=JSON.parse(raw);if(saved.owner!==viewerId||typeof saved.journal!=='string')return;
  const snap=JSON.parse(saved.journal);if(snap.schema!==1||!Array.isArray(snap.entries))return;
  let result=JSON.stringify(snap);
  while(result.length>30000&&snap.entries.length>2){snap.entries.splice(Math.min(50,Math.floor(snap.entries.length/4)),Math.ceil(snap.entries.length/5));snap.omitted=snap.total-snap.entries.length;result=JSON.stringify(snap);}
  return result.length<=30000?result:undefined;
 }catch{return;}
}
