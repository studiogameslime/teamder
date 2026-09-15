import { __statsCandidates } from '@/utils/assistant/rules';
import type { AssistantContext } from '@/utils/assistant/types';
import type { ClubInsight } from '@/services/assistantInsightsService';
import type { User } from '@/types';

function insight(over: Partial<ClubInsight> = {}): ClubInsight {
  return {
    goals: 0, assists: 0, scorerPlace: 1, scorerTotal: 1, isTopScorer: false,
    goalsToCrown: null, isTopAssister: false, assistsToCrown: null,
    rivalName: null, goalsToPassRival: null, attendanceStreak: 0,
    attendedNights: 0, winsPlace: null, ...over,
  } as ClubInsight;
}
function ctx(over: Partial<AssistantContext> = {}): AssistantContext {
  return {
    now: new Date('2026-08-10T09:00:00Z').getTime(), nonce: 1,
    user: { id: 'me', name: 'x', createdAt: 0, onboardingCompleted: true,
      availability: { preferredDays: [4], isAvailableForInvites: true },
      stats: { totalGames: 0, attended: 0, cancelled: 0 } } as User,
    nextGame: null, isGameToday: false, communities: [], isClubAdmin: false,
    playedThisWeek: 0, lastPlayedMs: null, playedCount: 0,
    markedAvailability: true, bestEvening: null,
    clubName: 'מועדון', clubInsight: null,
    shown: { nextGameCard: false, recommendedDay: false, availabilityPodium: false,
      upcomingScheduledCard: false, openToJoinCard: false, availabilityPrompt: false },
    ...over,
  } as AssistantContext;
}

it('club that does not record goals: attendance/standing candidates', () => {
  const lowGoal = __statsCandidates(ctx({ clubInsight: insight({
    goals: 0, attendanceStreak: 12, attendedNights: 60, winsPlace: 2,
    scorerPlace: 4, scorerTotal: 20,
  }) })).map((c) => c.id);
  const highGoal = __statsCandidates(ctx({ clubInsight: insight({
    goals: 0, goalsToCrown: 30, attendanceStreak: 12, attendedNights: 60, winsPlace: 2,
    scorerPlace: 4, scorerTotal: 20,
  }) })).map((c) => c.id);
  // eslint-disable-next-line no-console
  console.log('NO-GOALS CLUB:', JSON.stringify(lowGoal));
  // eslint-disable-next-line no-console
  console.log('SCORING CLUB :', JSON.stringify(highGoal));
});
