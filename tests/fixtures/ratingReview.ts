import {RATING_REVIEW_VERSION,type ReviewNight} from '../../src/utils/ratingReview';
export const reviewNow=Date.UTC(2026,10,11);
export function reviewNights(count=8,down=false):ReviewNight[]{
  return Array.from({length:count},(_,i)=>{
    const own=['a',`mate${i%3}x`,`mate${i%3}y`],other=[`op${i}x`,`op${i}y`,`op${i}z`],ids=[...own,...other];
    const at=reviewNow-(i+1)*86400000;
    return {id:`g${i}`,at,complete:true,snapshot:{version:RATING_REVIEW_VERSION,at,ratings:Object.fromEntries(ids.map(id=>[id,3.5])),roles:Object.fromEntries(ids.map(id=>[id,'mid'])),revisions:{}},
      matches:Array.from({length:3},(_,j)=>({roundId:`r${j}`,teamA:own,teamB:other,winnerSide:down?'B':'A'})),scores:Object.fromEntries(ids.map(id=>[id,id==='a'?(down?6:9):7.5]))};
  });
}
