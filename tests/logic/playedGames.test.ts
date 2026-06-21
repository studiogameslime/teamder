import {
  wasInDraftTeams,
  isPlayedGame,
  isAttendedGame,
} from '@/utils/playedGames';
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

// The canonical predicate shared by the Profile count, Statistics screen,
// History list, and achievements derivation. These four MUST agree.
describe('isAttendedGame', () => {
  const base = { status: 'finished', startsAt: PAST, players: ['u1', 'u2'] };

  it('counts a finished, past game the user is in and did not no-show', () => {
    expect(isAttendedGame(base, 'u1', NOW)).toBe(true);
  });

  it('counts when there is no arrival entry (no_show is opt-in)', () => {
    expect(isAttendedGame({ ...base, arrivals: {} }, 'u1', NOW)).toBe(true);
  });

  it('does NOT count an explicit no_show', () => {
    expect(
      isAttendedGame({ ...base, arrivals: { u1: 'no_show' } }, 'u1', NOW),
    ).toBe(false);
  });

  it('does NOT count an unfinished game', () => {
    expect(isAttendedGame({ ...base, status: 'live' }, 'u1', NOW)).toBe(false);
  });

  it('does NOT count a future game', () => {
    expect(isAttendedGame({ ...base, startsAt: FUTURE }, 'u1', NOW)).toBe(false);
  });

  it('does NOT count a game the user is not a player in', () => {
    expect(isAttendedGame(base, 'u9', NOW)).toBe(false);
  });

  it('is false for an empty user id', () => {
    expect(isAttendedGame(base, '', NOW)).toBe(false);
  });

  it('does NOT require draftTeams (unlike isPlayedGame) — the key fix', () => {
    // Same past finished game, user in players[], NO teams drawn.
    expect(isPlayedGame({ startsAt: PAST }, 'u1', NOW)).toBe(false);
    expect(isAttendedGame(base, 'u1', NOW)).toBe(true);
  });
});
