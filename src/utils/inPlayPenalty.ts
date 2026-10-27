import type { InPlayPenalty, LiveMatchState } from '@/types';

/** One event owns both the attempt and its optional goal. No stat rollups are
 * changed until the round's idempotent server commit. Also used for editing. */
export function applyInPlayPenalty(live: LiveMatchState, id: string, penalty: InPlayPenalty | null): LiveMatchState {
  const old = (live.inPlayPenalties ?? []).find(p => p.id === id);
  const goals = (live.goals ?? []).filter(g => g.penaltyId !== id);
  const fallback: Record<string,number> = {};
  for (const g of live.goals ?? []) if (g.scorerId && !g.ownGoal) fallback[g.scorerId]=(fallback[g.scorerId] ?? 0)+1;
  const tally = { ...(live.goalTally ?? fallback) };
  let scoreA = live.scoreA, scoreB = live.scoreB;
  if (old?.outcome === 'goal') {
    if (old.team === 'A') scoreA--; else scoreB--;
    tally[old.kickerId] = Math.max(0, (tally[old.kickerId] ?? 0) - 1);
  }
  if (penalty?.outcome === 'goal') {
    if (penalty.team === 'A') scoreA++; else scoreB++;
    tally[penalty.kickerId] = (tally[penalty.kickerId] ?? 0) + 1;
    goals.push({ id: `goal_${id}`, penaltyId: id, team: penalty.team, scorerId: penalty.kickerId,
      assistStatus: 'none', minute: penalty.minute, at: penalty.at });
  }
  return { ...live, scoreA: Math.max(0, scoreA), scoreB: Math.max(0, scoreB), goals, goalTally: tally,
    inPlayPenalties: [...(live.inPlayPenalties ?? []).filter(p => p.id !== id), ...(penalty ? [penalty] : [])].sort((a,b) => a.at-b.at) };
}

export const inPlayPenaltyFingerprint = (rows: readonly InPlayPenalty[] | undefined): string => JSON.stringify(
  (rows ?? []).map(p => [p.id,p.team,p.kickerId,p.keeperId,p.outcome,p.minute,p.at,...(p.clockMs !== undefined ? [p.clockMs] : [])]));

export function formatPenaltyClock(ms: number): string {
  const seconds = Math.floor(Math.max(0, ms) / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2,'0')}:${String(seconds % 60).padStart(2,'0')}`;
}
