// What a journey needs to know about an organiser, and when to say it again.
//
// Joryio gets five user attributes from us and no merge fields, so a journey
// cannot ask "how big is this club" at send time — whatever it is going to say
// has to already be on the profile. That is what this computes.
//
// Two journeys read it:
//   • BUILD THE SQUAD — from the moment a club is created until it is playable.
//     It must NOT stop at the first member: one player is not a game, and the
//     message at three has to sound different from the message at zero.
//   • RUN THE FIRST ROUND — starts where the first one ends.
//
// Pure on purpose. The thresholds here decide what thousands of pushes say, and
// they should be arguable in a test rather than buried in a screen.

/** A club is playable at ten: five a side, which is what these clubs play. */
export const PLAYABLE_ROSTER = 10;

/**
 * Milestones worth telling Joryio about.
 *
 * Not every join — that would be one event per person and a journey that
 * re-triggers on noise. These are the three points where what an organiser
 * needs to hear actually CHANGES: the club stops being invisible, it starts
 * looking like a group, and it becomes a game.
 */
export const ROSTER_MILESTONES = [2, 5, PLAYABLE_ROSTER] as const;

/** Where an organiser is, in the only terms the copy cares about. */
export type OrganiserStage =
  | 'empty' // nobody but them — the club exists for no one else
  | 'seeded' // 1–3: started, not yet a group
  | 'forming' // 4–7: a real squad taking shape
  | 'nearly' // 8–9: the finish line is countable
  | 'playable'; // 10+: stop asking for members, start asking for a game

export function stageFor(size: number): OrganiserStage {
  const n = Math.max(0, Math.trunc(size || 0));
  if (n >= PLAYABLE_ROSTER) return 'playable';
  if (n >= 8) return 'nearly';
  if (n >= 4) return 'forming';
  if (n >= 1) return 'seeded';
  return 'empty';
}

/** How many more people before the club can field a game. 0 once it can. */
export function missingForPlayable(size: number): number {
  return Math.max(0, PLAYABLE_ROSTER - Math.max(0, Math.trunc(size || 0)));
}

/**
 * The milestone this roster has just crossed, if any.
 *
 * Compares against the club's OWN previous high-water mark rather than the
 * previous size, so a club that loses a player and re-adds them does not fire
 * the same milestone twice — a journey re-triggering on churn is how an
 * organiser gets the same message three times and turns notifications off.
 */
export function milestoneCrossed(
  previousBest: number,
  size: number,
): number | null {
  const before = Math.max(0, Math.trunc(previousBest || 0));
  const now = Math.max(0, Math.trunc(size || 0));
  if (now <= before) return null;
  const crossed = ROSTER_MILESTONES.filter((m) => m > before && m <= now);
  // The HIGHEST crossed, not each one. A club that imports a whole WhatsApp
  // group jumps 0 → 14 in one go and deserves one "you are ready", not three
  // notifications describing a journey it has already finished.
  return crossed.length ? crossed[crossed.length - 1] : null;
}

/** The attributes a journey branches on. Flat primitives — the native bridge
 *  takes nothing else. */
export interface OrganiserAttributes {
  /** Biggest roster among the clubs this person ADMINS. Someone who merely
   *  belongs to a big club is not an organiser and must not be told to grow
   *  one. */
  club_size: number;
  club_stage: OrganiserStage;
  clubs_admin: number;
  /** Zero once the club is playable, so "עוד N" can never read "עוד 0". */
  club_missing: number;
}

export function organiserAttributes(
  adminRosterSizes: readonly number[],
): OrganiserAttributes {
  const sizes = adminRosterSizes.map((n) => Math.max(0, Math.trunc(n || 0)));
  const biggest = sizes.length ? Math.max(...sizes) : 0;
  return {
    club_size: biggest,
    club_stage: stageFor(biggest),
    clubs_admin: sizes.length,
    club_missing: missingForPlayable(biggest),
  };
}
