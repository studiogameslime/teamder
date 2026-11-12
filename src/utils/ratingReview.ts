/** Pure review model. Mirrored to functions/src/ratingReviewCore.ts by the parity test. */
export const RATING_REVIEW_VERSION = 'combined-review-v1';
export type RatingRole = 'gk' | 'def' | 'mid' | 'att';
export type RatingSnapshot = { version: string; at: number; ratings: Record<string, number>; roles: Record<string, RatingRole>; revisions: Record<string, number> };
export type ReviewMatch = { roundId: string; teamA: string[]; teamB: string[]; winnerSide: 'A' | 'B' | 'tie'; penalties?: unknown[] };
export type ReviewNight = { id: string; at: number; snapshot: RatingSnapshot | null; matches: ReviewMatch[]; scores: Record<string, number>; complete: boolean };
export type RatingReviewStatus = 'collecting' | 'missing' | 'watch' | 'conflict' | 'up' | 'down' | 'unrated' | 'disabled';
export type RatingReview = {
  userId: string; rating: number | null; proposed: number | null; status: RatingReviewStatus;
  revision: number; since: number; appearances: number; eligible: number; minimum: number;
  teamDelta: number | null; personalDelta: number | null; actual: number | null; expected: number | null;
  reasons: string[]; evidence: { gameId: string; at: number; played: number; used: number; peers: number; team: number; personal: number }[];
  points: {gameId:string;at:number;score:number}[];
};
export type RatingReviewResponse = { version: string; generatedAt: number; rows: RatingReview[]; scanned: number };
export const validRating = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= 5;
const score = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 10;
const mean = (a: number[]) => a.reduce((s,n)=>s+n,0)/a.length;
const median = (a: number[]) => { const v=[...a].sort((x,y)=>x-y); return (v[Math.floor((v.length-1)/2)]+v[Math.floor(v.length/2)])/2; };
const expected = (d: number,k=1) => 1/(1+Math.exp(-k*d));
function validMatch(m: ReviewMatch) {
  return Array.isArray(m.teamA)&&Array.isArray(m.teamB)&&m.teamA.length>=3&&m.teamA.length===m.teamB.length&&
    [...m.teamA,...m.teamB].every(id=>typeof id==='string'&&id.length>0)&&
    new Set([...m.teamA,...m.teamB]).size===m.teamA.length+m.teamB.length&&['A','B','tie'].includes(m.winnerSide);
}
export function reviewPlayer(userId: string, rating: number | null, revision: number, since: number, nights: ReviewNight[], now: number): RatingReview {
  const result: RatingReview = {userId,rating,proposed:null,status:validRating(rating)?'collecting':'unrated',revision,since,
    appearances:0,eligible:0,minimum:6,teamDelta:null,personalDelta:null,actual:null,expected:null,reasons:[],evidence:[],
    points:[...new Map(nights.filter(n=>n.at<now&&n.at>=now-120*86400000&&score(n.scores[userId])).map(n=>[n.id,n])).values()].sort((a,b)=>a.at-b.at||a.id.localeCompare(b.id)).slice(-5).map(n=>({gameId:n.id,at:n.at,score:n.scores[userId]}))};
  if(!validRating(rating))return result;
  const selected=[...new Map(nights.filter(n=>n.at<now&&n.at>=now-120*86400000&&n.at>since).map(n=>[n.id,n])).values()]
    .filter(n=>n.matches.some(m=>m.teamA?.includes(userId)||m.teamB?.includes(userId)))
    .sort((a,b)=>b.at-a.at||a.id.localeCompare(b.id)).slice(0,10);
  result.appearances=selected.length;
  const details: {team:number;personal:number;low:number;high:number;actual:number;expected:number;partners:Set<string>}[]=[];
  const reasons=new Set<string>();
  for(const n of selected){
    const s=n.snapshot;
    if(!s||s.version!==RATING_REVIEW_VERSION||!Number.isFinite(s.at)||s.at>n.at||s.at<=since||s.ratings[userId]!==rating||(s.revisions[userId]??0)!==revision){reasons.add('historical-rating');continue;}
    if(!n.complete){reasons.add('incomplete-history');continue;}
    const played=n.matches.filter(m=>m.teamA?.includes(userId)||m.teamB?.includes(userId));
    const usable=played.filter(m=>validMatch(m)&&!m.penalties?.length&&[...m.teamA,...m.teamB].every(id=>validRating(s.ratings[id])));
    if(new Set(played.map(m=>m.roundId)).size!==played.length||usable.length<3||usable.length/played.length<.8){reasons.add('match-coverage');continue;}
    const role=s.roles[userId];
    if(!role){reasons.add('role');continue;}
    const participants=new Set(n.matches.flatMap(m=>[...(m.teamA??[]),...(m.teamB??[])]));
    const peers=Object.keys(n.scores).filter(id=>id!==userId&&participants.has(id)&&s.roles[id]===role&&validRating(s.ratings[id])&&Math.abs(s.ratings[id]-rating)<=.3+1e-9&&score(n.scores[id]));
    if(peers.length<3||!score(n.scores[userId])){reasons.add('personal-comparison');continue;}
    const rows=usable.map(m=>{
      const side=m.teamA.includes(userId)?'A':'B',own=side==='A'?m.teamA:m.teamB,other=side==='A'?m.teamB:m.teamA;
      const gap=mean(own.map(id=>s.ratings[id]))-mean(other.map(id=>s.ratings[id]));
      const y=m.winnerSide==='tie'?.5:m.winnerSide===side?1:0;
      return {y,e:expected(gap),d:y-expected(gap),low:y-expected(gap,.5),high:y-expected(gap,2),own};
    });
    const team=mean(rows.map(r=>r.d)),personal=n.scores[userId]-median(peers.map(id=>n.scores[id]));
    details.push({team,personal,low:mean(rows.map(r=>r.low)),high:mean(rows.map(r=>r.high)),actual:mean(rows.map(r=>r.y)),expected:mean(rows.map(r=>r.e)),partners:new Set(rows.flatMap(r=>r.own.filter(id=>id!==userId)))});
    result.evidence.push({gameId:n.id,at:n.at,played:played.length,used:usable.length,peers:peers.length,team,personal});
  }
  result.eligible=details.length;result.reasons=[...reasons];
  if(details.length){result.teamDelta=mean(details.map(d=>d.team));result.personalDelta=mean(details.map(d=>d.personal));result.actual=mean(details.map(d=>d.actual));result.expected=mean(details.map(d=>d.expected));}
  if(details.length<6||details.length/selected.length<.8){if(selected.length>=6)result.status='missing';if(details.length>=6)result.reasons.push('appearance-coverage');return result;}
  const team=result.teamDelta!,personal=result.personalDelta!;
  const direction=team>=.10&&personal>=.75?1:team<=-.10&&personal<=-.75?-1:0;
  result.status=team*personal<0&&Math.abs(team)>=.10&&Math.abs(personal)>=.75?'conflict':'watch';
  if(!direction)return result;
  const supported=details.filter(d=>d.team*direction>0&&d.personal*direction>0).length/details.length>=.6;
  // Sensitivity to the uncalibrated expectation slope must not reverse the decision.
  const robust=[mean(details.map(d=>d.low)),mean(details.map(d=>d.high))].every(d=>d*direction>=.10);
  const withoutOne=details.every((_,i)=>mean(details.filter((__,j)=>i!==j).map(d=>d.team))*direction>=.10&&mean(details.filter((__,j)=>i!==j).map(d=>d.personal))*direction>=.75);
  const partnerCounts=new Map<string,number>();details.forEach(d=>d.partners.forEach(id=>partnerCounts.set(id,(partnerCounts.get(id)??0)+1)));
  const common=[...partnerCounts].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))[0]?.[0];
  const independent=details.filter(d=>!d.partners.has(common));
  const distinct=new Set(details.map(d=>[...d.partners].sort().join('|'))).size>=3;
  if(!distinct||independent.length<2||mean(independent.map(d=>d.team))*direction<=0){result.reasons.push('teammates');return result;}
  if(!supported||!robust||!withoutOne){result.reasons.push('unstable');return result;}
  const proposed=Math.round((rating+.1*direction)*10)/10;
  if(proposed<.1||proposed>5){result.reasons.push('rating-limit');return result;}
  result.status=direction>0?'up':'down';result.proposed=proposed;
  return result;
}
