import type { RoundHistoryDoc } from './eveningStats';
import { sortRounds } from './roundHistoryOrder';

export type PenaltyPhase = 'inPlay' | 'shootout';
export type PenaltyRole = 'kicker' | 'keeper';
export interface EveningPenaltyAttempt {
  key: string;
  gameNumber: number;
  phase: PenaltyPhase;
  kickerId: string | null;
  keeperId: string | null;
  outcome: 'goal' | 'save' | 'miss' | 'unknown';
  minute?: number;
}
export interface EveningPenaltyPlayer {
  id: string;
  attempts: EveningPenaltyAttempt[];
  successes: number;
  /** A legacy non-goal identifies the kicker's failure, but not a keeper save. */
  unknown: number;
  pct: number | null;
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

/** All recorded takers, including guests and zero-success players, remain visible. */
export function eveningPenaltyPlayers(attempts: readonly EveningPenaltyAttempt[], phase: PenaltyPhase, role: PenaltyRole): EveningPenaltyPlayer[] {
  const players = new Map<string, EveningPenaltyPlayer>();
  for (const attempt of attempts) {
    if (attempt.phase !== phase) continue;
    const id = role === 'kicker' ? attempt.kickerId : attempt.keeperId;
    if (!id) continue;
    let player = players.get(id);
    if (!player) { player = { id, attempts: [], successes: 0, unknown: 0, pct: null }; players.set(id, player); }
    player.attempts.push(attempt);
    if (attempt.outcome === (role === 'kicker' ? 'goal' : 'save')) player.successes++;
    if (role === 'keeper' && attempt.outcome === 'unknown') player.unknown++;
  }
  for (const player of players.values()) {
    player.pct = player.unknown ? null : Math.round(player.successes / player.attempts.length * 100);
  }
  return [...players.values()].sort((a, b) => b.successes - a.successes || b.attempts.length - a.attempts.length || a.id.localeCompare(b.id));
}
