import { observeCaughtError } from './serverErrorLog';
import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { planRetroScores, readScoreCalibration, recoverScoreCalibration, scoreNumber, type RetroScoreEntry } from './retroScorePlan';
import { correctedRoundSummary } from './retroRoundSummary';

/** All reads happen before callers write their goal marker/counters. A single
 * transaction makes a goal correction and every affected score indivisible. */
export async function prepareRetroScores(tx:Transaction,db:Firestore,gameId:string,groupId:string,game:Record<string,any>,change?:{scorerId:string;assisterId:string|null;step:1|-1}) {
  const stageRef=db.doc(`games/${gameId}/finishStages/standings`);
  const [stage,table,community]=await Promise.all([tx.get(stageRef),tx.get(db.collection('eveningStandings').where('groupId','==',groupId).limit(1001)),tx.get(db.doc(`communityStats/${groupId}`))]);
  if(table.size>1000)throw new HttpsError('failed-precondition','score-history:too-large');
  const standings=table.docs.filter(d=>d.get('gameId')===gameId);
  if(!stage.exists || !standings.length)throw new HttpsError('failed-precondition','score-summary:pending');
  if(standings.length>100)throw new HttpsError('failed-precondition','score-roster:too-large');
  const ids=standings.map(d=>String(d.get('userId')));
  const statsRefs=ids.map(id=>db.doc(`gamePlayerStats/${gameId}__${id}`));
  const cumulativeRefs=ids.map(id=>db.doc(`communityPlayerStats/${groupId}__${id}`));
  const [stats,cumulative]=await Promise.all([tx.getAll(...statsRefs),tx.getAll(...cumulativeRefs)]);
  const entries:RetroScoreEntry[]=ids.map((userId,i)=>({userId,standing:standings[i].data(),stats:stats[i].data()??{},cumulative:cumulative[i].data()??{}}));
  let calibration=readScoreCalibration(stage.get('scoreCalibration'));
  if(!calibration){
    // Current club benchmarks cannot calibrate an arbitrary historical night.
    // Accept the legacy fallback only on the last finished evening AND when
    // all its original scores reproduce exactly below.
    const games=await tx.get(db.collection('games').where('groupId','==',groupId).limit(1001));
    const latest=games.docs.filter(d=>d.get('status')==='finished').sort((a,b)=>
      scoreNumber(b.get('endedAt')??b.get('startsAt'))-scoreNumber(a.get('endedAt')??a.get('startsAt')))[0];
    if(games.size>1000 || latest?.id!==gameId)throw new HttpsError('failed-precondition','score-calibration:missing');
    const retro=await tx.get(db.collection(`games/${gameId}/retroGoals`).limit(1001));
    if(retro.size>1000)throw new HttpsError('failed-precondition','score-corrections:too-large');
    try{calibration=recoverScoreCalibration(entries,community.data()??{},retro.docs.map(d=>d.data()),scoreNumber(stage.get('at')));}
    catch (caughtError269b48c885){
    observeCaughtError(caughtError269b48c885, {"source":"functions/src/retroScores.ts","handler":"prepareRetroScores","site":"retroScores:269b48c885"});throw new HttpsError('failed-precondition','score-calibration:missing');}
  }
  const changedGuests=new Map<string,Record<string,any>>();
  if(change){
    const guestIds=[...new Set([change.scorerId,change.assisterId].filter((id):id is string=>!!id&&id.startsWith('guest:')))];
    if(guestIds.length){
      const guestRows=await tx.getAll(...guestIds.map(id=>db.doc(`gamePlayerStats/${gameId}__${id}`)));
      guestIds.forEach((id,i)=>changedGuests.set(id,{gameId,userId:id,isGuest:true,...guestRows[i].data()}));
    }
    for(const [id,field] of [[change.scorerId,'goals'],[change.assisterId,'assists']] as const){
      if(!id)continue;
      const entry=entries.find(e=>e.userId===id),guest=changedGuests.get(id);
      if(!entry&&!guest)throw new HttpsError('failed-precondition','score-player:missing');
      const stats={...(entry?.stats??guest),[field]:scoreNumber((entry?.stats??guest)?.[field])+change.step};
      if(stats[field]<0)throw new HttpsError('failed-precondition','score-correction:negative');
      if(entry)entry.stats=stats;else changedGuests.set(id,stats);
    }
  }
  const now=Date.now(),plan=planRetroScores(entries,calibration,scoreNumber(game.startsAt),now);
  const summaryRef=db.doc(`roundSummaries/${gameId}`),summary=await tx.get(summaryRef);
  if(!summary.exists&&stage.get('summaryRefreshVersion')===1){
    const club=await tx.get(db.doc(`groups/${groupId}`));
    if(club.get('isPersonal')!==true)throw new HttpsError('failed-precondition','score-summary:pending');
  }
  let summaryPatch:ReturnType<typeof correctedRoundSummary>|undefined;
  if(summary.exists){
    const [allStats,history,retro]=await Promise.all([tx.get(db.collection('gamePlayerStats').where('gameId','==',gameId).limit(1001)),tx.get(db.collection(`games/${gameId}/roundHistory`).limit(1001)),tx.get(db.collection(`games/${gameId}/retroGoals`).limit(1001))]);
    if(allStats.size>1000||history.size>1000||retro.size>1000)throw new HttpsError('failed-precondition','score-summary:too-large');
    const projected=allStats.docs.map(d=>{const p={...d.data(),userId:d.get('userId')??d.id.split('__')[1]};return {...p,...entries.find(e=>e.userId===p.userId)?.stats,...changedGuests.get(p.userId)};});
    for(const [id,stats] of changedGuests)if(!projected.some(p=>p.userId===id))projected.push({...stats,userId:id});
    const corrections=retro.docs.map(d=>d.data());
    // The caller has read the marker already. On remove, its exact fields
    // identify one occurrence; on add the new marker does not exist yet.
    if(change){if(change.step===1)corrections.push({scorerId:change.scorerId,assisterId:change.assisterId});else{const i=corrections.findIndex(r=>r.scorerId===change.scorerId&&(r.assisterId??null)===change.assisterId);if(i<0)throw new HttpsError('failed-precondition','score-correction:missing');corrections.splice(i,1);}}
    summaryPatch=correctedRoundSummary(summary.data()!,projected,history.docs.map(d=>d.data()),corrections,plan,now);
  }
  return ()=>{
    if(summaryPatch)tx.update(summaryRef,summaryPatch);
    tx.update(stageRef,{scoreCalibration:calibration,scoreRecalculatedAt:now});
    for(const [i,item] of plan.entries()){
      tx.update(standings[i].ref,item.standing);
      if(Object.keys(item.cumulative).length)tx.update(cumulativeRefs[i],item.cumulative);
      // Correct only the immediate following comparison, never its own score
      // or contribution to a different evening/season.
      const next=table.docs.filter(d=>d.get('userId')===item.userId && scoreNumber(d.get('at'))>scoreNumber(game.startsAt))
        .sort((a,b)=>scoreNumber(a.get('at'))-scoreNumber(b.get('at')))[0];
      if(next){const value=next.data();tx.update(next.ref,{scoreDelta:Math.round((scoreNumber(value.score)-item.score)*10)/10,...(value.scoreBasis?{'scoreBasis.previousScore':item.score,'scoreBasis.previousAt':game.startsAt}:{})});}
    }
  };
}
