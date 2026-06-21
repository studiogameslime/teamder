// playedGames — pure predicates for the "games played" model.
//
// CANONICAL definition (unified 2026-06-21): a game counts as PLAYED/ATTENDED
// for a user when it is a FINISHED, PAST game, the user is in the final
// `players[]`, and they were NOT marked `no_show`. This is the single source
// of truth shared by the Profile "games" count, the Statistics screen, the
// History list, and the achievements derivation — previously these drifted
// (the Profile used a stricter `draftTeams`-membership gate while the stats
// screen used the players[]+arrivals model, so the same "משחקים" label showed
// two different numbers). The arrivals model is the better signal: it doesn't
// require an admin to have drawn balanced teams, which often never happened.
//
// `isPlayedGame`/`wasInDraftTeams` (the old draftTeams gate) are kept only for
// any caller that still needs the lineup signal; new code should use
// `isAttendedGame`.

import { DraftTeamsResult, UserId } from '@/types';

/** Minimal shape needed to decide attendance — a subset of `Game`. */
export interface AttendableGame {
  status?: string;
  startsAt?: number;
  players?: string[];
  arrivals?: Record<string, string>;
}

/**
 * CANONICAL "did this user play this game" predicate. True iff the game is
 * finished, kickoff is in the past, the user is in the final `players[]`, and
 * they were not explicitly marked `no_show` (a missing arrival entry counts as
 * attended — the no_show marker is opt-in by the admin). Matches the logic in
 * playerStatsService + achievementsService exactly so all surfaces agree.
 */
export function isAttendedGame(
  game: AttendableGame,
  userId: UserId,
  now: number = Date.now(),
): boolean {
  if (!userId) return false;
  if (game.status !== 'finished') return false;
  if (typeof game.startsAt === 'number' && game.startsAt >= now) return false;
  if (!(game.players ?? []).includes(userId)) return false;
  if ((game.arrivals ?? {})[userId] === 'no_show') return false;
  return true;
}

/** True when `userId` is a member of any drawn team. */
export function wasInDraftTeams(
  draftTeams: DraftTeamsResult | undefined,
  userId: UserId,
): boolean {
  if (!draftTeams || !userId) return false;
  return draftTeams.teams.some((t) => t.playerIds.includes(userId));
}

/** True when a game counts as "played" for `userId`: teams were drawn with
 *  the user in them, and kickoff (`startsAt`) is in the past. */
export function isPlayedGame(
  game: { startsAt: number; draftTeams?: DraftTeamsResult },
  userId: UserId,
  now: number = Date.now(),
): boolean {
  return game.startsAt < now && wasInDraftTeams(game.draftTeams, userId);
}
