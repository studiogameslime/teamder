import { FieldPath, FieldValue, getFirestore, type Firestore } from 'firebase-admin/firestore';
import { onDocumentWritten } from './observedFunctions';

// Only candidate IDs come from this server-owned collection. Each result is
// projected from the current user after checking privacy and both block lists.
const nameDirectory = 'socialSearchNamesV2';
export const directoryReadyPath = 'serverRateLimits/socialNameCoverageV2';
export const normalizeSocialSearch = (value: string) => value.normalize('NFKC')
  .replace(/[\u0591-\u05C7]/g,'').replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g,'')
  .trim().replace(/\s+/g,' ').toLocaleLowerCase();

function indexedName(user?: FirebaseFirestore.DocumentData) {
  if (!user || user.isGuest || user.socialPrivacy?.discoverable === false || typeof user.name !== 'string') return '';
  return normalizeSocialSearch(user.name.slice(0,60));
}
function bucketFor(term: string) {
  let hash=0;
  for(const c of Array.from(term).slice(-3))hash=(hash*31+c.codePointAt(0)!)&255;
  return hash.toString(16);
}
const termLimit=12;
// Each substring is stored once, in a bucket selected by the same function
// used for the query. A rare ending does not examine unrelated partitions.
function termBuckets(name: string) {
  const chars=Array.from(name), buckets=new Map<string,Set<string>>();
  for(let i=0;i<chars.length;i++) {
    let term='';
    for(let j=i;j<chars.length && j<i+termLimit;j++){
      term+=chars[j];
      if(term.trim()!==term)continue;
      const key=bucketFor(term), terms=buckets.get(key)??new Set<string>();
      terms.add(term);buckets.set(key,terms);
    }
  }
  return buckets;
}
const bucketRows=(db:Firestore,key:string)=>db.collection('socialSearchBucketsV2').doc(key).collection('matches');
// Re-read inside a transaction: an old event or overlapping backfill must
// never restore a deleted, renamed, or hidden entry.
export async function syncSocialNames(db: Firestore, ids: string[]) {
  if (!ids.length) return;
  const complete=await db.runTransaction(async tx=>{
    const snapshots=await tx.getAll(...ids.flatMap(id=>[db.collection('users').doc(id),db.collection(nameDirectory).doc(id)]));
    const changes=ids.flatMap((id,i)=>{
      const name=indexedName(snapshots[i*2].data()), old=snapshots[i*2+1].get('name')??'';
      return old===name?[]:[{id,name,prior:termBuckets(old),next:termBuckets(name)}];
    });
    const writes=changes.reduce((sum,c)=>sum+new Set([...c.prior.keys(),...c.next.keys()]).size+1,1);
    if(writes>450)return false;
    for(const {id,name,prior,next} of changes){
      for(const key of prior.keys())if(!next.has(key))tx.delete(bucketRows(db,key).doc(id));
      for(const [key,terms] of next)tx.set(bucketRows(db,key).doc(id),{terms:[...terms]});
      const ref=db.collection(nameDirectory).doc(id);
      if(name)tx.set(ref,{name});else tx.delete(ref);
    }
    if(changes.length)tx.set(db.doc(directoryReadyPath),{generation:FieldValue.increment(1)},{merge:true});
    return true;
  });
  if(!complete){
    const half=Math.ceil(ids.length/2);
    await syncSocialNames(db,ids.slice(0,half));
    await syncSocialNames(db,ids.slice(half));
  }
}
export const onSocialSearchNameWritten=onDocumentWritten({document:'users/{uid}',retry:true},async event=>{
  if(indexedName(event.data?.before.data())===indexedName(event.data?.after.data()))return;
  await syncSocialNames(getFirestore(),[event.params.uid]);
});

/** Maintenance only. Enable the write trigger before backfilling. No callable endpoint. */
export async function buildSocialDirectory(db: Firestore) {
  let cursor: string | undefined;
  for(;;){
    let q=db.collection('users').orderBy(FieldPath.documentId()).select().limit(40);
    if(cursor)q=q.startAfter(cursor);
    const page=await q.get();
    await syncSocialNames(db,page.docs.map(d=>d.id));
    if(page.size<40)break;
    cursor=page.docs[page.size-1].id;
  }
  await db.doc(directoryReadyPath).set({ready:true,generation:FieldValue.increment(1)},{merge:true});
}

// Only lookup IDs are shared. Every request still checks the current user,
// current name, visibility and both blocking directions before returning rows.
type CandidatePage={ids:string[];cursor:string|null};
const instancePages=new WeakMap<Firestore,Map<string,CandidatePage>>();
export async function indexedNamePage(db: Firestore, name:string, after:string|undefined, generation:number, limit:number){
  const pages=instancePages.get(db)??new Map<string,CandidatePage>();
  instancePages.set(db,pages);
  const key=JSON.stringify([generation,name,after,limit]);
  const cached=pages.get(key);
  if(cached)return cached;
  const term=Array.from(name).slice(0,termLimit).join('').trimEnd();
  let q=bucketRows(db,bucketFor(term)).where('terms','array-contains',term).orderBy(FieldPath.documentId()).select().limit(limit);
  if(after)q=q.startAfter(after);
  const snap=await q.get(), ids=snap.docs.map(d=>d.id);
  const page={ids,cursor:ids.length===limit?'i:'+ids[ids.length-1]:null};
  if(pages.size>=128)pages.delete(pages.keys().next().value!);
  pages.set(key,page);
  return page;
}
