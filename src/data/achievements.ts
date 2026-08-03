// Achievement catalog — TIERED model.
//
// Each entry is ONE badge that levels up in place through three metal
// tiers: bronze → silver → gold. Crossing the next threshold upgrades the
// same badge (it doesn't add a new one). This replaces the old model of a
// separate badge per threshold (e.g. 5/10/25/50/100 games = five badges).
//
// Order matters: badges render in array order on the achievements grid.

import type { Ionicons } from '@expo/vector-icons';
import type { AchievementMetric, AchievementTier } from '@/types';

/** Tier display metadata — Hebrew label + medal colour + sort order. */
export const TIER_META: Record<
  AchievementTier,
  { he: string; color: string; order: number }
> = {
  bronze: { he: 'ברונזה', color: '#CD7F32', order: 1 },
  silver: { he: 'כסף', color: '#9AA4B2', order: 2 },
  gold: { he: 'זהב', color: '#F4B73E', order: 3 },
};

export interface AchievementTierStep {
  tier: AchievementTier;
  threshold: number;
}

export interface AchievementDef {
  id: string;
  metric: AchievementMetric;
  /** Badge title (the noun/theme) — stays constant across tiers. */
  titleHe: string;
  /** Counted noun used in the progress copy, e.g. "100 שערים". */
  nounHe: string;
  /** Short action phrase explaining HOW the badge is earned, e.g.
   *  "כבוש שערים במחזורים". The concrete tier targets are appended from
   *  `tiers` at render time, so this stays just the action. */
  howHe: string;
  /** Ionicons glyph rendered on the tier-coloured disk. */
  icon: keyof typeof Ionicons.glyphMap;
  /** Ascending tier thresholds. One-off badges have a single gold step. */
  tiers: AchievementTierStep[];
  /** True when the badge has no bronze/silver climb — a single milestone. */
  oneOff?: boolean;
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

export const ACHIEVEMENTS: AchievementDef[] = [
  {
    id: 'goals',
    metric: 'goals',
    titleHe: 'שערים',
    nounHe: 'שערים',
    howHe: 'כבוש שערים במחזורים חיים',
    icon: 'football',
    tiers: tiered(5, 20, 100),
  },
  {
    id: 'assists',
    metric: 'assists',
    titleHe: 'בישולים',
    nounHe: 'בישולים',
    howHe: 'בשל לחברים לקבוצה — מסירה שמובילה לגול',
    icon: 'hand-left',
    tiers: tiered(5, 20, 75),
  },
  {
    id: 'games',
    metric: 'gamesJoined',
    titleHe: 'מחזורים',
    nounHe: 'מחזורים',
    howHe: 'השתתף במחזורים',
    icon: 'calendar',
    tiers: tiered(5, 25, 100),
  },
  {
    id: 'partner',
    metric: 'maxGamesWithPlayer',
    titleHe: 'שותף קבוע',
    nounHe: 'מחזורים עם אותו שחקן',
    howHe: 'שחק שוב ושוב עם אותו שחקן',
    icon: 'people',
    tiers: tiered(5, 15, 30),
  },
  {
    id: 'duo',
    metric: 'maxWinsWithPlayer',
    titleHe: 'צמד מנצח',
    nounHe: 'נצחונות עם אותו שחקן',
    howHe: 'נצח מחזורים יחד עם אותו שחקן',
    icon: 'trophy',
    tiers: tiered(3, 10, 25),
  },
  {
    id: 'distinctPlayers',
    metric: 'distinctPlayers',
    titleHe: 'היכרויות',
    nounHe: 'שחקנים שהכרת',
    howHe: 'שחק עם כמה שיותר שחקנים שונים',
    icon: 'people-circle',
    tiers: tiered(10, 30, 75),
  },
  {
    id: 'friends',
    metric: 'friendsCount',
    titleHe: 'חברים',
    nounHe: 'חברים',
    howHe: 'הוסף חברים באפליקציה',
    icon: 'person-add',
    tiers: tiered(3, 10, 25),
  },
  {
    id: 'communities',
    metric: 'teamsJoined',
    titleHe: 'מועדונים',
    nounHe: 'מועדונים',
    howHe: 'הצטרף למועדונים',
    icon: 'shield',
    tiers: tiered(2, 5, 10),
  },
  {
    id: 'invites',
    metric: 'invitesSent',
    titleHe: 'הזמנות',
    nounHe: 'שחקנים שהבאת',
    howHe: 'הזמן שחקנים חדשים שיורידו את האפליקציה',
    icon: 'paper-plane',
    tiers: tiered(3, 10, 25),
  },
  {
    id: 'coaching',
    metric: 'playersCoached',
    titleHe: 'ניהול',
    nounHe: 'שחקנים שאישרת',
    howHe: 'אשר בקשות הצטרפות כמנהל מועדון',
    icon: 'ribbon',
    tiers: tiered(10, 25, 50),
  },
  {
    id: 'founder',
    metric: 'teamsCreated',
    titleHe: 'מקים מועדון',
    nounHe: 'מועדון שהקמת',
    howHe: 'הקם מועדון משלך',
    icon: 'flag',
    tiers: [{ tier: 'gold', threshold: 1 }],
    oneOff: true,
  },
];

/**
 * Resolve the current tier reached for a metric value plus the next step
 * to climb toward. `current` is null when nothing is unlocked yet; `next`
 * is null when the gold tier is already reached.
 */
export function resolveTier(
  def: AchievementDef,
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
