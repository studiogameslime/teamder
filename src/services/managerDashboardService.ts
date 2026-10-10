import { getDocs, query, where, orderBy, limit, collection, onSnapshot } from 'firebase/firestore';
import { col, docs } from '@/firebase/firestore';
import { getFirebase, USE_MOCK_DATA } from '@/firebase/config';
import { withAuthRaceRetry } from '@/firebase/authRace';
import { groupService } from './groupService';
import { getGameEveningScores } from './gameEveningScores';
import { mockGamesV2 } from '@/data/mockData';
import type { CommunityPlayerEvent, Game, Group, User } from '@/types';
import { memberIds } from '@/utils/managerDashboard';
import { didEveningHappen } from '@/utils/eveningPlayed';

export type ManagerData = { group:Group; users:User[]; games:Game[]; scores:Record<string,Record<string,number>>;
  events:CommunityPlayerEvent[]; truncated:boolean; scoresIncomplete:boolean; equipmentUnavailable:boolean };
export function managerLoadErrorMessage(error:unknown):string {
  const message=error instanceof Error?error.message:'';
  if(['manager-access-denied','manager-access-revoked'].includes(message))return 'לוח המנהל זמין למנהלי המועדון בלבד';
  if(message==='manager-session-changed')return 'החשבון המחובר השתנה. יש לפתוח את לוח המנהל מחדש.';
  return 'לא ניתן לטעון כרגע את נתוני המועדון. יש לנסות שוב.';
}
export async function loadManagerDashboard(groupId:string, viewerId:string):Promise<ManagerData> {
  const group = await groupService.get(groupId);
  if (!group || !group.adminIds.includes(viewerId) || (!USE_MOCK_DATA && getFirebase().auth.currentUser?.uid !== viewerId))
    throw new Error('manager-access-denied');
  // Never query equipment or sealed scores until the canonical membership gate passed.
  const [users, rows, eventResult] = await Promise.all([
    groupService.hydrateUsers(memberIds(group)),
    USE_MOCK_DATA ? Promise.resolve(mockGamesV2.filter(g=>g.groupId===groupId).map(g=>({...g,matches:[]}) as Game)) :
      // limitToLast reverses the server order, so the groupId/startsAt ASC
      // index cannot serve it. Use the deployed club history index instead;
      // all six lifecycle states are included, including active evenings.
      withAuthRaceRetry(()=>getDocs(query(col.games(),where('groupId','==',groupId),
        where('status','in',['scheduled','open','locked','active','finished','cancelled']),
        orderBy('startsAt','desc'),limit(201))))
        .then(s=>s.docs.map(d=>({...d.data(),matches:[]}) as Game)),
    USE_MOCK_DATA ? import('./communityEventsService').then(m=>Promise.all(memberIds(group).map(id=>m.communityEventsService.getPlayerTimeline(groupId,id)))).then(v=>({status:'fulfilled' as const,value:v.flat()})) :
      Promise.allSettled([withAuthRaceRetry(()=>getDocs(query(collection(getFirebase().db,'communityPlayerEvents'),where('groupId','==',groupId),where('type','in',['ball','jerseys']),orderBy('at','desc'),limit(1001))))]).then(([r])=>r.status==='fulfilled' ? {status:'fulfilled' as const,value:r.value.docs.map(d=>({...d.data(),id:d.id}) as CommunityPlayerEvent)} : r),
  ]);
  if (USE_MOCK_DATA && __DEV__ && process.env.EXPO_PUBLIC_QA_ROUTES === '1') {
    return (await import('@/data/managerDashboardDemo')).managerDashboardDemo(group,users);
  }
  const games = rows.slice(0,200);
  const scoreGames = games.filter(didEveningHappen).sort((a,b)=>b.startsAt-a.startsAt);
  const scores:ManagerData['scores'] = {};
  let scoresIncomplete=false;
  // Bound concurrent callable reads. No account-crossing global cache.
  for(let i=0;i<scoreGames.length;i+=4) {
    const batch=scoreGames.slice(i,i+4);
    const results=await Promise.allSettled(batch.map(g=>getGameEveningScores(g.id)));
    results.forEach((r,j)=>{ if(r.status==='fulfilled') scores[batch[j].id]=r.value; else scoresIncomplete=true; });
  }
  if (!USE_MOCK_DATA && getFirebase().auth.currentUser?.uid !== viewerId) throw new Error('manager-session-changed');
  const latest = await groupService.get(groupId);
  if (!USE_MOCK_DATA && getFirebase().auth.currentUser?.uid !== viewerId) throw new Error('manager-session-changed');
  if (!latest?.adminIds.includes(viewerId)) throw new Error('manager-access-revoked');
  return {group:latest,users,games,scores,events:eventResult.status==='fulfilled'?eventResult.value.slice(0,1000):[],
    truncated:rows.length>200 || eventResult.status==='fulfilled' && eventResult.value.length>1000,
    scoresIncomplete,equipmentUnavailable:eventResult.status!=='fulfilled'};
}

export function watchManagerAccess(groupId:string,viewerId:string,onAccess:(allowed:boolean)=>void):()=>void {
  if(USE_MOCK_DATA)return ()=>{};
  return onSnapshot(docs.group(groupId),s=>onAccess(s.exists()&&s.data().adminIds.includes(viewerId)),()=>onAccess(false));
}
