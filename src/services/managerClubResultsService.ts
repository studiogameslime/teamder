import { collection, getDocs, limit, query } from 'firebase/firestore';
import { docs } from '@/firebase/firestore';
import { getFirebase, USE_MOCK_DATA } from '@/firebase/config';
import { withAuthRaceRetry } from '@/firebase/authRace';
import { groupService } from './groupService';
import { clubHistory, type ClubResults } from '@/utils/managerClubInsights';
import type { Game, Group } from '@/types';

/** Strict read: permission/network failures are never interpreted as zero tied games. */
export async function loadManagerClubResults(group: Group, games: Game[], viewerId: string, now: number): Promise<ClubResults> {
  const gate=async()=>{
    if (!USE_MOCK_DATA && getFirebase().auth.currentUser?.uid !== viewerId) throw Error('manager-session-changed');
    const latest=await groupService.get(group.id);
    if (!USE_MOCK_DATA && getFirebase().auth.currentUser?.uid !== viewerId) throw Error('manager-session-changed');
    if (!latest?.adminIds.includes(viewerId)) throw Error('manager-access-revoked');
  };
  await gate();
  const recent=clubHistory(group,games,now).slice(0,10),results:ClubResults={};
  if (USE_MOCK_DATA) {
    const { mockRoundHistory } = await import('@/data/mockData');
    for(const g of recent) results[g.id]={rows:(mockRoundHistory[g.id]??[]).map(r=>({id:r.roundId,scoreA:r.scoreA,scoreB:r.scoreB})),unavailable:false,truncated:false};
    if (__DEV__ && process.env.EXPO_PUBLIC_QA_ROUTES==='1') {
      for(const [i,g] of recent.entries()) results[g.id]={rows:Array.from({length:[8,10,8,12,6,8,10,8,8,6][i]},(_,j)=>({id:`demo-${j}`,scoreA:j%4===0?1:2,scoreB:j%4===0?1:j%4===1?1:(i%2===0?1:0)})),unavailable:false,truncated:false};
    }
  } else for(let i=0;i<recent.length;i+=4) {
    await Promise.all(recent.slice(i,i+4).map(async g=>{
      try {
        const snap=await withAuthRaceRetry(()=>getDocs(query(collection(docs.game(g.id),'roundHistory'),limit(501))));
        results[g.id]={rows:snap.docs.slice(0,500).map(d=>{const r=d.data();return {id:d.id,scoreA:typeof r.scoreA==='number'?r.scoreA:NaN,scoreB:typeof r.scoreB==='number'?r.scoreB:NaN};}),unavailable:false,truncated:snap.docs.length>500};
      } catch { results[g.id]={rows:[],unavailable:true,truncated:false}; }
    }));
  }
  await gate();
  return results;
}
