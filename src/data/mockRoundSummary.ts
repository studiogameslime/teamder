// A summary for demo mode.
//
// Hand-built rather than derived from the mock games: the point of the screen
// is what a GOOD evening looks like — a record, a milestone, a climb, a pair —
// and the mock roster has no history behind it for any of those to arise from.
import type { RoundSummary } from '@/utils/roundSummary';
import { SUMMARY_VERSION } from '@/utils/roundSummary';
import { mockPlayers } from '@/data/mockData';

export function mockRoundSummary(gameId: string): RoundSummary {
  const id = (i: number) => mockPlayers[i % mockPlayers.length]?.id ?? `p${i}`;
  return {
    version: SUMMARY_VERSION,
    generatedAt: Date.now(),
    gameId,
    groupId: 'mock-club',
    at: Date.now() - 12 * 60 * 60 * 1000,
    stats: { rounds: 10, goals: 31, assists: 18, shootouts: 2 },
    leaders: {
      topScorers: { userIds: [id(0)], value: 6 },
      topAssisters: { userIds: [id(1)], value: 4 },
      topCleanSheets: { userIds: [id(2)], value: 5 },
      topGoalInvolvement: { userIds: [id(0)], value: 8 },
      topWinners: { userIds: [id(3), id(4)], value: 7 },
    },
    teamHighlights: {
      best: [{ colourIndex: 1, wins: 6, losses: 2, played: 8 }],
      worst: [{ colourIndex: 2, wins: 1, losses: 7, played: 8 }],
    },
    pairHighlight: {
      userIds: [id(1), id(0)],
      goals: 3,
      breakdown: [{ assisterId: id(1), scorerId: id(0), goals: 3 }],
    },
    events: [
      { type: 'club_record', metric: 'goals', userIds: [id(0)], value: 6, previousValue: 5, tied: false },
      { type: 'club_milestone', metric: 'goals', threshold: 250, total: 251 },
      { type: 'rank_first_place', userIds: [id(0)] },
      { type: 'player_milestone', metric: 'goals', userIds: [id(5)], threshold: 100, total: 101 },
      { type: 'rank_jump', userIds: [id(6)], from: 9, to: 5 },
      { type: 'first_ever', code: 'two_players_4_goals' },
    ],
    basis: { since: Date.now() - 200 * 24 * 60 * 60 * 1000, eveningsCompared: 12 },
    coverage: { hasRoundHistory: true, hasAssists: true },
  };
}
