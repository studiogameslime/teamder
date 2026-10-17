import { eveningScoreServer, BENCHMARK_FLOOR, DEFAULT_GOALS_FOR_10, DEFAULT_ASSISTS_FOR_10 } from './eveningScoreCore';

type Row = Record<string, any>;
export interface ScoreCalibration { goalsFor10:number; assistsFor10:number; }
export interface RetroScoreEntry { userId:string; standing:Row; stats:Row; cumulative:Row; }
export const scoreNumber=(v:unknown):number=>typeof v==='number'&&Number.isFinite(v)?v:0;
const tenth=(v:number)=>Math.round(v*10)/10;
export function scoreWithCalibration(stats:Row,basis:ScoreCalibration):number {
  return eveningScoreServer(scoreNumber(stats.goals),scoreNumber(stats.assists),scoreNumber(stats.wins),scoreNumber(stats.rounds),basis.goalsFor10,basis.assistsFor10,
    {scored:scoreNumber(stats.penScored),saved:scoreNumber(stats.penSaved),missed:scoreNumber(stats.penMissed),conceded:scoreNumber(stats.penConceded)});
}
export function readScoreCalibration(value:unknown):ScoreCalibration|null {
  const v=value as Partial<ScoreCalibration>|undefined;
  return v && scoreNumber(v.goalsFor10)>0 && scoreNumber(v.assistsFor10)>0
    ? {goalsFor10:v.goalsFor10!,assistsFor10:v.assistsFor10!} : null;
}
/** Legacy fallback is accepted only when it reproduces EVERY original score.
 * Retro markers after the seal undo only the correction inputs, not games/wins. */
export function recoverScoreCalibration(entries:RetroScoreEntry[],community:Row,retro:Row[],sealedAt:number):ScoreCalibration {
  const basis={goalsFor10:Math.max(BENCHMARK_FLOOR,scoreNumber(community.kingGoalsCount)>0?scoreNumber(community.kingGoalsSum)/community.kingGoalsCount:DEFAULT_GOALS_FOR_10),
    assistsFor10:Math.max(BENCHMARK_FLOOR,scoreNumber(community.kingAssistsCount)>0?scoreNumber(community.kingAssistsSum)/community.kingAssistsCount:DEFAULT_ASSISTS_FOR_10)};
  if(!entries.length || sealedAt<=0)throw Error('SCORE_CALIBRATION_MISSING');
  for(const entry of entries){
    const late=retro.filter(r=>scoreNumber(r.at)>sealedAt);
    const original={...entry.stats,goals:scoreNumber(entry.stats.goals)-late.filter(r=>r.scorerId===entry.userId).length,
      assists:scoreNumber(entry.stats.assists)-late.filter(r=>r.assisterId===entry.userId).length};
    if(original.goals<0 || original.assists<0 || !Number.isFinite(entry.standing.score) || scoreWithCalibration(original,basis)!==entry.standing.score)throw Error('SCORE_CALIBRATION_MISSING');
  }
  return basis;
}
/** Replace this evening's contribution by its difference. Never add attendance
 * or re-credit any goal, game, win or penalty here. */
export function planRetroScores(entries:RetroScoreEntry[],calibration:ScoreCalibration,eveningAt:number,now:number) {
  const scored=entries.map(e=>({...e,score:scoreWithCalibration(e.stats,calibration)}));
  const ranked=[...scored].sort((a,b)=>b.score-a.score || a.userId.localeCompare(b.userId));
  return scored.map(e=>{
    if(!Number.isFinite(e.standing.score))throw Error('SCORE_STANDING_MISSING');
    const oldBasis=e.standing.scoreBasis as Row|undefined;
    const previousScore=oldBasis && Object.prototype.hasOwnProperty.call(oldBasis,'previousScore') ? oldBasis.previousScore
      : typeof e.standing.scoreDelta==='number' ? tenth(e.standing.score-e.standing.scoreDelta) : null;
    const counted=typeof oldBasis?.counted==='boolean'?oldBasis.counted:scoreNumber(e.stats.rounds)>0;
    const delta=tenth(e.score-e.standing.score);
    if(counted && (scoreNumber(e.cumulative.eveningScoreCount)<1 || typeof e.cumulative.eveningScoreSum!=='number'))throw Error('SCORE_AGGREGATE_MISSING');
    const cumulative:Row={};
    if(counted && delta!==0)cumulative.eveningScoreSum=tenth(e.cumulative.eveningScoreSum+delta);
    if(e.cumulative.lastEveningAt===eveningAt)cumulative.lastEveningScore=e.score;
    return {userId:e.userId,oldScore:e.standing.score,score:e.score,delta,cumulative,
      standing:{score:e.score,scoreDelta:previousScore===null?null:tenth(e.score-previousScore),scoreRank:ranked.findIndex(r=>r.userId===e.userId)+1,scoreTotal:entries.length,
        scoreBasis:{...calibration,previousScore,previousAt:oldBasis?.previousAt??null,counted},scoreCorrectedAt:now}};
  });
}
