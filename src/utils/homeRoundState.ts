// What the home screen should say about the round — decided once, in one
// place, from the data the screen already holds.
//
// The round area answers a harder question than "what is my next game". It
// answers "what do I need to DO about it", and the answer changes with the
// game's lifecycle AND the viewer's standing in it: a full game is an
// invitation to the waitlist, a waitlist place is not a registration, and a
// game whose registration has not opened is still worth showing.
//
// That decision used to be spread across conditions inside the card's JSX,
// where it could not be tested and could not be read as a whole. It is a pure
// function here, so the ordering is a thing you can point at — and the tests
// pin every rung of it.
//
// ── Where the facts come from ──────────────────────────────────────────────
// Nothing here is invented. Every input is a field on the game document or a
// predicate from `gameLifecycle`, which is the app's existing contract for
// "is this joinable / started / finished". This module adds no notion of its
// own about any of that; it only puts the questions in order.

import type { Game, UserId } from '@/types';
import { activeGuestCount } from '@/types';
import {
  LATE_REG_GRACE_MS,
  isActive,
  isCancelled,
  isOpen,
  isRoundRunning,
  isScheduled,
} from '@/services/gameLifecycle';
import { dayDiff } from '@/utils/format';

/** Below this, the card counts down to kickoff instead of naming the day. */
export const STARTS_SOON_MS = 6 * 60 * 60 * 1000;

export type RoundStateKind =
  /** The evening is running right now. */
  | 'live'
  /** The viewer is in, and it is today. */
  | 'today'
  /** The viewer is in the roster. */
  | 'registered'
  /** The viewer is on the overflow waitlist — which is NOT being in. */
  | 'waitlist'
  /** Awaiting the organiser's approval. */
  | 'pending'
  /** The game exists; registration has not opened yet. */
  | 'opensSoon'
  /** Registration is over and the viewer is not in it. */
  | 'closed'
  /** Every place is taken; the waitlist is the way in. */
  | 'full'
  /** Open, and the viewer can still take a place. */
  | 'open';

export interface UpcomingRoundState {
  kind: RoundStateKind;
  /** Players + non-waitlisted guests. The number the card prints. */
  registered: number;
  /** `maxPlayers` when the game actually sets one; null disables the bar. */
  capacity: number | null;
  /** null whenever capacity is null — "spots left" of an unbounded game is
   *  not zero, it is unanswerable. */
  spotsLeft: number | null;
  waitlistCount: number;
  /** 1-based place in the queue, from the waitlist array's own order. Null
   *  when the viewer is not on it — never a guess. */
  waitlistPosition: number | null;
  /** When registration opens. Null when the game never scheduled one. */
  opensAt: number | null;
  /** Kickoff minus now; negative once it has passed. */
  startsInMs: number;
  /** True inside `STARTS_SOON_MS` of kickoff — the card counts down. */
  startsSoon: boolean;
  /** Calendar-day comparison, not a duration: "today" at 23:00 is today. */
  isToday: boolean;
  /** The viewer holds a place. False for waitlist and pending. */
  viewerRegistered: boolean;
}

/**
 * `canJoinGame`, with the clock passed in.
 *
 * The lifecycle module's own predicate reads `Date.now()` directly, which
 * makes "is the door open" untestable at a chosen moment — and this module's
 * whole job is to be testable. So the question is asked here from the SAME
 * exported parts the predicate is built from: the status check, the shared
 * grace constant, and the running-round guard. Nothing is re-decided; only
 * the clock is injectable.
 *
 * If `canJoinGame` ever gains a rung, it has to gain one here too — which is
 * why the two sit side by side in the tests.
 */
function doorOpenAt(game: Game, now: number): boolean {
  if (!isOpen(game)) return false;
  if (game.startsAt && now > game.startsAt + LATE_REG_GRACE_MS) return false;
  if (isRoundRunning(game)) return false;
  return true;
}

/**
 * The state of the upcoming round for one viewer.
 *
 * The order of the questions is the whole point:
 *
 *   live       — the evening is happening; nothing else matters
 *   waitlist   — asked BEFORE "registered", because a player on the overflow
 *                list is not in the game and must never see a green tick
 *   pending    — asked for the same reason: approval is not a place
 *   today      — only for someone who is in; for anyone else the useful
 *                thing today is still the registration, not the date
 *   registered
 *   opensSoon  — a scheduled game is shown, not hidden
 *   closed     — `canJoinGame` is the app's existing answer to "is the door
 *                open", including the one-hour post-kickoff grace
 *   full       — after `closed`: a closed full game is closed, not full
 *   open
 */
