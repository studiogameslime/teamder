// Teamder Assistant — the shared contract.
//
// The assistant answers ONE question on every home open: "what is the single
// most useful thing Teamder can say to THIS player right now?" It is not a
// chatbot and has no conversation — it produces one message, optionally with
// one call to action.
//
// Two rules shape this file:
//
//   1. NO DUPLICATION. The home screen already shows the next match (day,
//      time, pitch, sign-ups), the busiest evening nearby, and the
//      availability podium. Repeating any of that is noise, so the context
//      carries a `shown` map describing what the screen is ALREADY rendering
//      and rules opt out when they'd echo it. Adding a new home card later
//      means adding one flag here — not hunting through rule bodies.
//
//   2. NO INVENTED DATA. Every number a rule puts on screen must come from a
//      field on the context that was written by a real server path. A rule
//      that wants a number it doesn't have returns null and lets a lower
//      priority speak instead.
//
// Actions are DATA, not closures: rules stay pure (and unit-testable with no
// navigation in scope) while the screen owns routing. See resolve.ts for the
// priority resolver and rules.ts for the rules themselves.

import type { Game, Group, TimeBucket, User } from '@/types';
import type { ClubInsight } from '@/services/assistantInsightsService';

/**
 * Priority bands, low number = wins. Kept as named constants rather than bare
 * numbers so a new rule declares intent ("this is an opportunity to play")
 * instead of guessing where 3.5 sits.
 */
export const AssistantPriority = {
  /** A real event that needs the user's attention (pending requests). */
  EVENT: 0,
  /** There's a match today. */
  GAME_DAY: 1,
  /** A strong personal insight — a milestone or record within reach. */
  INSIGHT: 2,
  /** A concrete chance to play right now. */
  OPPORTUNITY: 3,
  /** Club activity — the crew hasn't booked anything. */
  CLUB: 4,
  /** Softer stats / personal challenge. */
  STATS: 5,
  /** Discovery — find a club, mark availability. */
  DISCOVERY: 6,
  /** Generic engagement. Always available, always last. */
  ENGAGEMENT: 7,
} as const;
export type AssistantPriorityValue =
  (typeof AssistantPriority)[keyof typeof AssistantPriority];

/** Which rule produced a message. Also the analytics label + the variant seed. */
export type AssistantScenario =
  | 'gameDayInsight'
  | 'gameDay'
  | 'postGame'
  | 'crown'          // holds or chases a club crown (goals / assists)
  | 'milestone'      // a round number within reach
  | 'career'         // a lifetime total, stated as-is (no claim of closeness)
  | 'rivalry'        // the player one place above
  | 'standing'       // place in the club table
  | 'streak'         // consecutive attendance
  | 'loyalty'        // attendance rate / nights played
  | 'penalties'      // shootout record
  | 'clubIdle'
  | 'availabilityMatch'
  | 'humor'         // a joke, mixed into the stats pool
  | 'comeback'
  | 'joinClub'
  | 'markAvailability'
  | 'engagement';

/**
 * What tapping the CTA should do. A closed union of intents — the screen maps
 * each to navigation, so the rules never import a navigator.
 */
export type AssistantAction =
  | { kind: 'openGame'; gameId: string }
  | { kind: 'browseGames' }
  | { kind: 'createGame'; dateMs?: number; window?: TimeBucket }
  | { kind: 'markAvailability' }
  | { kind: 'discoverClubs' }
  | { kind: 'openStats' };

export interface AssistantCta {
  label: string;
  action: AssistantAction;
}

export interface AssistantMessage {
  /** Stable id for analytics + React keys. */
  id: string;
  scenario: AssistantScenario;
  priority: AssistantPriorityValue;
  /** The line the user reads. Already includes its emoji. */
  text: string;
  /** Optional second line — context under the headline. Keep it rare. */
  sub?: string;
  cta?: AssistantCta;
}

/**
 * What the home screen is ALREADY showing. Rules consult this to stay silent
 * rather than repeat a card that's inches away.
 */
export interface AssistantShownSurfaces {
  /** The next-match card is on screen with day / time / pitch / sign-ups. */
  nextGameCard: boolean;
  /** "Recommended day to open a match" — already states a day + a headcount. */
  recommendedDay: boolean;
  /** The evening-availability podium — already states days + headcounts. */
  availabilityPodium: boolean;
  /** The "a match is on the way" teaser for a club match whose sign-up hasn't
   *  opened. Its presence also means the club is NOT idle. */
  upcomingScheduledCard: boolean;
  /** The full-width "set your availability" prompt card. */
  availabilityPrompt: boolean;
}

/**
 * Everything a rule may look at. Built once per render from state the home
 * screen has ALREADY fetched — the assistant adds no round-trips of its own,
 * with the single exception of `clubRank` (see assistantInsightsService).
 */
export interface AssistantContext {
  /** Local midnight-anchored "now", so day comparisons are stable in tests. */
  now: number;
  /** Draw seed, minted once per home-screen mount. Every copy choice keys off
   *  it, so the coach says something new each time the screen opens and stays
   *  put while it's open. */
  nonce: number;
  user: User | null;
  /** Soonest match the user is registered to / created. Null = none. */
  nextGame: Game | null;
  /** True when `nextGame` kicks off today (local date). */
  isGameToday: boolean;
  /** Clubs the user belongs to. */
  communities: Group[];
  /** True when the user administers at least one club. */
  isClubAdmin: boolean;
  /** Matches the user has PLAYED since Sunday 00:00. */
  playedThisWeek: number;
  /** Epoch ms of the most recent played match; null = never played. */
  lastPlayedMs: number | null;
  /** Total attended matches (the exact count, same as the stats screen). */
  playedCount: number | null;
  /** True once the user has declared any availability. */
  markedAvailability: boolean;
  /** Busiest nearby evening, from declared availability. Null = unknown. */
  bestEvening: { dateMs: number; weekday: number; count: number } | null;
  /** The user's main club's name — the coach says it out loud ("...של
   *  כדורגל אנשים טובים"), which is what makes the line feel personal. */
  clubName: string | null;
  /**
   * Where the user stands in that club. Null = not loaded / not applicable.
   * Individual fields may also be null; never fabricated.
   */
  clubInsight: ClubInsight | null;
  shown: AssistantShownSurfaces;
}

/** A rule inspects the context and either speaks or stays quiet. */
export type AssistantRule = (ctx: AssistantContext) => AssistantMessage | null;
