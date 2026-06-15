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
const TINT_WINS = '#F59E0B'; // amber/gold — trophies
const TINT_TEAMS = colors.info;
const TINT_INVITES = colors.warning;
const TINT_COACH = '#7C3AED'; // purple — matches the JERSEY_COLORS.purple swatch
const TINT_SOCIAL = '#10B981'; // emerald — friends

export const ACHIEVEMENTS: AchievementDef[] = [
  // ─── Games ─────────────────────────────────────────────────────────────
  {
    id: 'firstGame',
    titleHe: 'משחק ראשון',
    descriptionHe: 'בהרכב למשחק הראשון שלך',
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
  {
    id: 'hundredGames',
    titleHe: '100 משחקים',
    descriptionHe: 'אגדת מגרש — 100 משחקים',
    category: 'games',
    metric: 'gamesJoined',
    threshold: 100,
    icon: 'trophy',
    tint: TINT_GAMES,
  },

  // ─── Wins (live "winner stays" rounds) ───────────────────────────────────
  {
    id: 'firstWin',
    titleHe: 'ניצחון ראשון',
    descriptionHe: 'ניצחת משחקון ראשון',
    category: 'wins',
    metric: 'wins',
    threshold: 1,
    icon: 'ribbon',
    tint: TINT_WINS,
  },
  {
    id: 'tenWins',
    titleHe: '10 ניצחונות',
    descriptionHe: 'מנצח עקבי',
    category: 'wins',
    metric: 'wins',
    threshold: 10,
    icon: 'trophy-outline',
    tint: TINT_WINS,
  },
  {
    id: 'twentyFiveWins',
    titleHe: '25 ניצחונות',
    descriptionHe: 'מלך המגרש',
    category: 'wins',
    metric: 'wins',
    threshold: 25,
    icon: 'trophy',
    tint: TINT_WINS,
  },
  {
    id: 'fiftyWins',
    titleHe: '50 ניצחונות',
    descriptionHe: 'אלוף בלתי מנוצח',
    category: 'wins',
    metric: 'wins',
    threshold: 50,
    icon: 'medal',
    tint: TINT_WINS,
  },

  // ─── Teams ─────────────────────────────────────────────────────────────
  {
    id: 'createdFirstTeam',
    titleHe: 'הקמת מועדון',
    descriptionHe: 'יצרת את המועדון הראשון שלך',
    category: 'teams',
    metric: 'teamsCreated',
    threshold: 1,
    icon: 'shield-outline',
    tint: TINT_TEAMS,
  },
  {
    id: 'joinedThreeTeams',
    titleHe: 'חבר ב-3 מועדונים',
    descriptionHe: 'הצטרפת ל-3 מועדונים שונים',
    category: 'teams',
    metric: 'teamsJoined',
    threshold: 3,
    icon: 'people-outline',
    tint: TINT_TEAMS,
  },
  {
    id: 'joinedFiveTeams',
    titleHe: 'חבר ב-5 מועדונים',
    descriptionHe: 'אתה חבר ב-5 מועדונים שונים',
    category: 'teams',
    metric: 'teamsJoined',
    threshold: 5,
    icon: 'people',
    tint: TINT_TEAMS,
  },
  {
    id: 'joinedTenTeams',
    titleHe: 'חבר ב-10 מועדונים',
    descriptionHe: 'אתה חבר ב-10 מועדונים שונים',
    category: 'teams',
    metric: 'teamsJoined',
    threshold: 10,
    icon: 'people-circle',
    tint: TINT_TEAMS,
  },

  // ─── Social (friends) ────────────────────────────────────────────────────
  {
    id: 'firstFriend',
    titleHe: 'חבר ראשון',
    descriptionHe: 'הוספת את החבר הראשון שלך',
    category: 'social',
    metric: 'friendsCount',
    threshold: 1,
    icon: 'person-add-outline',
    tint: TINT_SOCIAL,
  },
  {
    id: 'fiveFriends',
    titleHe: '5 חברים',
    descriptionHe: 'יש לך 5 חברים באפליקציה',
    category: 'social',
    metric: 'friendsCount',
    threshold: 5,
    icon: 'people-outline',
    tint: TINT_SOCIAL,
  },
  {
    id: 'tenFriends',
    titleHe: '10 חברים',
    descriptionHe: 'רשת חברים מרשימה — 10 חברים',
    category: 'social',
    metric: 'friendsCount',
    threshold: 10,
    icon: 'people-circle-outline',
    tint: TINT_SOCIAL,
  },
  {
    id: 'twentyFiveFriends',
    titleHe: '25 חברים',
    descriptionHe: 'מלך החברתיות — 25 חברים',
    category: 'social',
    metric: 'friendsCount',
    threshold: 25,
    icon: 'people-circle',
    tint: TINT_SOCIAL,
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
    descriptionHe: 'מארח של המועדון',
    category: 'invites',
    metric: 'invitesSent',
    threshold: 10,
    icon: 'megaphone',
    tint: TINT_INVITES,
  },
  {
    id: 'invitedTwentyFivePlayers',
    titleHe: '25 הזמנות',
    descriptionHe: 'שגריר האפליקציה — 25 הזמנות',
    category: 'invites',
    metric: 'invitesSent',
    threshold: 25,
    icon: 'megaphone-outline',
    tint: TINT_INVITES,
  },

  // ─── Coaching ──────────────────────────────────────────────────────────
  // Titles deliberately avoid a bare "מנהל של 30" — that reads as
  // "manager of 30 communities". These count PLAYERS approved into your
  // club, so the title is evocative and the count lives in the description.
  {
    id: 'coachOf10',
    titleHe: 'מנהל מתחיל',
    descriptionHe: 'אישרת 10 שחקנים למועדון שלך',
    category: 'coaching',
    metric: 'playersCoached',
    threshold: 10,
    icon: 'ribbon-outline',
    tint: TINT_COACH,
  },
  {
    id: 'coachOf20',
    titleHe: 'מנהל מנוסה',
    descriptionHe: 'אישרת 20 שחקנים למועדון שלך',
    category: 'coaching',
    metric: 'playersCoached',
    threshold: 20,
    icon: 'ribbon',
    tint: TINT_COACH,
  },
  {
    id: 'coachOf30',
    titleHe: 'מנהל ותיק',
    descriptionHe: 'אישרת 30 שחקנים למועדון שלך',
    category: 'coaching',
    metric: 'playersCoached',
    threshold: 30,
    icon: 'trophy',
    tint: TINT_COACH,
  },
];
