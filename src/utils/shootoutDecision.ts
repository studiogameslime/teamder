import type { LiveMatchState } from '@/types';
import type {RoundDecisionContext} from '@/utils/roundDecision';

/** Snapshot of the decision the manager actually saw, independent of field order. */
export function shootoutFingerprint(shootout?: LiveMatchState['shootout']): string {
  return JSON.stringify(shootout ? [shootout.firstTeam, shootout.keeperA ?? null, shootout.keeperB ?? null,
    shootout.kicks.map(kick => [kick.id ?? null, kick.team, kick.kickerId ?? null, kick.keeperId ?? null,
      kick.scored, kick.outcome ?? null, kick.at ?? null])] : null);
}

export interface ShootoutDecisionContext {
  gameId: string;
  roundId: string;
  playing: string;
  fingerprint: string;
  /** Captured on returning to the tie chooser; retained across a lost ACK. */
  roundDecision?: RoundDecisionContext;
  alternativeFingerprint?: string;
}
