import { collection, getDocs, query, where } from 'firebase/firestore';
import { getFirebase } from '@/firebase/config';
import { logError } from './errorLog';
import { personalHighlights, type PersonalStatRow, type PersonalRound } from '@/utils/personalStatistics';
/** Owner-only standings and round-scoped personal stats; no permission changes. */
export async function loadPersonalHighlights(uid: string, rounds: PersonalRound[], options: {
  isCurrent?: () => boolean;
  onProgress?: (value: ReturnType<typeof personalHighlights>) => void;
} = {}) {
  const db=getFirebase().db, rows:Record<string,PersonalStatRow>={}, scores:Record<string,number>={};
  let incomplete=false;
  try {
    const snap=await getDocs(query(collection(db,'eveningStandings'),where('userId','==',uid)));
    for(const d of snap.docs) {const v=d.data();if(typeof v.gameId==='string'&&typeof v.score==='number')scores[v.gameId]=v.score;}
  } catch(error) {incomplete=true;logError('personalStats.scores',error,{userId:uid});}
  if (options.isCurrent?.() === false) return personalHighlights(rounds,scores,rows,true);
  options.onProgress?.(personalHighlights(rounds,scores,rows,true));
  // Recent rounds first: the chart and current results become useful while
  // the complete historical record is still being loaded.
  const ordered=[...rounds].sort((a,b)=>b.at-a.at || b.gameId.localeCompare(a.gameId));
  for(let i=0;i<ordered.length;i+=4) {
    if (options.isCurrent?.() === false) return personalHighlights(rounds,scores,rows,true);
    const batch=ordered.slice(i,i+4);
    const results=await Promise.allSettled(batch.map(r=>getDocs(query(collection(db,'gamePlayerStats'),where('gameId','==',r.gameId),where('userId','==',uid)))));
    results.forEach((r,j)=>{if(r.status==='fulfilled'){const row=r.value.docs[0];if(row)rows[batch[j].gameId]=row.data();}else{incomplete=true;logError('personalStats.round',r.reason,{gameId:batch[j].gameId});}});
    if (options.isCurrent?.() !== false && i+4<ordered.length) options.onProgress?.(personalHighlights(rounds,scores,rows,true));
  }
  return personalHighlights(rounds,scores,rows,incomplete);
}
