// Achievement catalog. Each entry is a self-describing definition — id,
// Hebrew copy, the counter it watches, the threshold to unlock, and a
// vector icon glyph + tint used by the AchievementBadge component.
//
// Order matters: badges render in the array order on the Player Card,
// grouped by `category`.

import type { Ionicons } from '@expo/vector-icons';
import type {
  AchievementCategory,
  AchievementMetric,
} from '@/types';
import { colors } from '@/theme';

export interface AchievementDef {
  id: string;
  titleHe: string;
  descriptionHe: string;
  category: AchievementCategory;
  metric: AchievementMetric;
  /** Counter value at which the achievement unlocks. */
  threshold: number;
  /** Ionicons glyph name. Rendered in a colored circle by AchievementBadge. */
  icon: keyof typeof Ionicons.glyphMap;
  /** Background tint of the badge circle when unlocked. */
  tint: string;
}

const TINT_GAMES = colors.primary;
const TINT_TEAMS = colors.info;
const TINT_INVITES = colors.warning;
const TINT_COACH = '#7C3AED'; // purple — matches the JERSEY_COLORS.purple swatch

export const ACHIEVEMENTS: AchievementDef[] = [
  // ─── Games ─────────────────────────────────────────────────────────────
  {
    id: 'firstGame',
    titleHe: 'משחק ראשון',
    descriptionHe: 'נרשמת למשחק הראשון שלך',
    category: 'games',
    metric: 'gamesJoined',
    threshold: 1,
    icon: 'football-outline',
    tint: TINT_GAMES,
  },
  {
    id: 'fiveGames',
    titleHe: '5 משחקים',
    descriptionHe: 'השתתפת ב-5 משחקים',
    category: 'games',
    metric: 'gamesJoined',
    threshold: 5,
    icon: 'football',
    tint: TINT_GAMES,
  },
  {
    id: 'tenGames',
    titleHe: '10 משחקים',
    descriptionHe: 'השתתפת ב-10 משחקים',
    category: 'games',
    metric: 'gamesJoined',
    threshold: 10,
    icon: 'flame-outline',
    tint: TINT_GAMES,
  },
  {
    id: 'twentyFiveGames',
    titleHe: '25 משחקים',
    descriptionHe: 'אגדת מגרש בהתהוות',
    category: 'games',
    metric: 'gamesJoined',
    threshold: 25,
    icon: 'flame',
    tint: TINT_GAMES,
  },
  {
    id: 'fiftyGames',
    titleHe: '50 משחקים',
    descriptionHe: 'מתמיד אמיתי',
    category: 'games',
    metric: 'gamesJoined',
    threshold: 50,
    icon: 'medal',
    tint: TINT_GAMES,
  },

  // ─── Teams ─────────────────────────────────────────────────────────────
  {
    id: 'createdFirstTeam',
    titleHe: 'הקמת קבוצה',
    descriptionHe: 'יצרת את הקבוצה הראשונה שלך',
    category: 'teams',
    metric: 'teamsCreated',
    threshold: 1,
    icon: 'shield-outline',
    tint: TINT_TEAMS,
  },
  {
    id: 'joinedThreeTeams',
    titleHe: 'חבר ב-3 קבוצות',
    descriptionHe: 'הצטרפת ל-3 קבוצות שונות',
    category: 'teams',
    metric: 'teamsJoined',
    threshold: 3,
    icon: 'people-outline',
    tint: TINT_TEAMS,
  },

  // ─── Invites ───────────────────────────────────────────────────────────
  {
    id: 'invitedFirstPlayer',
    titleHe: 'הזמנה ראשונה',
    descriptionHe: 'הזמנת שחקן למשחק',
    category: 'invites',
    metric: 'invitesSent',
    threshold: 1,
    icon: 'paper-plane-outline',
    tint: TINT_INVITES,
  },
  {
    id: 'invitedThreePlayers',
    titleHe: '3 הזמנות',
    descriptionHe: 'הזמנת 3 שחקנים למשחקים',
    category: 'invites',
    metric: 'invitesSent',
    threshold: 3,
    icon: 'paper-plane',
    tint: TINT_INVITES,
  },
  {
    id: 'invitedTenPlayers',
    titleHe: '10 הזמנות',
    descriptionHe: 'מארח של הקבוצה',
    category: 'invites',
    metric: 'invitesSent',
    threshold: 10,
    icon: 'megaphone',
    tint: TINT_INVITES,
  },

  // ─── Coaching ──────────────────────────────────────────────────────────
  {
    id: 'coachOf10',
    titleHe: 'מאמן של 10',
    descriptionHe: 'אישרת 10 שחקנים לקבוצה',
    category: 'coaching',
    metric: 'playersCoached',
    threshold: 10,
    icon: 'ribbon-outline',
    tint: TINT_COACH,
  },
  {
    id: 'coachOf20',
    titleHe: 'מאמן של 20',
    descriptionHe: 'אישרת 20 שחקנים לקבוצה',
    category: 'coaching',
    metric: 'playersCoached',
    threshold: 20,
    icon: 'ribbon',
    tint: TINT_COACH,
  },
  {
    id: 'coachOf30',
    titleHe: 'מאמן של 30',
    descriptionHe: 'אישרת 30 שחקנים לקבוצה',
    category: 'coaching',
    metric: 'playersCoached',
    threshold: 30,
    icon: 'trophy',
    tint: TINT_COACH,
  },
];
