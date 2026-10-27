import { homeStatsSlides, nextPersonalMilestone } from '../../src/utils/homePersonalStats';
import type { PlayerStatsSummary } from '../../src/services/playerStatsService';
const empty: PlayerStatsSummary = {
  attendedGames: 0, totalRegistered: 0, attendanceRate: 0, goals: 0, assists: 0,
  goalsPerEvening: 0, distinctPlayers: 0, mostPlayedWith: null, mostWinsWith: null,
  biggestVictim: null, nemesis: null, mostAssistedTo: null, mostAssistedBy: null,
};
test('registration without attendance shows the overview without invented history pages', () => {
  expect(homeStatsSlides({ ...empty, totalRegistered: 3 })).toEqual(['overview']);
});
test('one attended round is sufficient for actual counters, without invented scores or partners', () => {
  expect(homeStatsSlides({ ...empty, attendedGames: 1 })).toEqual(['overview']);
});
test('zero is a valid score and recent scores remain after the first overview page', () => {
  const highlights = { points: [{ gameId: 'a', at: 1, score: 0 }], recentCount: 1, bestGoals: null, bestAssists: null, recordedRounds: 0, incomplete: true, results: null };
  expect(homeStatsSlides({ ...empty, attendedGames: 1, highlights })).toEqual(['overview', 'scores']);
});
test('partners require a recorded shared round and milestone must actually be close', () => {
  expect(homeStatsSlides({ ...empty, attendedGames: 10, goals: 48, mostPlayedWith: { uid: 'p', count: 7 } })).toEqual(['overview', 'partner', 'milestone']);
  expect(homeStatsSlides({ ...empty, attendedGames: 10, mostPlayedWith: { uid: 'p', count: 0 } })).toEqual(['overview']);
});
test('milestone boundaries never congratulate a future or already achieved target', () => {
  expect(nextPersonalMilestone(0)).toBeNull();
  expect(nextPersonalMilestone(NaN)).toBeNull();
  expect(nextPersonalMilestone(7)).toEqual({ target: 10, remaining: 3 });
  expect(nextPersonalMilestone(10)).toBeNull();
  expect(nextPersonalMilestone(48)).toEqual({ target: 50, remaining: 2 });
  expect(nextPersonalMilestone(200)).toBeNull();
});
