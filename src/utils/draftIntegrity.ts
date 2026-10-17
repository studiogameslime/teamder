import { toGuestRosterId, type DraftTeamsResult, type Game } from '@/types';

/** A completed split must match the roster at the atomic write, not at screen load. */
export function validateDraftRoster(
  draft: DraftTeamsResult,
  game: Pick<Game, 'players' | 'guests' | 'status' | 'numberOfTeams' | 'format'>,
  expectedSettings?: Pick<Game, 'numberOfTeams' | 'format'>,
): void {
  if (game.status === 'finished' || game.status === 'cancelled') throw new Error('ROUND_CLOSED');
  if (expectedSettings && (game.format !== expectedSettings.format || game.numberOfTeams !== expectedSettings.numberOfTeams)) throw new Error('DRAFT_ROSTER_CHANGED');
  const active = new Set([...(game.players ?? []), ...(game.guests ?? []).filter(guest => !guest.waitlisted).map(guest => toGuestRosterId(guest.id))]);
  const assigned = draft.teams.flatMap(team => team.playerIds);
  const captains = draft.teams.map(team => team.captainId);
  const expectedCount = Math.min(7, Math.max(2, game.numberOfTeams ?? draft.numTeams));
  if (draft.numTeams !== expectedCount || draft.teams.length !== expectedCount || new Set(draft.teams.map(team => team.index)).size !== expectedCount || draft.teams.some(team => !Number.isInteger(team.index) || team.index < 0 || team.index >= expectedCount) ||
    new Set(captains).size !== captains.length || draft.teams.some(team => !team.playerIds.includes(team.captainId)) ||
    new Set(assigned).size !== assigned.length || assigned.length !== active.size || assigned.some(id => !active.has(id))) {
    throw new Error('DRAFT_ROSTER_CHANGED');
  }
}
