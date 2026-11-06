import { observedListener, observeSettledErrors, observeCaughtError } from '../utils/errorObservation';
import { mapConcurrent } from '@/utils/mapConcurrent';

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
import { seasonReadStamp } from '@/utils/seasonReadConsistency';

export type ManagerData = { group:Group; users:User[]; games:Game[]; scores:Record<string,Record<string,number>>;
  events:CommunityPlayerEvent[]; truncated:boolean; scoresIncomplete:boolean; equipmentUnavailable:boolean };
export function managerLoadErrorMessage(error:unknown):string {
  const message=error instanceof Error?error.message:'';
  if(['manager-access-denied','manager-access-revoked'].includes(message))return 'לוח המנהל זמין למנהלי המועדון בלבד';
  if(message==='manager-session-changed')return 'החשבון המחובר השתנה. יש לפתוח את לוח המנהל מחדש.';
  return 'לא ניתן לטעון כרגע את נתוני המועדון. יש לנסות שוב.';
}
type ManagerLoadOptions = { includeScores?: boolean; isCurrent?: () => boolean };
function managerReadOwner(viewerId: string, isCurrent?: () => boolean): () => void {
  const session = USE_MOCK_DATA ? null : getFirebase().auth.currentUser;
  return () => {
    if (isCurrent?.() === false) throw new Error('manager-load-cancelled');
    if (!USE_MOCK_DATA && (getFirebase().auth.currentUser !== session || session?.uid !== viewerId)) throw new Error('manager-session-changed');
  };
}

async function readManagerScores(games: Game[], check: () => void): Promise<Pick<ManagerData, 'scores' | 'scoresIncomplete'>> {
  const scores: ManagerData['scores'] = {};
  let scoresIncomplete = false;
  await mapConcurrent(games, 4, async game => {
    check();
    try {
      const values = await getGameEveningScores(game.id);
      check();
      scores[game.id] = values;
    } catch (error) {
      check();
      observeCaughtError(error, { source: 'src/services/managerDashboardService.ts', handler: 'readManagerScores', site: 'managerDashboardService:scores' });
      scoresIncomplete = true;
    }
  });
  check();
  return { scores, scoresIncomplete };
}

/** The overview/equipment need no sealed performance scores. Opt-in callers
 * can display the authorized base first and request just their visible period. */
