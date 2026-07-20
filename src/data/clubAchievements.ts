// Club achievements — the COMMUNITY-level parallel to the personal
// achievement catalog (src/data/achievements.ts). Each badge is a club
// milestone that levels up in place through bronze → silver → gold.
//
// Everything is derived CLIENT-SIDE from aggregates the backend already
// maintains (communityShowcase / getCommunityStats / getCommunityChampionship)
// + the Group doc — no new collection, trigger, or write.

import type { Ionicons } from '@expo/vector-icons';
import { TIER_META, type AchievementTierStep } from '@/data/achievements';
import type { AchievementTier } from '@/types';

export { TIER_META };

/** Club-level metrics fed into the catalog (all already available client-side). */
export interface ClubMetrics {
  /** Finished game-nights (getCommunityStats.totalFinished). */
  gameNights: number;
  /** Total goals scored across the club (getCommunityChampionship.totalGoals). */
  clubGoals: number;
  /** Approved members (Group.playerIds.length). */
  members: number;
  /** Whole years since founding (from Group.createdAt). */
  ageYears: number;
  /** Distinct members who showed up in the last 30d (getCommunityStats.activeThisMonth). */
  activeThisMonth: number;
  /** Finish rate 0–100 (getCommunityStats.organizationRate × 100). */
  organizationRatePct: number;
}

export interface ClubAchievementDef {
  id: string;
  titleHe: string;
  nounHe: string;
  howHe: string;
  icon: keyof typeof Ionicons.glyphMap;
  tiers: AchievementTierStep[];
  oneOff?: boolean;
  /** Pull this badge's current value out of the club metrics. */
  value: (m: ClubMetrics) => number;
}

const tiered = (
  bronze: number,
  silver: number,
  gold: number,
): AchievementTierStep[] => [
  { tier: 'bronze', threshold: bronze },
  { tier: 'silver', threshold: silver },
  { tier: 'gold', threshold: gold },
];

export const CLUB_ACHIEVEMENTS: ClubAchievementDef[] = [
  {
    id: 'gameNights',
    titleHe: 'מפגשים',
    nounHe: 'ערבי משחק',
    howHe: 'קיימו ערבי משחק במועדון',
    icon: 'calendar',
    tiers: tiered(10, 50, 100),
    value: (m) => m.gameNights,
  },
  {
    id: 'clubGoals',
    titleHe: 'שערי המועדון',
    nounHe: 'שערים כקבוצה',
    howHe: 'כבשו שערים בכל המשחקים של המועדון',
    icon: 'football',
    tiers: tiered(100, 500, 1000),
    value: (m) => m.clubGoals,
  },
  {
    id: 'members',
    titleHe: 'חברי מועדון',
    nounHe: 'חברים',
    howHe: 'צרפו שחקנים למועדון',
    icon: 'people',
    tiers: tiered(10, 25, 50),
    value: (m) => m.members,
  },
  {
    id: 'ageYears',
    titleHe: 'ותק המועדון',
    nounHe: 'שנים פעילות',
    howHe: 'כמה שנים המועדון קיים ופעיל — תואר על ההיסטוריה של המועדון',
    icon: 'time',
    tiers: tiered(1, 2, 5),
    value: (m) => m.ageYears,
  },
  {
    id: 'activeThisMonth',
    titleHe: 'פעילות החודש',
    nounHe: 'שחקנים פעילים החודש',
    howHe: 'הביאו שחקנים למגרש החודש',
    icon: 'flame',
    tiers: tiered(5, 10, 20),
    value: (m) => m.activeThisMonth,
  },
  {
    id: 'organization',
    titleHe: 'מועדון מאורגן',
    nounHe: 'אחוז משחקים שהתקיימו',
    howHe: 'הגיעו ל-90% משחקים שהתקיימו (לא בוטלו)',
    icon: 'shield-checkmark',
    tiers: [{ tier: 'gold', threshold: 90 }],
    oneOff: true,
    value: (m) => m.organizationRatePct,
  },
];

/** Current tier reached + the next step (mirror of achievements.resolveTier). */
export function resolveClubTier(
  def: ClubAchievementDef,
  value: number,
): { current: AchievementTierStep | null; next: AchievementTierStep | null } {
  let current: AchievementTierStep | null = null;
  let next: AchievementTierStep | null = null;
  for (const step of def.tiers) {
    if (value >= step.threshold) current = step;
    else {
      next = step;
      break;
    }
  }
  return { current, next };
}

export interface ClubBadge {
  def: ClubAchievementDef;
  value: number;
  tier: AchievementTier | null;
  next: AchievementTierStep | null;
}

/** Live-derive every club badge from the metrics (no persistence). */
export function computeClubBadges(m: ClubMetrics): ClubBadge[] {
  return CLUB_ACHIEVEMENTS.map((def) => {
    const value = def.value(m);
    const { current, next } = resolveClubTier(def, value);
    return { def, value, tier: current?.tier ?? null, next };
  });
}
