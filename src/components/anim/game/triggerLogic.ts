/**
 * Pure decision logic for the game product-animations — deliberately free of
 * any React/React-Native import so it is unit-testable in a node environment
 * and stays isolated from rendering. Screens map their real state/fields onto
 * these normalized inputs; the animation components never decide *whether* to
 * play, only *how*.
 *
 * The golden rule encoded here: an animation fires on a real, server-confirmed
 * EVENT — never on an optimistic guess, a listener refresh, or an initial load.
 */

export type RegistrationStatus = 'registered' | 'waitlisted' | 'pendingApproval';

/** What caused a roster change — only a self-initiated join may celebrate. */
export type RegistrationCause =
  | 'selfRegister'
  | 'adminAdd'
  | 'promotion'
  | 'guestAdd'
  | 'listenerRefresh';

/**
 * Anim 1 — which registration animation to play once the SERVER has confirmed
 * the user's real resulting status. Returns null for anything else (e.g. a
 * failed/rolled-back request where status is undefined).
 */
export function decideRegistrationVariant(
  status: RegistrationStatus | null | undefined,
): RegistrationStatus | null {
  return status === 'registered' ||
    status === 'waitlisted' ||
    status === 'pendingApproval'
    ? status
    : null;
}

export interface LastSpotInput {
  /** The server-confirmed resulting status of the CURRENT user. */
  variant: RegistrationStatus | null;
  /** What triggered the change. Only 'selfRegister' may celebrate. */
  cause: RegistrationCause;
  /** Free spots BEFORE the action, from verified state (not stale client). */
  freeSpotsBefore: number;
  /** Whether the game is full AFTER the action, from verified state. */
  isFullAfter: boolean;
}

/**
 * Anim 3 — the "you took the last spot" celebration fires ONLY when a
 * self-registration moved the user into the roster (not waitlist) AND there was
 * exactly one free spot before AND the game is now full. Admin-add, promotion,
 * guest-add, waitlist, and listener-driven count changes never qualify.
 */
export function isLastSpotCelebration(i: LastSpotInput): boolean {
  return (
    i.variant === 'registered' &&
    i.cause === 'selfRegister' &&
    i.freeSpotsBefore === 1 &&
    i.isFullAfter === true
  );
}

/**
 * Anim 2 — a genuine waitlist→roster promotion. True only for the real
 * transition; the initial screen load (prev undefined) and any same-status
 * refresh return false, so a Firestore listener can't replay it.
 */
export function isWaitlistPromotion(
  prev: RegistrationStatus | null | undefined,
  curr: RegistrationStatus | null | undefined,
): boolean {
  return prev === 'waitlisted' && curr === 'registered';
}

export interface DraftPickInput {
  /** The pick was saved/confirmed by existing logic (not still optimistic). */
  saveConfirmed: boolean;
  /** This pick was not among those already present at initial screen load. */
  isNewSinceInitialLoad: boolean;
}

/**
 * Anim 12 — animate a draft pick only when confirmed AND new since load. In
 * read-only/spectator mode this still animates picks that ARRIVE after load,
 * but never replays the picks already on the board when the screen opened.
 */
export function shouldAnimateDraftPick(i: DraftPickInput): boolean {
  return i.saveConfirmed === true && i.isNewSinceInitialLoad === true;
}

export interface BalanceTiming {
  /** Minimum compute-phase length so an instant result never pops. */
  minComputeMs: number;
  /** Cap on the compute phase — never stall just for effect. */
  maxComputeMs: number;
  /** The shuffle must never loop while waiting on a slow server. */
  loopShuffle: false;
}

/**
 * Anim 13 — timing for the auto-balance "computing" phase. Even a local,
 * instant result shows a minimal (~300ms) compute phase; the effect never
 * exceeds ~700ms. If the server is slower, the caller switches to a STATIC
 * loader after this window rather than looping the shuffle.
 */
export function balanceTiming(): BalanceTiming {
  return { minComputeMs: 300, maxComputeMs: 700, loopShuffle: false };
}

export type TeamsRevealMode = 'shuffle' | 'gentleEntrance' | 'none';

export interface TeamsRevealInput {
  /** Did THIS user press auto-balance now (vs a scheduled server generation)? */
  userInitiated: boolean;
  /** Teams are present now that weren't a moment ago (a real new result). */
  teamsJustArrived: boolean;
}

/**
 * Anim 13 — how to reveal teams. A user-initiated balance gets the full
 * shuffle→settle; server-scheduled teams (autoTeamsAt) that simply appear get a
 * gentle entrance (the user didn't ask for a computation just now); nothing new
 * → no animation. Manual drag edits never reach here (teamsJustArrived false).
 */
export function decideTeamsReveal(i: TeamsRevealInput): TeamsRevealMode {
  if (!i.teamsJustArrived) return 'none';
  return i.userInitiated ? 'shuffle' : 'gentleEntrance';
}

/**
 * Anim 5 / 7 helper — did the tracked entity become a genuinely different one?
 * Used for "the next game changed" and "entered a new live match" so an
 * entrance plays for a new id but not for realtime updates of the same id.
 */
export function isNewEntity(
  prevId: string | null | undefined,
  currId: string | null | undefined,
): boolean {
  return !!currId && currId !== prevId;
}
