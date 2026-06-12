import { wasInDraftTeams, isPlayedGame } from '@/utils/playedGames';
import { DraftTeamsResult } from '@/types';

function teams(...teamPlayerIds: string[][]): DraftTeamsResult {
  return {
    method: 'snake',
    numTeams: teamPlayerIds.length,
    createdAt: 0,
    createdBy: 'admin',
    teams: teamPlayerIds.map((playerIds, index) => ({
      index,
      captainId: playerIds[0],
      playerIds,
    })),
  };
}

const NOW = 1_000_000_000;
const PAST = NOW - 1;
const FUTURE = NOW + 1;

describe('wasInDraftTeams', () => {
  it('is false without teams', () => {
    expect(wasInDraftTeams(undefined, 'u1')).toBe(false);
  });

  it('is false for an empty user id', () => {
    expect(wasInDraftTeams(teams(['u1']), '')).toBe(false);
  });

  it('finds a captain', () => {
    expect(wasInDraftTeams(teams(['u1', 'u2'], ['u3']), 'u1')).toBe(true);
  });

  it('finds a non-captain member on the second team', () => {
    expect(wasInDraftTeams(teams(['u1'], ['u3', 'u4']), 'u4')).toBe(true);
  });

  it('is false for someone not placed', () => {
    expect(wasInDraftTeams(teams(['u1'], ['u3']), 'u9')).toBe(false);
  });
});

describe('isPlayedGame', () => {
  it('counts a past game the user was in the teams for', () => {
    expect(
      isPlayedGame({ startsAt: PAST, draftTeams: teams(['u1', 'u2']) }, 'u1', NOW),
    ).toBe(true);
  });

  it('does NOT count a future game even if teams are drawn', () => {
    expect(
      isPlayedGame({ startsAt: FUTURE, draftTeams: teams(['u1']) }, 'u1', NOW),
    ).toBe(false);
  });

  it('does NOT count a past game without teams', () => {
    expect(isPlayedGame({ startsAt: PAST }, 'u1', NOW)).toBe(false);
  });

  it('does NOT count a past game the user was not placed in', () => {
    expect(
      isPlayedGame({ startsAt: PAST, draftTeams: teams(['u2']) }, 'u1', NOW),
    ).toBe(false);
  });
});
