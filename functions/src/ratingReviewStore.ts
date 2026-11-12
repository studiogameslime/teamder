import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { RATING_REVIEW_VERSION, validRating, type RatingRole, type RatingSnapshot } from './ratingReviewCore';
export type ReviewState = { revisions?: Record<string,number>; since?: Record<string,number> };
export const reviewStateRef=(db:Firestore,gid:string)=>db.doc(`groups/${gid}/private/ratingReview`);
/** Caller must read this document before any writes in its transaction. */
export function recordRatingDecision(db:Firestore,tx:Transaction,gid:string,state:ReviewState,uid:string,previous:number|null,next:number|null,actor:string,now:number,action:string) {
  const revision=(state.revisions?.[uid]??0)+1;
  tx.set(reviewStateRef(db,gid),{revisions:{...state.revisions,[uid]:revision},since:{...state.since,[uid]:now}});
  tx.create(reviewStateRef(db,gid).collection('events').doc(),{userId:uid,previous,next,by:actor,at:now,revision,action});
}
/** All reads first; return a write closure for the caller's atomic start. No historical backfill. */
export async function prepareRatingSnapshot(db:Firestore,tx:Transaction,game:Record<string,any>,gameId:string,club:Record<string,any>,now:number,ratings:Record<string,number>) {
  if(!game.groupId||!club.internalRating||game.status==='active'||typeof game.seasonStartedAt==='number')return ()=>{};
  const ref=db.doc(`groups/${game.groupId}/private/rating_${gameId}`);
  const [existing,state]=await Promise.all([tx.get(ref),tx.get(reviewStateRef(db,game.groupId))]);
  if(existing.exists)return ()=>{};
  const ids=[...new Set<string>((game.players??[]).filter((id:unknown)=>typeof id==='string'&&id&&!id.includes('/')))];
  if(ids.length>200)throw Error('rating-snapshot-roster-too-large');
  const users=await Promise.all(ids.map(id=>tx.get(db.doc(`users/${id}`))));
  const frozen:Record<string,number>={},roles:Record<string,RatingRole>={};
  ids.forEach((id,i)=>{if(validRating(ratings[id]))frozen[id]=ratings[id];const role=users[i].get('position');if(['gk','def','mid','att'].includes(role))roles[id]=role;});
  for(const guest of game.guests??[])if(typeof guest.id==='string'&&validRating(guest.estimatedRating))frozen[`guest:${guest.id}`]=guest.estimatedRating;
  const data:RatingSnapshot={version:RATING_REVIEW_VERSION,at:now,ratings:frozen,roles,revisions:state.data()?.revisions??{}};
  return ()=>tx.create(ref,data);
}
