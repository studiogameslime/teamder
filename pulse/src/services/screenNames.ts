// screenNames — friendly Hebrew labels for the app's navigation route names
// (the raw `screen` field on a feedback/report doc, e.g. "MatchDetails"). Used
// by the QA reports screen so reports read in Hebrew instead of code names.

const SCREEN_HE: Record<string, string> = {
  Achievements: 'הישגים',
  AdminApproval: 'אישור חברים',
  AvailablePlayers: 'שחקנים זמינים',
  CommunitiesCreate: 'יצירת מועדון',
  CommunitiesFeed: 'מועדונים',
  CommunitiesMap: 'מפת מועדונים',
  CommunityDetails: 'פרטי מועדון',
  CommunityEdit: 'עריכת מועדון',
  DraftBoard: 'חלוקת כוחות',
  DraftSetup: 'הגדרת חלוקת כוחות',
  Feedback: 'דיווח / משוב',
  Friends: 'חברים',
  GameCreate: 'יצירת משחק',
  GameEdit: 'עריכת משחק',
  GamesList: 'רשימת משחקים',
  GamesMap: 'מפת משחקים',
  History: 'היסטוריה',
  LiveMatch: 'משחק חי (טיימר)',
  MatchDetails: 'פרטי משחק',
  MatchManage: 'ניהול משחק',
  MatchPlayers: 'שחקני המשחק',
  NotificationsSettings: 'הגדרות התראות',
  PlayerCard: 'כרטיס שחקן',
  Profile: 'פרופיל',
  ProfileEdit: 'עריכת פרופיל',
  ProfileSetup: 'הגדרת פרופיל',
  PromoteOrphan: 'קידום משחק',
  Referrals: 'הפניות',
  SignIn: 'התחברות',
  Stats: 'סטטיסטיקות',
};

/** Hebrew label for a route name; falls back to the raw name when unmapped. */
export function screenHe(name?: string): string {
  if (!name) return 'מסך לא ידוע';
  return SCREEN_HE[name] ?? name;
}
