// When a season may close, and what an admin is allowed to change while it is
// running.
//
// Pure functions, shared by the client (which greys out a button and explains
// why) and the server (which is the one that actually decides). Neither may
// have its own opinion: a rule that disagrees across the wire is a rule that
// will be argued about at the exact moment nobody can check it.
//
// The one thing to keep hold of while reading: a season NEVER ends on a
// wall-clock instant. Each mini-game is committed on its own, so a boundary
// that falls between round 3 and round 4 leaves three rounds in the old season
// and three in the new — while the player's own career total, written in the
// same batch, keeps the whole evening. The club and the player would then
// disagree permanently, and nothing would ever reconcile them.
//
// So `isSeasonDue` only answers "has this season run its course". The close
// itself happens at the seam after an evening is sealed, and `canCloseNow`
// is what guards that seam.

export type SeasonCadenceType = 'date' | 'rounds';

export interface SeasonCadence {
  type: SeasonCadenceType;
  /** `date`: when it is due to end. */
  endsAt?: number;
  /** `rounds`: the season's TOTAL finished rounds, never a remainder. */
  targetRounds?: number;
}

/** What the club looks like right now, as far as closing is concerned. */
export interface SeasonState {
  cadence: SeasonCadence;
  /** Finished rounds credited to this season. From the sealed-evening
   *  counter — a live query over games drifts, because deleting a game
   *  decrements nothing. */
  completedRounds: number;
  /**
   * An evening in this club is ACTIVE — being played right now.
   *
   * NOT "any game not yet finished". A game that is scheduled, open or locked
   * has committed no mini-game and carries no `seasonId` (the stamp is written
   * when it goes active), so it belongs to whichever season is open when
   * someone presses start. Closing over it splits nothing. Treating it as a
   * blocker deadlocked a real club: the live screen would not start the
   * evening until the season closed, and the season would not close while the
   * evening existed. 22.09.2026 — mirrors `clubIsQuiet` on the server.
   */
  hasOpenGame: boolean;
  /** A game has finished but its stats have not been sealed yet. Closing
   *  across that gap makes the evening's summary compare tonight against a
   *  table that no longer holds its own history, and every stat reads as a
   *  brand-new club record — permanently, since the summary is written once. */
  hasUnsealedGame: boolean;
}

/** Has the season reached its target? Says nothing about whether it is safe
 *  to close right now — see `canCloseNow`. */
export function isSeasonDue(state: SeasonState, now: number): boolean {
  const { cadence, completedRounds } = state;
  if (cadence.type === 'rounds') {
    const target = cadence.targetRounds ?? 0;
    return target > 0 && completedRounds >= target;
  }
  const endsAt = cadence.endsAt ?? 0;
  return endsAt > 0 && now >= endsAt;
}

export type CloseBlocker = 'openGame' | 'unsealedGame';

/** May the season close at this instant? */
export function canCloseNow(state: SeasonState): {
  ok: boolean;
  blocker?: CloseBlocker;
} {
  if (state.hasOpenGame) return { ok: false, blocker: 'openGame' };
  if (state.hasUnsealedGame) return { ok: false, blocker: 'unsealedGame' };
  return { ok: true };
}

/** Rounds still to play, or null when the season ends on a date. */
export function roundsRemaining(state: SeasonState): number | null {
  if (state.cadence.type !== 'rounds') return null;
  const target = state.cadence.targetRounds ?? 0;
  return Math.max(0, target - state.completedRounds);
}

