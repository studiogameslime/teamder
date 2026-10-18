import type { User, UserAvailability } from './index';
import type { PlayerStatsSummary } from '@/services/playerStatsService';
import type { PersonalPenalties, StatisticsPerson } from '@/components/stats/PersonalStatisticsCard';

export type StatisticsVisibility = 'everyone' | 'friends' | 'onlyMe';
export type SocialPrivacy = { discoverable: boolean; statistics: StatisticsVisibility };
export type SocialPlayer = Pick<User, 'id' | 'name' | 'avatarId' | 'photoUrl'> & {
  city: string;
  availability?: Pick<UserAvailability, 'preferredDays' | 'preferredTimes' | 'availabilitySlots' | 'isAvailableForInvites'>;
  friend: boolean;
  commonClubCount: number;
  sharedRounds: number;
};
export type SocialClub = { id: string; name: string; city?: string; isOpen: boolean; coverPhotoUrl?: string; coverImageId?: string; isCommon?: boolean };
export type SocialPairSummary = {
  sharedRounds: number;
  sameTeam: { games: number; wins: number; losses: number; ties: number } | null;
  /** wins and losses belong to the viewer, never the sorted-first uid. */
  against: { games: number; wins: number; losses: number; ties: number } | null;
  assists: { toOther: number; fromOther: number } | null;
  lastSharedRoundAt: number | null;
};
export type SocialProfile = {
  player: SocialPlayer;
  clubs: SocialClub[];
  canSeeStatistics: boolean;
  statisticsVisibility?: StatisticsVisibility;
  statistics: { stats: PlayerStatsSummary; pen: PersonalPenalties; people: Record<string, StatisticsPerson> } | null;
  together: { rounds: number; games: number; wins: number; losses: number; ties: number } | null;
  pairSummary?: SocialPairSummary;
};
export type PlayerSearch = { text?: string; city?: string; friendsOnly?: boolean; day?: number; time?: string; days?: number[]; times?: string[]; cursor?: string | null };
export type PlayerSearchPage = { players: SocialPlayer[]; cursor: string | null };