export async function loadManagerDashboard(groupId:string, viewerId:string, options: ManagerLoadOptions = {}):Promise<ManagerData> {
  if (!USE_MOCK_DATA && getFirebase().auth.currentUser?.uid !== viewerId) throw new Error('manager-access-denied');
  const check = managerReadOwner(viewerId, options.isCurrent);
  check();
  const group = await groupService.get(groupId);
  check();
  if (!group || !group.adminIds.includes(viewerId) || (!USE_MOCK_DATA && getFirebase().auth.currentUser?.uid !== viewerId))
    throw new Error('manager-access-denied');
  // Never query equipment or sealed scores until the canonical membership gate passed.
  const [users, rows, eventResult] = await Promise.all([
    groupService.hydrateUsers([...new Set([...memberIds(group), ...(group.ballHolderIds ?? []), ...(group.jerseysHolderIds ?? [])])]),
    USE_MOCK_DATA ? Promise.resolve(mockGamesV2.filter(g=>g.groupId===groupId).map(g=>({...g,matches:[]}) as Game)) :
      // limitToLast reverses the server order, so the groupId/startsAt ASC
      // index cannot serve it. Use the deployed club history index instead;
      // all six lifecycle states are included, including active evenings.
      withAuthRaceRetry(()=>getDocs(query(col.games(),where('groupId','==',groupId),
        where('status','in',['scheduled','open','locked','active','finished','cancelled']),
        orderBy('startsAt','desc'),limit(201))))
        .then(s=>s.docs.map(d=>({...d.data(),matches:[]}) as Game)),
    USE_MOCK_DATA ? import('./communityEventsService').then(m=>Promise.all(memberIds(group).map(id=>m.communityEventsService.getPlayerTimeline(groupId,id)))).then(v=>({status:'fulfilled' as const,value:v.flat()})) :
      Promise.allSettled([withAuthRaceRetry(()=>getDocs(query(collection(getFirebase().db,'communityPlayerEvents'),where('groupId','==',groupId),where('type','in',group.cardsEnabled?['ball','jerseys','yellow','red']:['ball','jerseys']),orderBy('at','desc'),limit(1001))))]).then(results => observeSettledErrors(results, {"source":"src/services/managerDashboardService.ts","handler":"loadManagerDashboard","site":"managerDashboardService:96038994ba"})).then(([r])=>r.status==='fulfilled' ? {status:'fulfilled' as const,value:r.value.docs.map(d=>({...d.data(),id:d.id}) as CommunityPlayerEvent)} : r),
  ]);
  check();
  if (USE_MOCK_DATA && __DEV__ && process.env.EXPO_PUBLIC_QA_ROUTES === '1') {
    const demo = (await import('@/data/managerDashboardDemo')).managerDashboardDemo(group,users);
    // The fixture is a complete local score source, including explicitly empty
    // old rounds. It must not trigger canonical season reads for synthetic IDs.
    return { ...demo, scores: Object.fromEntries(demo.games.filter(didEveningHappen).map(game => [game.id, demo.scores[game.id] ?? {}])) };
  }
  const games = rows.slice(0,200);
  const scoreGames = games.filter(didEveningHappen).sort((a,b)=>b.startsAt-a.startsAt);
  const { scores, scoresIncomplete } = options.includeScores === false
    ? { scores: {}, scoresIncomplete: scoreGames.length > 0 }
    : await readManagerScores(scoreGames, check);
  check();
  const latest = await groupService.get(groupId);
  check();
  if (!latest?.adminIds.includes(viewerId)) throw new Error('manager-access-revoked');
  return {group:latest,users,games,scores,events:eventResult.status==='fulfilled'?eventResult.value.slice(0,1000):[],
    truncated:rows.length>200 || eventResult.status==='fulfilled' && eventResult.value.length>1000,
    scoresIncomplete,equipmentUnavailable:eventResult.status!=='fulfilled'};
}

/** No globally cached history: the screen retains successful rows only within
 * one authorized base revision and asks again after refresh/account changes. */
export async function loadManagerDashboardScores(group: Group, viewerId: string, games: Game[], options: { isCurrent?: () => boolean } = {}): Promise<Pick<ManagerData, 'scores' | 'scoresIncomplete'>> {
  const check = managerReadOwner(viewerId, options.isCurrent);
  const stamp = seasonReadStamp(group.seasons);
  const gate = async () => {
    check();
    const latest = await groupService.get(group.id);
    check();
    if (!latest?.adminIds.includes(viewerId)) throw new Error('manager-access-revoked');
    if (seasonReadStamp(latest.seasons) !== stamp) throw new Error('manager-season-changed');
  };
  await gate();
  const selected = [...new Map(games.filter(game => game.groupId === group.id && didEveningHappen(game)).map(game => [game.id, game])).values()]
    .sort((a, b) => b.startsAt - a.startsAt);
  const scores = await readManagerScores(selected, check);
  await gate();
  return scores;
}

export function watchManagerAccess(groupId:string,viewerId:string,onAccess:(allowed:boolean)=>void):()=>void {
  if(USE_MOCK_DATA)return ()=>{};
  return onSnapshot(docs.group(groupId),s=>onAccess(s.exists()&&s.data().adminIds.includes(viewerId)),observedListener(()=>onAccess(false), {"source":"src/services/managerDashboardService.ts","handler":"watchManagerAccess","site":"managerDashboardService.ts:snapshot:63"}));
}
