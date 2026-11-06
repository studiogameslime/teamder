import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { didEveningHappen, type PlayableEvening } from './eveningPlayed';
import { calibrateSharedScore, readSharedCalibration, sharedRegularIndex, SHARED_SCORE_ACTIVATION_AT,
  SHARED_SCORE_VERSION, SHARED_SCORE_STARTER, type SharedScoreCalibration, type SharedScoreInput } from './sharedEveningScore';

type Row = Record<string, any>;
const n = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? v : 0;
/** Sparse increment documents omit genuine zeroes. Full history is what makes
 * that interpretation safe for calibration, rather than guessing missing data. */
export function verifiedSharedRecords(gameId:string, stats:Row[], history:Row[], retro:Row[]) {
  const reconstructed = new Map<string,SharedScoreInput & {losses:number}>();
  if (!history.length) return [];
  for (const r of history) {
    if (!Array.isArray(r.teamA)||!Array.isArray(r.teamB)||!Array.isArray(r.goals)||
      !['A','B','tie'].includes(r.winnerSide)||![r.scoreA,r.scoreB].every(v=>Number.isSafeInteger(v)&&v>=0)) return [];
    const a=new Set<string>(r.teamA), b=new Set<string>(r.teamB);
    if (!a.size||!b.size||a.size!==r.teamA.length||b.size!==r.teamB.length||
      [...a,...b].some(id=>typeof id!=='string'||!id)||[...a].some(id=>b.has(id))) return [];
    for(const [side,ids,against] of [['A',a,r.scoreB],['B',b,r.scoreA]] as const) for(const id of ids){
      const p=reconstructed.get(id)??{gamesPlayed:0,wins:0,ties:0,losses:0,goals:0,assists:0,cleanSheets:0,shootoutScored:0,saved:0,missed:0};
      p.gamesPlayed++;if(r.winnerSide==='tie')p.ties++;else if(r.winnerSide===side)p.wins++;else p.losses++;
      if(against===0)p.cleanSheets++;
      reconstructed.set(id,p);
    }
    for(const g of r.goals){
      if(!g || (g.team!=='A'&&g.team!=='B'))return [];
      if(g.ownGoal)continue;
      const side=g.team==='A'?a:b;
      if((g.scorerId&&!side.has(g.scorerId))||(g.assisterId&&!side.has(g.assisterId)))return [];
      if(g.scorerId && reconstructed.has(g.scorerId))reconstructed.get(g.scorerId)!.goals++;
      if(g.assisterId && reconstructed.has(g.assisterId))reconstructed.get(g.assisterId)!.assists++;
    }
  }
  for(const g of retro){
    if(g.scorerId && reconstructed.has(g.scorerId))reconstructed.get(g.scorerId)!.goals++;
    if(g.assisterId && reconstructed.has(g.assisterId))reconstructed.get(g.assisterId)!.assists++;
  }
  return stats.flatMap(s=>{
    if(!['rounds','wins','losses','ties','goals','assists','cleanSheets'].every(k=>s[k]===undefined||(Number.isSafeInteger(s[k])&&s[k]>=0)))return [];
    const p=reconstructed.get(s.userId);
    if(!p || n(s.rounds)!==p.gamesPlayed || n(s.wins)!==p.wins || n(s.losses)!==p.losses ||
      n(s.ties)!==p.ties || n(s.goals)!==p.goals || n(s.assists)!==p.assists || n(s.cleanSheets)!==p.cleanSheets)return [];
    const index=sharedRegularIndex(p);
    return index===null?[]:[{gameId,userId:String(s.userId),index}];
  });
}

/** Called inside the start transaction, before any writes. The same backstop
 * handles old clients' active transition; finished historical games cannot opt in. */
export async function prepareSharedScoreCalibration(tx:Transaction,db:Firestore,game:Row,gameId:string,
  now:number, options:{starting?:boolean;allowFinished?:boolean}={}):Promise<SharedScoreCalibration|null> {
  const frozen=readSharedCalibration(game.scoreCalibration);
  if(frozen)return frozen;
  if(game.scoreCalibration)throw Error('SCORE_CALIBRATION_INVALID');
  if(game.status==='cancelled'||(game.status==='finished'&&!options.allowFinished))return null;
  const kickoff=typeof game.liveMatch?.startedAt==='number'?game.liveMatch.startedAt:game.seasonStartedAt;
  if(typeof kickoff==='number' && kickoff<SHARED_SCORE_ACTIVATION_AT)return null;
  if(now<SHARED_SCORE_ACTIVATION_AT || (!options.starting && !(typeof kickoff==='number'&&kickoff>=SHARED_SCORE_ACTIVATION_AT)))return null;
  const frozenAt=typeof kickoff==='number'?kickoff:now;
  const prior: {id:string;data:Row}[]=[];
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  for(;;){
    let q=db.collection('games').where('groupId','==',game.groupId).where('status','==','finished').orderBy('startsAt','desc').limit(100);
    if(cursor)q=q.startAfter(cursor);
    const page=await tx.get(q);
    for(const d of page.docs){const g=d.data();
      if(d.id===gameId || !(g.startsAt<game.startsAt) || !didEveningHappen(g as PlayableEvening))continue;
      const completedAt=g.endedAt??g.updatedAt;
      if(typeof completedAt!=='number'||!Number.isFinite(completedAt)||completedAt<=0||completedAt>frozenAt)continue;
      prior.push({id:d.id,data:g});if(prior.length===10)break;
    }
    if(prior.length===10||page.size<100)break;
    cursor=page.docs[page.docs.length-1];
  }
  const previousThreshold=prior.map(p=>readSharedCalibration(p.data.scoreCalibration)).find(Boolean)?.threshold??SHARED_SCORE_STARTER;
  const pools=await Promise.all(prior.map(async g=>{
    const [stats,history,retro]=await Promise.all([
      tx.get(db.collection('gamePlayerStats').where('gameId','==',g.id).limit(501)),
      tx.get(db.collection(`games/${g.id}/roundHistory`).limit(501)),
      tx.get(db.collection(`games/${g.id}/retroGoals`).limit(501)),
    ]);
    if([stats,history,retro].some(s=>s.size>500))throw Error('SCORE_CALIBRATION_TOO_LARGE');
    return verifiedSharedRecords(g.id,stats.docs.map(d=>d.data()),history.docs.map(d=>d.data()),retro.docs.map(d=>d.data()));
  }));
  return {version:SHARED_SCORE_VERSION,frozenAt,sourceGameIds:prior.map(p=>p.id),
    ...calibrateSharedScore(pools.flat(),previousThreshold)};
}

export async function freezeSharedScoreCalibration(db:Firestore,gameId:string,now:number,options:{starting?:boolean;allowFinished?:boolean}={}) {
  return db.runTransaction(async tx=>{
    const ref=db.collection('games').doc(gameId),snap=await tx.get(ref);
    if(!snap.exists)return null;
    const g=snap.data()!;
    // A stored score is a seal, including legacy deployments without a game
    // calibration field. Never stamp a new model onto an already scored night.
    if(options.allowFinished && !g.scoreCalibration){
      const sealed=await tx.get(db.collection('eveningStandings').where('gameId','==',gameId).limit(1));
      if(!sealed.empty)return null;
    }
    const basis=await prepareSharedScoreCalibration(tx,db,g,gameId,now,options);
    if(basis&&!g.scoreCalibration)tx.update(ref,{scoreCalibration:basis});
    return basis;
  });
}
