import { getFirebase,USE_MOCK_DATA } from '@/firebase/config';
import { httpsCallable } from '@/services/diagnosticCallable';
import { invalidateClubAdminRatingRead } from './clubAdminRatings';
import type { RatingReview,RatingReviewResponse } from '@/utils/ratingReview';
export type ReviewResponse=RatingReviewResponse & {basis:string};
/** Callable DTO is validated too: malformed/old servers must not look like zero advice. */
export function readRatingReview(value:unknown):ReviewResponse {
  const v=value as ReviewResponse;
  if(!v||v.version!=='combined-review-v1'||typeof v.basis!=='string'||!Array.isArray(v.rows)||!Number.isFinite(v.generatedAt)||!Number.isFinite(v.scanned))throw Error('rating-review-invalid');
  const statuses=['collecting','missing','watch','conflict','up','down','unrated','disabled'];
  const nullable=(n:unknown)=>n===null||typeof n==='number'&&Number.isFinite(n);
  const ids=new Set<string>();
  for(const r of v.rows){
    if(!r||typeof r.userId!=='string'||ids.has(r.userId)||!statuses.includes(r.status)||![r.rating,r.proposed,r.teamDelta,r.personalDelta,r.actual,r.expected].every(nullable)||
      ![r.revision,r.since,r.appearances,r.eligible,r.minimum].every(n=>Number.isFinite(n)&&n>=0)||!Array.isArray(r.reasons)||!r.reasons.every(s=>typeof s==='string')||!Array.isArray(r.evidence)||
      !r.evidence.every(e=>typeof e.gameId==='string'&&[e.at,e.played,e.used,e.peers,e.team,e.personal].every(Number.isFinite))||!Array.isArray(r.points)||!r.points.every(p=>typeof p.gameId==='string'&&Number.isFinite(p.at)&&Number.isFinite(p.score)&&p.score>=0&&p.score<=10)||
      (['up','down'].includes(r.status)&&(r.rating===null||r.proposed===null||r.proposed<.1||r.proposed>5)))throw Error('rating-review-invalid');
    ids.add(r.userId);
  }
  return v;
}
export async function loadRatingReview(groupId:string):Promise<ReviewResponse>{
  if(USE_MOCK_DATA)throw Error('rating-review-demo-unavailable');
  const response=await httpsCallable<{groupId:string},unknown>(getFirebase().functions,'getRatingReview')({groupId});
  return readRatingReview(response.data);
}
export async function decideRatingReview(groupId:string,row:RatingReview,basis:string,action:'accept'|'keep',requestId:string){
  if(USE_MOCK_DATA)throw Error('rating-review-demo-unavailable');
  await httpsCallable(getFirebase().functions,'decideRatingReview')({groupId,playerId:row.userId,basis,action,requestId});
  invalidateClubAdminRatingRead(groupId);
}
