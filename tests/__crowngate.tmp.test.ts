import { __statsCandidates } from '../src/utils/assistant/rules';

const base: any = {
  now: Date.now(), nonce: 1, user: { stats: { cancelled: 0 } },
  nextGame: null, isGameToday: false, communities: [{ id: 'g1' }],
  isClubAdmin: false, playedThisWeek: 0, lastPlayedMs: null,
  playedCount: 60, markedAvailability: true, bestEvening: null,
  clubName: 'האדומים',
  shown: { nextGameCard: false, recommendedDay: false, availabilityPodium: false,
    upcomingScheduledCard: false, openToJoinCard: false, availabilityPrompt: false },
};

const ins = (over: any) => ({
  goals: 0, assists: 0, scorerPlace: 4, scorerTotal: 20,
  isTopScorer: false, goalsToCrown: null, isTopAssister: false,
  assistsToCrown: null, rivalName: null, goalsToPassRival: null,
  attendanceStreak: 12, attendedNights: 60, winsPlace: 2, ...over,
});

test('reporter repro: no-goals club', () => {
  const a = __statsCandidates({ ...base, clubInsight: ins({}) } as any).map(c => c.id);
  const b = __statsCandidates({ ...base, clubInsight: ins({ goalsToCrown: 30 }) } as any).map(c => c.id);
  console.log('NO GOALS RECORDED :', JSON.stringify(a));
  console.log('goalsToCrown = 30 :', JSON.stringify(b));
});
