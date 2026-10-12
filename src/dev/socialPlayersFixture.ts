import type { SocialPlayer, SocialProfile } from '@/types/social';
import { personalStatisticsFixture } from './personalStatisticsFixture';

export const socialDemoPlayers: SocialPlayer[] = [
  { id: 'qa-itay', name: 'איתי לוי', avatarId: 'a13', city: 'אור יהודה', friend: false, commonClubCount: 1, sharedRounds: 12 },
  { id: 'qa-daniel', name: 'דניאל כהן', avatarId: 'a09', city: 'תל אביב', friend: false, commonClubCount: 1, sharedRounds: 0 },
  { id: 'qa-omer', name: 'עומר ישראלי', avatarId: 'a07', city: 'גבעתיים', friend: false, commonClubCount: 0, sharedRounds: 8 },
  { id: 'qa-noam', name: 'נועם אברהם', avatarId: 'a03', city: 'אור יהודה', friend: false, commonClubCount: 0, sharedRounds: 0 },
  { id: 'qa-alon', name: 'אלון מזרחי', avatarId: 'a05', city: 'אור יהודה', friend: false, commonClubCount: 0, sharedRounds: 0 },
].map(p => ({ ...p, availability: { preferredDays: [3], preferredTimes: ['evening'], availabilitySlots: { 3: ['evening'] }, isAvailableForInvites: true } }));

export function socialDemoProfile(id: string, friend: boolean): SocialProfile {
  const player = socialDemoPlayers.find(p=>p.id===id) ?? socialDemoPlayers[0];
  return { player: { ...player, friend },
    clubs: [{id:'g1',name:'כדורגל אנשים טובים',city:'אור יהודה',isOpen:true,coverImageId:'c01',isCommon:true}, {id:'g2',name:'רביעי כדורגל בנחלים',city:'נחלים',isOpen:false,coverImageId:'c03',isCommon:false}],
    canSeeStatistics: friend, statistics: friend ? {stats:personalStatisticsFixture.stats,pen:personalStatisticsFixture.pen,people:personalStatisticsFixture.people} : null,
    pairSummary: {sharedRounds:player.sharedRounds, sameTeam:{games:player.sharedRounds ? 18 : 0,wins:player.sharedRounds ? 10 : 0,losses:player.sharedRounds ? 5 : 0,ties:player.sharedRounds ? 3 : 0},against:{games:player.sharedRounds ? 9 : 0,wins:player.sharedRounds ? 4 : 0,losses:player.sharedRounds ? 3 : 0,ties:player.sharedRounds ? 2 : 0},assists:{toOther:player.sharedRounds ? 6 : 0,fromOther:player.sharedRounds ? 4 : 0},lastSharedRoundAt:player.sharedRounds ? new Date(2026,9,8,20).getTime() : null},
    together: {rounds:player.sharedRounds,games:player.sharedRounds,wins:player.sharedRounds ? 8 : 0,losses:player.sharedRounds ? 4 : 0,ties:0} };
}
