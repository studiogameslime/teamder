// Centralised lifecycle predicates for a Game/evening.
//
// Goal: every screen, service, and rule consults the SAME definition of
// "is this game joinable?" / "is this game read-only?" so the UI never
// drifts from the server. Treat this file as the contract.
//
// Backward-compat: legacy games may have status='open' with
// liveMatch.phase='live' (Stage 1 used `phase='live'` as a stand-in for
// "active"). Helpers here normalize that — `isActive(g)` returns true
// for both. New writes should always set `status='active'` explicitly.
//
// Permission inputs (admin, organizer) are accepted as opaque flags so
// this module stays free of store/service coupling. Callers compute
// the flags from their own context.

import type { Game, LiveMatchPhase } from '@/types';

interface ActorFlags {
  /** true if the user is the game's `createdBy` OR an admin of the parent group. */
  isOrganizerOrAdmin: boolean;
}

// ─── Status normalization (backward-compat) ─────────────────────────────

/**
 * Read the effective lifecycle status of a game, collapsing legacy
 * patterns into the Stage-2 enum:
 *   • `liveMatch.phase === 'live'` with status='open' → treat as 'active'
 *     (legacy data written before Stage 2 had no 'active' status).
 * Cancellations recorded as the legacy `status='finished'` cannot be
 * disambiguated from real completions on read; both stay 'finished'.
 */
export function effectiveStatus(game: Game): Game['status'] {
  if (game.status === 'open' && game.liveMatch?.phase === 'live') {
    return 'active';
  }
  return game.status;
}

const ROUND_RUNNING_PHASES: ReadonlySet<LiveMatchPhase> = new Set([
  'live',
  'roundRunning',
]);

export function isRoundRunning(game: Game): boolean {
  const phase = game.liveMatch?.phase;
  return !!phase && ROUND_RUNNING_PHASES.has(phase);
}

// ─── Status predicates ──────────────────────────────────────────────────

export function isScheduled(game: Game): boolean {
  return effectiveStatus(game) === 'scheduled';
}
export function isOpen(game: Game): boolean {
  return effectiveStatus(game) === 'open';
}
export function isLocked(game: Game): boolean {
  return effectiveStatus(game) === 'locked';
}
export function isActive(game: Game): boolean {
  return effectiveStatus(game) === 'active';
}
export function isFinished(game: Game): boolean {
  return effectiveStatus(game) === 'finished';
}
export function isCancelled(game: Game): boolean {
  return effectiveStatus(game) === 'cancelled';
}

/** Combined "the game is over and read-only" check. */
export function isTerminal(game: Game): boolean {
  const s = effectiveStatus(game);
  return s === 'finished' || s === 'cancelled';
}
/**
 * Spec-named alias of {@link isTerminal}. Both export point at the
 * same predicate so callers can use the name that reads best in
 * context — `isTerminalGame(game)` at a screen, `isTerminal(game)`
 * inside the helper module itself.
 */
export const isTerminalGame = isTerminal;

/** True iff the kickoff time has already passed. */
export function hasStarted(game: Game): boolean {
  return !!game.startsAt && game.startsAt <= Date.now();
}

// ─── Time-based grace windows ───────────────────────────────────────────
//
// Two cutoffs measured from `startsAt`. Both are intentionally generous —
// the goal is to keep late joiners and late starters working naturally
// without dragging zombie games around forever.
//
//   • LATE_REG_GRACE_MS: 1h after kickoff registration auto-locks. Joining
//     before that is fine ("show up at the field, hit join from the
//     car"). After that the doors are closed even if no admin pressed
//     anything.
//
//   • STALE_AFTER_MS: 6h after kickoff a non-terminal game is treated as
//     abandoned. The CTA to start the evening is hidden and the game is
//     filtered out of active lists (server-side cleanup, see the
//     cleanupStaleGames Cloud Function, transitions it to 'finished' or
//     deletes zombies for real shortly afterwards).
//
//   • START_EVENING_LEAD_MS: the "סיים ערב" / "התחל ערב" CTA only
//     surfaces in this window before kickoff. Pressing it earlier
//     never made sense — the screen would launch into the live flow
//     hours before the actual game.
const LATE_REG_GRACE_MS = 60 * 60 * 1000;
const STALE_AFTER_MS = 6 * 60 * 60 * 1000;
const START_EVENING_LEAD_MS = 30 * 60 * 1000;

/**
 * True iff `startsAt + 6h` is in the past. Used by callers to hide
 * stale games from active surfaces and disable resurrection CTAs even
 * before the server-side cleanup runs.
 */
export function isStaleAfterStart(game: Game): boolean {
  if (!game.startsAt) return false;
  return Date.now() > game.startsAt + STALE_AFTER_MS;
}

/** True iff the late-registration grace window has expired. */
export function isPastLateRegistrationCutoff(game: Game): boolean {
  if (!game.startsAt) return false;
  return Date.now() > game.startsAt + LATE_REG_GRACE_MS;
}

