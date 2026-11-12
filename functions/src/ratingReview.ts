import { createHash } from 'crypto';
import { getFirestore, FieldValue, type Firestore, type Transaction } from 'firebase-admin/firestore';
import { onCall, onDocumentUpdated, HttpsError } from './observedFunctions';
import { ENFORCE_APP_CHECK } from './appCheckPolicy';
import { cleanAdminRatings, legacyClubRatingsCompat } from './clubAdminRatings';
import { didEveningHappen } from './eveningPlayed';
import { reviewPlayer,RATING_REVIEW_VERSION,type ReviewNight,type RatingSnapshot,type ReviewMatch,type RatingReviewResponse } from './ratingReviewCore';
import { reviewStateRef,recordRatingDecision,type ReviewState } from './ratingReviewStore';
const identifier=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&value.length<=128&&!/[./]/.test(value);
function gate(request:any){
  if(!request.auth?.uid||request.auth.token?.firebase?.sign_in_provider==='anonymous')throw new HttpsError('unauthenticated','Login required');
  if(!identifier(request.data?.groupId))throw new HttpsError('invalid-argument','Invalid club');
}
async function readReview(db:Firestore,tx:Transaction,gid:string,uid:string,now:number){
  const clubRef=db.doc(`groups/${gid}`), ratingsRef=clubRef.collection('private').doc('adminRatings');
  const [clubSnap,ratingsSnap,stateSnap]=await Promise.all([tx.get(clubRef),tx.get(ratingsRef),tx.get(reviewStateRef(db,gid))]);
  const club=clubSnap.data();
  if(!club||!(club.adminIds??[]).includes(uid))throw new HttpsError('permission-denied','Club admin required');
  const state:ReviewState=stateSnap.data()??{},legacy=legacyClubRatingsCompat();
  const ratings=cleanAdminRatings(legacy?club.adminRatings:ratingsSnap.exists?ratingsSnap.get('ratings'):club.adminRatings);
  const ids=[...new Set<string>([...(club.adminIds??[]),...(club.playerIds??[])])];
  const games=await tx.get(db.collection('games').where('groupId','==',gid).orderBy('startsAt','desc').limit(201));
  const cutoff=now-120*86400000;
  if(games.size===201&&games.docs[200].get('startsAt')>=cutoff)throw new HttpsError('resource-exhausted','rating-history-truncated');
  const selected=games.docs.filter(d=>d.get('startsAt')>=cutoff&&d.get('startsAt')<now&&didEveningHappen(d.data() as any));
  const nights:ReviewNight[]=[];
  // Bounded waves avoid hundreds of concurrent reads. Every read belongs to the transaction.
  for(let offset=0;offset<selected.length;offset+=4){
    const wave=await Promise.all(selected.slice(offset,offset+4).map(async g=>{
      const snap=await tx.get(clubRef.collection('private').doc(`rating_${g.id}`));
      const history=await tx.get(g.ref.collection('roundHistory').limit(501));
      if(history.size>500)throw new HttpsError('resource-exhausted','rating-matches-truncated');
      const standings=await tx.get(db.collection('eveningStandings').where('gameId','==',g.id).limit(201));
      if(standings&&standings.size>200)throw new HttpsError('resource-exhausted','rating-scores-truncated');
      const scores=Object.fromEntries((standings?.docs??[]).map(d=>[d.get('userId'),d.get('score')]));
      return {id:g.id,at:g.get('seasonStartedAt')??g.get('startsAt'),snapshot:snap.exists?snap.data() as RatingSnapshot:null,
        matches:history.docs.map(d=>({...d.data(),roundId:d.id}) as ReviewMatch),scores,
        complete:typeof g.get('committedRoundCount')==='number'&&history.size===g.get('committedRoundCount')};
    }));nights.push(...wave);
  }
  const rows=ids.map(id=>reviewPlayer(id,ratings[id]??null,state.revisions?.[id]??0,state.since?.[id]??0,nights,now));
  if(!club.internalRating)rows.forEach(row=>{row.status='disabled';row.proposed=null;});
  const response:RatingReviewResponse={version:RATING_REVIEW_VERSION,generatedAt:now,scanned:selected.length,rows};
  // The digest includes the exact evidence. It changes after corrections, decisions or new games.
  const basis=createHash('sha256').update(JSON.stringify({version:RATING_REVIEW_VERSION,rows})).digest('hex');
  return {response:{...response,basis},clubRef,ratingsRef,ratings,state,legacy};
}
export const getRatingReview=onCall({enforceAppCheck:ENFORCE_APP_CHECK,timeoutSeconds:120},async request=>{
  gate(request);const db=getFirestore();
  return db.runTransaction(async tx=>(await readReview(db,tx,request.data.groupId,request.auth!.uid,Date.now())).response,{readOnly:true});
});
export const decideRatingReview=onCall({enforceAppCheck:ENFORCE_APP_CHECK,timeoutSeconds:120},async request=>{
  gate(request);const {groupId,playerId,basis,action,requestId}=request.data??{};
  if(!identifier(playerId)||!identifier(requestId)||typeof basis!=='string'||!['accept','keep'].includes(action))throw new HttpsError('invalid-argument','Invalid decision');
  const db=getFirestore(),uid=request.auth!.uid;
  return db.runTransaction(async tx=>{
    const receipt=reviewStateRef(db,groupId).collection('requests').doc(requestId),previous=await tx.get(receipt);
    // Authorization still checked on duplicate delivery.
    const club=await tx.get(db.doc(`groups/${groupId}`));
    if(!(club.get('adminIds')??[]).includes(uid))throw new HttpsError('permission-denied','Club admin required');
    if(previous.exists){if(previous.get('by')!==uid||previous.get('basis')!==basis||previous.get('playerId')!==playerId||previous.get('action')!==action)throw new HttpsError('already-exists','Request reused');return {ok:true};}
    const now=Date.now(),value=await readReview(db,tx,groupId,uid,now),row=value.response.rows.find(r=>r.userId===playerId);
    if(value.response.basis!==basis||!row||!['up','down'].includes(row.status)||row.proposed===null)throw new HttpsError('failed-precondition','rating-review-stale');
    const next=action==='accept'?row.proposed:row.rating!;
    recordRatingDecision(db,tx,groupId,value.state,playerId,row.rating,next,uid,now,action);
    if(action==='accept'){
      const ratings={...value.ratings,[playerId]:next};
      if(value.legacy)tx.update(value.clubRef,{adminRatings:ratings,updatedAt:now});
      else {tx.set(value.ratingsRef,{ratings,updatedAt:now});tx.update(value.clubRef,{adminRatings:FieldValue.delete(),updatedAt:now});}
    }
    tx.create(receipt,{by:uid,basis,playerId,action,at:now});
    return {ok:true};
  });
});
/** Older clients may write the compatibility map directly. Observe those changes
 * without trusting delivery order or allowing a delayed trigger to move time backwards. */
