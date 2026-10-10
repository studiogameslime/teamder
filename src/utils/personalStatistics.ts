import type { ScorePoint } from './managerDashboard';
export type PersonalRound = { gameId: string; at: number; groupId?: string };
export type PersonalHighlights = { points: ScorePoint[]; recentCount: number; bestGoals: number | null; bestAssists: number | null; recordedRounds: number; incomplete: boolean; results: {wins:number;losses:number;ties:number;games:number;rounds:number}|null };
export function scoreTrend(points: ScorePoint[]): 'up' | 'down' | 'mixed' | 'stable' {
  const changes = points.slice(1).map((p,i) => p.score - points[i].score).filter(n => Math.abs(n) > 0.05);
  if (!changes.length) return 'stable';
  if (changes.every(n => n > 0)) return 'up';
  if (changes.every(n => n < 0)) return 'down';
  return 'mixed';
}
export type PersonalStatRow = {goals?:unknown;assists?:unknown;wins?:unknown;losses?:unknown;rounds?:unknown};
export function personalHighlights(rounds: PersonalRound[], scores: Record<string, number>, rows: Record<string, PersonalStatRow>, incomplete = false): PersonalHighlights {
  const ordered = [...rounds].sort((a,b) => a.at-b.at || a.gameId.localeCompare(b.gameId));
  const recent = ordered.slice(-5);
  const valid = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0;
  const max = (key: 'goals'|'assists') => { const ns=ordered.flatMap(r => valid(rows[r.gameId]?.[key]) ? [rows[r.gameId][key] as number] : []); return ns.length ? Math.max(...ns) : null; };
  const results={wins:0,losses:0,ties:0,games:0,rounds:0};
  for(const round of ordered) {
    const row=rows[round.gameId];
    if(!row)continue;
    // Result counters are sparse server increments: absent wins/losses mean
    // zero only when the participation denominator itself is recorded.
    const wins=row.wins===undefined?0:row.wins,losses=row.losses===undefined?0:row.losses,games=row.rounds;
    if(![wins,losses,games].every(n=>valid(n)&&Number.isInteger(n)))continue;
    const w=wins as number,l=losses as number,g=games as number;
    if(g<=0 || w+l>g)continue;
    results.wins+=w;results.losses+=l;results.ties+=g-w-l;results.games+=g;results.rounds++;
  }
  return {points:recent.flatMap(r => valid(scores[r.gameId]) && scores[r.gameId]<=10 ? [{gameId:r.gameId,at:r.at,score:scores[r.gameId]}] : []),recentCount:recent.length,bestGoals:incomplete?null:max('goals'),bestAssists:incomplete?null:max('assists'),recordedRounds:ordered.filter(r=>valid(rows[r.gameId]?.goals)||valid(rows[r.gameId]?.assists)).length,incomplete,results:results.rounds>0?results:null};
}
