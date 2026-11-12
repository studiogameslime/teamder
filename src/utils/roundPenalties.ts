import type { RoundHistoryDoc } from './eveningStats';
import { sortRounds } from './roundHistoryOrder';

export type PenaltyPhase = 'inPlay' | 'shootout';
export interface EveningPenaltyAttempt {
  key: string;
  gameNumber: number;
  phase: PenaltyPhase;
  kickerId: string | null;
  keeperId: string | null;
  outcome: 'goal' | 'save' | 'miss' | 'unknown';
  minute?: number;
}

/** Read only the saved kick log. Never infer attempts from goals or rollups. */
export function eveningPenaltyAttempts(rounds: readonly RoundHistoryDoc[]): EveningPenaltyAttempt[] {
  const attempts: EveningPenaltyAttempt[] = [];
  const seen = new Set<string>();
  sortRounds(rounds).forEach((round, index) => {
    if (seen.has(round.roundId)) return;
    seen.add(round.roundId);
    for (const [i, kick] of (round.inPlayPenalties ?? []).entries()) {
      attempts.push({ key: `${round.roundId}:inPlay:${kick.id || i}`, gameNumber: index + 1,
        phase: 'inPlay', kickerId: kick.kickerId || null, keeperId: kick.keeperId || null,
        outcome: kick.outcome, minute: kick.minute });
    }
    for (const [i, kick] of (round.penalties ?? []).entries()) {
      attempts.push({ key: `${round.roundId}:shootout:${i}`, gameNumber: index + 1,
        phase: 'shootout', kickerId: kick.kickerId || null, keeperId: kick.keeperId || null,
        outcome: kick.scored ? 'goal' : kick.outcome === 'save' ? 'save' : kick.outcome === 'miss' ? 'miss' : 'unknown' });
    }
  });
  return attempts;
}
