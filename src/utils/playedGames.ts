// playedGames — pure predicates for the "games played" model.
//
// A game counts as PLAYED for a user when they were placed in the drawn
// teams (draftTeams) AND the game's start time has passed. Being in the
// teams is a strong "was in the lineup / showed up" signal — far better
// than mere registration, which over-counts no-shows. Decided 2026-06-12.

import { DraftTeamsResult, UserId } from '@/types';

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