// ─── Action predicates (the canN* set) ──────────────────────────────────

/**
 * A user (member, non-member, doesn't matter) can register iff:
 *   • the game is in the 'open' lifecycle state, AND
 *   • registration window hasn't closed (kickoff in the future), AND
 *   • the live phase isn't running (defensive — covers legacy 'live').
 * Capacity is NOT considered — a full game still allows joining the
 * waitlist; the UI label changes but the action stays available.
 */
export function canJoinGame(game: Game): boolean {
  if (!isOpen(game)) return false;
  // Late joiners are welcome up to the 1h grace window. Past that,
  // registration is hard-locked even if the admin never pressed lock.
  if (isPastLateRegistrationCutoff(game)) return false;
  if (isRoundRunning(game)) return false;
  return true;
}

/**
 * Cancel-self is allowed only during the registration window (open
 * or locked). Once the evening transitions to 'active' the roster is
 * frozen — teams have been formed, players have been counted, and a
 * late cancellation would corrupt the live flow. A "לא מגיע" no-show
 * marker is the future replacement for that edge case (see arrivals
 * service); cancellation itself is no longer the right tool here.
 */
export function canCancelRegistration(game: Game): boolean {
  return isOpen(game) || isLocked(game);
}

export function canEditGame(game: Game, actor: ActorFlags): boolean {
  if (!actor.isOrganizerOrAdmin) return false;
  if (isTerminal(game)) return false;
  if (isActive(game)) return false; // mid-evening: edit-by-mistake risk
  // Once kickoff time has passed, the game is "live in the world"
  // even if the status hasn't auto-flipped yet — editing things like
  // start time / format / location after that point is more
  // confusing than helpful. Locks the affordance regardless of
  // whether the auto-flip CF has caught up.
  if (hasStarted(game)) return false;
  return true;
}

export function canAddGuest(game: Game, actor: ActorFlags): boolean {
  if (!actor.isOrganizerOrAdmin) return false;
  if (!isOpen(game) && !isLocked(game)) return false;
  return true;
}

export function canRemoveGuest(game: Game, actor: ActorFlags): boolean {
  if (!actor.isOrganizerOrAdmin) return false;
  if (isTerminal(game)) return false;
  return true;
}

/** Lock registration → admin freezes the roster before forming teams. */
export function canLockRegistration(
  game: Game,
  actor: ActorFlags,
): boolean {
  if (!actor.isOrganizerOrAdmin) return false;
  return isOpen(game);
}

/** Start the evening → flip to 'active' + push live screen. */
export function canStartEvening(
  game: Game,
  actor: ActorFlags,
): boolean {
  if (!actor.isOrganizerOrAdmin) return false;
  if (!isOpen(game) && !isLocked(game)) return false;
  // Lower bound: don't expose the CTA until 30 minutes before
  // kickoff. Earlier than that, "start the evening" is meaningless —
  // there's no evening yet. The admin still sees registration tools
  // (lock/unlock, add guest), they just can't go live.
  if (
    game.startsAt &&
    Date.now() < game.startsAt - START_EVENING_LEAD_MS
  ) {
    return false;
  }
  // Upper bound: beyond the 6h staleness window we treat the evening
  // as abandoned — the CTA disappears so a misclick can't resurrect a
  // game from yesterday. Server-side cleanup is about to flip it to
  // 'finished' (or delete it if zombie) anyway.
  if (isStaleAfterStart(game)) return false;
  return true;
}

/** Re-enter an already-started evening (admin or participant). */
export function canEnterLive(game: Game): boolean {
  return isActive(game);
}

/** Wrap up the evening → flip to 'finished' + lock everything. */
export function canEndEvening(
  game: Game,
  actor: ActorFlags,
): boolean {
  if (!actor.isOrganizerOrAdmin) return false;
  return isActive(game);
}

/** Admin destructive cancel. Allowed up until the evening is finished. */
export function canCancelGame(
  game: Game,
  actor: ActorFlags,
): boolean {
  if (!actor.isOrganizerOrAdmin) return false;
  return !isTerminal(game);
}

/** Admin permanent delete (hard remove). Same gate as cancel for now. */
export function canDeleteGame(
  game: Game,
  actor: ActorFlags,
): boolean {
  return canCancelGame(game, actor);
}

// ─── Visibility predicates (list filtering) ─────────────────────────────

/** Future + active games the user is involved in. Excludes terminal. */
export function isVisibleInMyGames(game: Game): boolean {
  return !isTerminal(game);
}

/** Discovery list — only currently-joinable games. */
export function isVisibleInOpenGames(game: Game): boolean {
  return isOpen(game) && !hasStarted(game);
}

/** History tab — only ended games (finished or cancelled). */
export function isVisibleInHistory(game: Game): boolean {
  return isTerminal(game);
}
