import { buildRoundSummary, type PlayerEvening, type RoundRec, type RoundSummaryInput, type SummaryEvent } from './roundSummary';

const n=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)?v:0;
/** Rebuild facts from corrected player tallies, never by adding retro goals to
 * both the history and the tallies. Retro passes join the pair calculation
 * only: they do not invent a game, result, own goal or played appearance. */
export function correctedRoundSummary(original:Record<string,any>,stats:Record<string,any>[],history:Record<string,any>[],retro:Record<string,any>[],scores:{userId:string;score:number}[],now:number) {
  const players:PlayerEvening[]=stats.map(p=>({userId:p.userId,isGuest:p.isGuest===true||String(p.userId).startsWith('guest:'),goals:n(p.goals),assists:n(p.assists),wins:n(p.wins),rounds:n(p.rounds),cleanSheets:n(p.cleanSheets)}));
  const rounds:RoundRec[]=history.map(r=>({teamAIndex:typeof r.teamAIndex==='number'?r.teamAIndex:-1,teamBIndex:typeof r.teamBIndex==='number'?r.teamBIndex:-1,winnerSide:r.winnerSide==='A'||r.winnerSide==='B'?r.winnerSide:'tie',shootout:Array.isArray(r.penalties)&&r.penalties.length>0,goals:(Array.isArray(r.goals)?r.goals:[]).map((g:any)=>({scorerId:g.scorerId??null,assisterId:g.assisterId??null,ownGoal:g.ownGoal===true,team:g.team==='B'?'B':'A'}))}));
  const stored=original.correctionBasis as RoundSummaryInput|undefined;
  const input:RoundSummaryInput=stored?{...stored,players,rounds,now,standings:stored.standings.map(s=>({...s,score:scores.find(p=>p.userId===s.userId)?.score??s.score})),career:stored.career.map(p=>{const before=stored.players.find(b=>b.userId===p.userId),after=players.find(a=>a.userId===p.userId);return {...p,goals:p.goals+n(after?.goals)-n(before?.goals),assists:p.assists+n(after?.assists)-n(before?.assists)};}),club:{...stored.club,goals:stored.club.goals+players.reduce((s,p)=>s+p.goals,0)-stored.players.reduce((s,p)=>s+p.goals,0),assists:stored.club.assists+players.reduce((s,p)=>s+p.assists,0)-stored.players.reduce((s,p)=>s+p.assists,0)}}:{gameId:original.gameId,groupId:original.groupId,at:original.at,players,rounds,now,career:[],club:{goals:0,assists:0,rounds:0,cleanSheets:0,shootoutRounds:0,evenings:0},records:null,personalBests:{},standings:[],basis:original.basis??{since:null,eveningsCompared:0}};
  const built=buildRoundSummary(input);
  const pair=buildRoundSummary({...input,rounds:[...rounds,{teamAIndex:-1,teamBIndex:-1,winnerSide:'tie',shootout:false,goals:retro.map(g=>({scorerId:g.scorerId??null,assisterId:g.assisterId??null,ownGoal:false,team:'A'}))}]}).pairHighlight;
  // Old documents have no pre-evening comparisons. Retain only events whose
  // truth cannot change with goals/assists; never compare to today's records
  // or keep a stale milestone. Future seals retain the actual original inputs.
  const independent=(e:SummaryEvent)=>'metric'in e?!['goals','assists','involvement'].includes(e.metric):e.type==='first_ever'?!['two_players_4_goals','player_3_goals_3_assists','multiple_personal_records'].includes(e.code):e.type!=='rank_tight_top';
  return {stats:built.stats,leaders:built.leaders,teamHighlights:built.teamHighlights,pairHighlight:pair,coverage:built.coverage,events:stored?built.events:(original.events??[]).filter(independent),correctedAt:now,correctionCoverage:stored?'full':'evening-facts'};
}
