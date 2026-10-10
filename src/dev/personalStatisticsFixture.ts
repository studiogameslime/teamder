import type { PlayerStatsSummary } from '@/services/playerStatsService';
import type { PersonalPenalties, StatisticsPerson } from '@/components/stats/PersonalStatisticsCard';

/** Only consumed behind DEV + QA_ROUTES + FORCE_MOCK, never saved or sent. */
export const personalStatisticsFixture: {
  user: StatisticsPerson;
  stats: PlayerStatsSummary;
  people: Record<string, StatisticsPerson>;
  pen: PersonalPenalties;
} = {
  user: { id: 'qa-personal-stats', name: 'אלירן צברי', avatarId: 'a25' },
  stats: {
    attendedGames: 54, totalRegistered: 56, attendanceRate: 96,
    goals: 31, assists: 24, goalsPerEvening: 0.6, distinctPlayers: 18,
    highlights: {points:[7,8.5,6.5,9,7.5].map((score,i)=>({gameId:`qa-score-${i}`,at:new Date(2026,2,13+i*7).getTime(),score})),recentCount:5,bestGoals:4,bestAssists:3,recordedRounds:54,incomplete:false,results:{wins:75,losses:42,ties:11,games:128,rounds:32}},
    mostPlayedWith: {uid:'qa-itay', count:44}, mostWinsWith: {uid:'qa-roy', count:17},
    biggestVictim: {uid:'qa-itay', count:12}, nemesis: {uid:'qa-roy', count:9},
    mostAssistedTo: {uid:'qa-itay', count:8}, mostAssistedBy: {uid:'qa-roy', count:6},
  },
  people: {
    'qa-itay': {id:'qa-itay', name:'איתי', avatarId:'a26'},
    'qa-roy': {id:'qa-roy', name:'רועי', avatarId:'a27'},
  },
  pen: {penTaken:4, penScored:2, penFaced:2, penSaved:2, ownGoals:0, ties:0},
};
