import type { LiveMatchState } from '@/types';
import type { RoundHistoryDoc } from '@/utils/eveningStats';

/** Read-only scoreboard for a banked result while its next lineup is pending.
 * These synthetic goal ids never go through a write path. */
export function savedRoundLive(live: LiveMatchState, history: RoundHistoryDoc): LiveMatchState {
  return {
    ...live,
    scoreA: history.scoreA,
    scoreB: history.scoreB,
    timerRunning: false,
    goals: history.goals.map((goal, index) => ({
      id: `saved:${history.roundId}:${index}`,
      scorerId: goal.scorerId ?? null,
      assisterId: goal.assisterId ?? undefined,
      ownGoal: goal.ownGoal ?? undefined,
      minute: goal.minute ?? 0,
      team: goal.team,
      at: history.at,
    })),
  };
}