export const onRatingReviewLegacyChange=onDocumentUpdated('groups/{groupId}',async event=>{
  if(!legacyClubRatingsCompat()||!event.data)return;
  const before=cleanAdminRatings(event.data.before.get('adminRatings')),after=cleanAdminRatings(event.data.after.get('adminRatings'));
  const changed=[...new Set([...Object.keys(before),...Object.keys(after)])].filter(id=>before[id]!==after[id]);
  if(!changed.length)return;
  const db=getFirestore(),gid=event.params.groupId,at=event.data.after.updateTime.toMillis();
  await db.runTransaction(async tx=>{
    const [club,saved]=await Promise.all([tx.get(db.doc(`groups/${gid}`)),tx.get(reviewStateRef(db,gid))]);
    if(!club.exists)return;
    const current=cleanAdminRatings(club.get('adminRatings')),state:ReviewState=saved.data()??{};
    for(const id of changed){
      if(current[id]!==after[id]||(state.since?.[id]??0)>=at)continue;
      recordRatingDecision(db,tx,gid,state,id,before[id]??null,after[id]??null,'legacy-client',at,'legacy-observed');
      state.revisions={...state.revisions,[id]:(state.revisions?.[id]??0)+1};state.since={...state.since,[id]:at};
    }
  });
});
