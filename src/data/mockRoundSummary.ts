import type { EveningStat } from '@/utils/eveningRecords';
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
    stats: { rounds: 10, goals: 31, assists: 18, shootouts: 2, ties: 3 },
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

/**
 * A club's evenings, for the emulator's club-records cards.
 *
 * Shaped like the production documents and deliberately UNEVEN — one evening
 * well clear on goals, a tie on shootouts, and one evening with
 * `hasRoundHistory: false` so the exclusion path is exercised rather than
 * assumed. The dates are spread across the last few months so the season
 * filter has something to cut.
 */
export function mockEveningStats(
  _groupId: string,
  opts?: { from?: number; to?: number },
): EveningStat[] {
  const DAY = 86_400_000;
  // Anchored to the mock season windows in `seasonHistoryService` so the scope
  // picker actually changes the records on screen:
  //   season 1   1_752_000_000_000 → 1_776_000_000_000  (closed)
  //   current    1_776_000_000_000 → now
  const S1 = 1_752_000_000_000;
  const S1_END = 1_776_000_000_000;
  const rows: EveningStat[] = [
    // ── the running season ──────────────────────────────────────────────
    // Ids are REAL mock games, so tapping a record opens an evening that
    // exists — a synthetic id proved the navigation fired but landed on
    // "המחזור כבר לא קיים", which proves nothing about the target.
    { gameId: 'gv2-7', at: S1_END + 40 * DAY, goals: 47, rounds: 12, shootouts: 2, hasRoundHistory: true },
    { gameId: 'gv2-lastnight', at: S1_END + 26 * DAY, goals: 31, rounds: 18, shootouts: 1, hasRoundHistory: true },
    { gameId: 'gv2-6', at: S1_END + 12 * DAY, goals: 28, rounds: 9, shootouts: 5, hasRoundHistory: true },
    // Ties the running season's shootout record, and is OLDER — so this is the
    // evening the card names and opens, not gv2-6.
    { gameId: 'gv2-5', at: S1_END + 4 * DAY, goals: 22, rounds: 8, shootouts: 5, hasRoundHistory: true },
    // ── season 1, closed ────────────────────────────────────────────────
    // Deliberately SMALLER than the running season's, so switching scope
    // visibly changes every number and every target.
    { gameId: 'gv2-4', at: S1 + 60 * DAY, goals: 19, rounds: 7, shootouts: 3, hasRoundHistory: true },
    { gameId: 'gv2-3', at: S1 + 20 * DAY, goals: 14, rounds: 6, shootouts: 1, hasRoundHistory: true },
    // Replayed from before the summaries existed: all zeros, and excluded from
    // every calculation rather than counted as an evening where nothing
    // happened.
    { gameId: 'gv2-2', at: S1 + 5 * DAY, goals: 0, rounds: 0, shootouts: 0, hasRoundHistory: false },
  ];
  return rows.filter(
    (r) =>
      (opts?.from === undefined || r.at >= opts.from) &&
      (opts?.to === undefined || r.at <= opts.to),
  );
}