export function deriveRoundState(
  game: Game,
  viewerId: UserId,
  now: number = Date.now(),
): UpcomingRoundState {
  const players = game.players ?? [];
  const waitlist = game.waitlist ?? [];
  const pending = game.pending ?? [];

  const registered = players.length + activeGuestCount(game.guests);
  const capacity = game.maxPlayers && game.maxPlayers > 0 ? game.maxPlayers : null;
  const spotsLeft = capacity === null ? null : Math.max(0, capacity - registered);

  const viewerRegistered = players.includes(viewerId);
  const waitlistIndex = waitlist.indexOf(viewerId);
  const startsInMs = (game.startsAt ?? 0) - now;

  const base = {
    registered,
    capacity,
    spotsLeft,
    waitlistCount: waitlist.length,
    waitlistPosition: waitlistIndex >= 0 ? waitlistIndex + 1 : null,
    opensAt: game.registrationOpensAt ?? null,
    startsInMs,
    startsSoon: startsInMs > 0 && startsInMs <= STARTS_SOON_MS,
    isToday: !!game.startsAt && dayDiff(game.startsAt, now) === 0,
    viewerRegistered,
  };

  const kind = ((): RoundStateKind => {
    if (isActive(game) || isRoundRunning(game)) return 'live';
    if (waitlistIndex >= 0) return 'waitlist';
    if (pending.includes(viewerId)) return 'pending';
    if (viewerRegistered) return base.isToday ? 'today' : 'registered';
    // A scheduled game, or one whose own opening time is still ahead. Both
    // are "not yet", and the second covers a game the flip CF has not reached.
    if (isScheduled(game) || (base.opensAt !== null && base.opensAt > now)) {
      return 'opensSoon';
    }
    if (!doorOpenAt(game, now)) return 'closed';
    if (capacity !== null && registered >= capacity) return 'full';
    return 'open';
  })();

  return { kind, ...base };
}

// ── what the section shows, as a whole ─────────────────────────────────────

export interface HomeRoundLayout {
  /** The upcoming game, when there is one worth leading with. */
  upcoming: Game | null;
  /** The round that just finished, if any. */
  completed: Game | null;
  /**
   * How the completed card is drawn. It is the headline only when there is no
   * upcoming round to lead with — an evening that is over never outranks one
   * that is coming.
   */
  completedRole: 'primary' | 'compact' | null;
  /** The "no round" opportunity card. Shown whenever there is no upcoming
   *  one, including under a completed card. */
  showEmpty: boolean;
}

/**
 * Which cards the round area renders, and in what order.
 *
 * The upcoming round always wins. The case this exists for is the common one
 * — an evening finished last night and next week's is already open — where
 * merging the two into one card would mean saying two different things in one
 * voice, and replacing the upcoming one with a summary would bury the thing
 * the player can still act on.
 */
export function pickHomeRound(
  upcoming: Game | null,
  completed: Game | null,
): HomeRoundLayout {
  if (upcoming) {
    return {
      upcoming,
      completed,
      completedRole: completed ? 'compact' : null,
      showEmpty: false,
    };
  }
  if (completed) {
    return { upcoming: null, completed, completedRole: 'primary', showEmpty: true };
  }
  return { upcoming: null, completed: null, completedRole: null, showEmpty: true };
}

/**
 * Is this game one the round area should lead with at all?
 *
 * A cancelled game is not a plan. The screen's own queries already drop them,
 * so this is a guard rather than a filter — but the card must never be the
 * place where a cancelled evening slips through.
 */
export function isShowableUpcoming(game: Game | null): game is Game {
  return !!game && !isCancelled(game);
}

// ── summary metrics, and only the ones that exist ──────────────────────────

export interface CompletedMetric {
  key: 'rounds' | 'players';
  value: number;
}

/**
 * What the completed card can honestly say about the evening.
 *
 * Deliberately short. The game document carries the mini-game count and the
 * roster; GOALS are not on it — they live in the `roundHistory`
 * subcollection, and fetching them would put a read on the home screen for a
 * decoration. A metric that is absent is omitted, never printed as a zero:
 * "0 משחקונים" is a claim about the evening, and it would be a false one.
 */
export function completedMetrics(game: Game): CompletedMetric[] {
  const out: CompletedMetric[] = [];
  const rounds = game.committedRoundCount;
  if (typeof rounds === 'number' && rounds > 0) out.push({ key: 'rounds', value: rounds });
  const players = (game.players ?? []).length;
  if (players > 0) out.push({ key: 'players', value: players });
  return out;
}
