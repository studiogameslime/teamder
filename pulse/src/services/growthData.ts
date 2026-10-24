import { cached } from './cache';
import { getDoc, listAll, queryDocumentPage, queryEquals, type FsDoc } from './firestoreRest';
import { observeSettledErrors } from './errorObservation';
import { type GrowthCollection, type GrowthData, type GrowthSource } from './growthInsights';

export const GROWTH_LIMIT = 1000;
export const GROWTH_USER_LIMIT = 100;
export const GROWTH_USER_FIELDS = ['name','email','createdAt','lastSeenAt','availability.homeCity','onboardingCompleted','stats.attended','invitedBy','invitedByType','invitedByTargetId','entryAttribution','acquisition'];
const GROUP_FIELDS = ['name','createdAt','creatorId','adminIds','playerIds','pendingPlayerIds','joinedAt','isOpen','maxMembers','city','description','rules','internalRating','hideInternalRating','activeSeasonId','isPersonal','hidden'];
const GAME_FIELDS = ['title','groupId','startsAt','createdAt','createdBy','status','endedBy','playVerified','players','committedRoundCount','rotation','liveMatch.startedAt','liveMatch.phase','liveMatch.activeIntervals','liveMatch.timerEvents','liveMatch.timerAccumulatedMs','liveMatch.timerLastStartedAt','liveMatch.goals','liveMatch.scoreA','liveMatch.scoreB'];

function readSource(collection: GrowthCollection, force: boolean): Promise<GrowthSource> {
  return cached(`growth-source:${collection}`, async () => {
    if (collection === 'users') {
      const page = await queryDocumentPage('users', {orderField:'createdAt',direction:'DESCENDING',limit:GROWTH_USER_LIMIT,fields:GROWTH_USER_FIELDS});
      return {rows:page.rows,limited:!!page.next,at:Date.now()};
    }
    const rows = await listAll(collection,GROWTH_LIMIT,collection === 'groups' ? GROUP_FIELDS : GAME_FIELDS);
    return {rows,limited:rows.length === GROWTH_LIMIT,at:Date.now()};
  }, {force,ttl:180000});
}
/** The people and clubs screens share the same bounded projections and in-flight reads. */
export async function fetchGrowthData(force = false): Promise<GrowthData> {
  const names: GrowthCollection[] = ['users','groups','games'];
  const results = await Promise.allSettled(names.map(name=>readSource(name,force))).then(results=>observeSettledErrors(results,{source:'pulse/src/services/growthData.ts',handler:'fetchGrowthData',site:'growthData:sources'}));
  const data: GrowthData = {users:null,groups:null,games:null,failed:[],at:Date.now()};
  results.forEach((result,index)=>{
    if (result.status === 'fulfilled') data[names[index]] = result.value;
    else {
      data.failed.push(names[index]);
    }
  });
  return data;
}
export function fetchGrowthJourney(uid: string, force = false): Promise<FsDoc[]> {
  return cached(`growth-journey:${uid}`,()=>queryEquals('onboardingActivity','uid',uid,2000,
    ['uid','sessionId','sequence','occurredAt','createdAt','action','params']),{force,ttl:60000});
}
export function fetchGrowthPerson(uid: string, force = false) {
  return cached(`growth-person:${uid}`,()=>getDoc(`users/${uid}`,GROWTH_USER_FIELDS),{force,ttl:180000});
}
export function fetchGrowthClub(id: string, force = false) {
  return cached(`growth-club:${id}`,()=>getDoc(`groups/${id}`,GROUP_FIELDS),{force,ttl:180000});
}
