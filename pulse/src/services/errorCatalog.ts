// Turns a raw error record from the app's `errors` collection into a
// friendly, human-readable Hebrew view for the panel — WHAT happened,
// WHERE, WHY, and WHAT the user was trying to do — while keeping all the
// technical fields available for drill-down.
//
// The app now writes `title` + `category` onto each doc (self-describing),
// but this catalog also derives them so older docs (or any the app didn't
// label) still render nicely.

import { colors } from '../theme';
import type { ErrorRecord } from '../types';

export type ErrCategory = 'silent' | 'crash' | 'action' | 'report' | 'suggestion' | 'qa';

// Operation → friendly Hebrew "what happened" (mirrors the app catalog so
// pre-label docs read well too).
const OP_TITLES: Record<string, string> = {
  signInGoogle: 'התחברות עם Google נכשלה',
  signInGoogleScreen: 'התחברות עם Google נכשלה',
  signInApple: 'התחברות עם Apple נכשלה',
  signInAppleScreen: 'התחברות עם Apple נכשלה',
  signOut: 'התנתקות נכשלה',
  deleteAccount: 'מחיקת חשבון נכשלה',
  createUserDoc: 'יצירת פרופיל משתמש נכשלה',
  completeOnboarding: 'סיום ההרשמה נכשל',
  updateProfile: 'עדכון פרופיל נכשל',
  saveAvailability: 'שמירת זמינות נכשלה',
  createGame: 'יצירת משחק נכשלה',
  joinGame: 'הצטרפות למשחק נכשלה',
  cancelGame: 'ביטול הרשמה למשחק נכשל',
  leaveGame: 'עזיבת משחק נכשלה',
  approveGameJoin: 'אישור הצטרפות למשחק נכשל',
  rejectGameJoin: 'דחיית הצטרפות למשחק נכשלה',
  confirmSpotOffer: 'אישור הצעת מקום נכשל',
  passSpotOffer: 'העברת הצעת מקום נכשלה',
  reloadGamesList: 'טעינת רשימת המשחקים נכשלה',
  gamesListAction: 'פעולה ברשימת המשחקים נכשלה',
  getMyGames: 'טעינת "המשחקים שלי" נכשלה',
  getOpenGames: 'טעינת משחקים פתוחים נכשלה',
  getCommunityGames: 'טעינת משחקי הקהילה נכשלה',
  addGuest: 'הוספת אורח למשחק נכשלה',
  inviteToGame: 'הזמנה למשחק נכשלה',
  createGroup: 'יצירת קהילה נכשלה',
  joinGroup: 'הצטרפות לקהילה נכשלה',
  leaveGroup: 'עזיבת קהילה נכשלה',
  removeMember: 'הסרת חבר מהקהילה נכשלה',
  approveMember: 'אישור חבר בקהילה נכשל',
  rejectMember: 'דחיית חבר בקהילה נכשלה',
  inviteFriendsToGroup: 'הזמנת חברים לקהילה נכשלה',
  updateGroupMetadata: 'עדכון פרטי הקהילה נכשל',
  ratePlayer: 'דירוג שחקן נכשל',
  registerDeviceToken: 'רישום להתראות נכשל',
  requestAndRegisterPushToken: 'בקשת הרשאת התראות נכשלה',
  saveNotificationPreferences: 'שמירת העדפות התראות נכשלה',
  gameVanishedAfterJoin: 'משחק נעלם אחרי שהמשתמש נרשם אליו',
  joinNotReflectedInMatch: 'ההרשמה למשחק לא הופיעה במסך',
  communityJoinNotReflected: 'ההצטרפות לקהילה לא הופיעה',
  joinDidNotAddUser: 'הרשמה למשחק לא הוסיפה את המשתמש',
  cancelDidNotRemoveUser: 'ביטול הרשמה לא הסיר את המשתמש',
  joinGroupDidNotApply: 'הצטרפות לקהילה לא נשמרה',
  leaveGroupDidNotRemoveUser: 'עזיבת קהילה לא הסירה את המשתמש',
  removeMemberDidNotApply: 'הסרת חבר לא נשמרה',
  createGameCreatorNotRegistered: 'יוצר המשחק לא נרשם אוטומטית',
  uncaught: 'קריסה לא צפויה באפליקציה',
  uncaughtRender: 'שגיאת תצוגה — מסך קרס',
  unhandledRejection: 'שגיאה אסינכרונית לא מטופלת',
  // user-submitted feedback
  userBugReport: 'דיווח על תקלה ממשתמש',
  userSuggestion: 'הצעה לפיצר ממשתמש',
};

// Screen id → Hebrew name (the "where").
const SCREEN_LABELS: Record<string, string> = {
  SignInScreen: 'מסך התחברות',
  GamesListScreen: 'רשימת המשחקים',
  MatchDetailsScreen: 'פרטי משחק',
  MatchManageScreen: 'ניהול משחק',
  MatchPlayersScreen: 'שחקני המשחק',
  GameCreateScreen: 'יצירת משחק',
  GameEditScreen: 'עריכת משחק',
  AvailablePlayersScreen: 'שחקנים פנויים',
  CommunityDetailsScreen: 'פרטי קהילה',
  CommunityDetailsPublicScreen: 'קהילה ציבורית',
  CommunityEditScreen: 'עריכת קהילה',
  CommunityPlayersScreen: 'חברי הקהילה',
  PublicGroupsFeedScreen: 'גילוי קהילות',
  CreateGroupScreen: 'יצירת קהילה',
  AdminApprovalScreen: 'אישור חברים',
  ProfileEditScreen: 'עריכת פרופיל',
  ProfileScreen: 'פרופיל',
  AvailabilityEditScreen: 'עריכת זמינות',
  ReferralsListScreen: 'מי הצטרף דרכי',
  NotificationsSettingsScreen: 'הגדרות התראות',
  PromoteOrphanScreen: 'הפיכת משחק לקהילה',
  LiveMatchScreen: 'משחק חי',
};

const CRASH_OPS = new Set(['uncaught', 'uncaughtRender', 'unhandledRejection']);

// Context key → Hebrew label, for the "what was attempted" panel.
const CTX_LABELS: Record<string, string> = {
  gameId: 'מזהה משחק',
  groupId: 'מזהה קהילה',
  userId: 'מזהה משתמש',
  targetUserId: 'משתמש יעד',
  recipientId: 'נמען',
  inviterId: 'מזמין',
  cta: 'כפתור',
  isOrphanContext: 'משחק אישי (orphan)',
  visibility: 'נראות',
  status: 'סטטוס',
  provider: 'ספק התחברות',
  code: 'קוד שגיאה',
  where: 'מיקום',
  requiresApproval: 'דורש אישור',
  occupancy: 'תפוסה',
  maxPlayers: 'מקס׳ שחקנים',
  minPlayers: 'מינ׳ שחקנים',
  pullToRefresh: 'רענון ידני',
  reason: 'סיבה',
  viaCode: 'דרך קוד הזמנה',
  createdBy: 'נוצר ע״י',
  title: 'כותרת',
  userName: 'מאת (משתמש)',
};
const CTX_SKIP = new Set(['silent', 'screen', 'componentStack']);

const CAT_META: Record<ErrCategory, { label: string; emoji: string; color: string }> = {
  silent: { label: 'לא עבד כצפוי', emoji: '⚠️', color: colors.amber },
  crash: { label: 'קריסה', emoji: '💥', color: colors.red },
  action: { label: 'פעולה נכשלה', emoji: '❌', color: colors.red },
  report: { label: 'דיווח תקלה ממשתמש', emoji: '🐛', color: colors.primary },
  suggestion: { label: 'הצעת פיצר ממשתמש', emoji: '💡', color: colors.green },
  qa: { label: 'ממצא בדיקת QA', emoji: '🔍', color: colors.amber },
};

function categoryOf(e: ErrorRecord): ErrCategory {
  // Only trust an app-written category we actually know how to render.
  // A category the app adds later (not yet in CAT_META) must NOT reach the
  // unconditional CAT_META[cat] lookups below — that would read .label of
  // undefined and crash the whole Errors screen on a single unknown doc.
  if (e.category && e.category in CAT_META) return e.category;
  if (e.context?.silent === true) return 'silent';
  if (CRASH_OPS.has(e.operation)) return 'crash';
  return 'action';
}

function humanizeWhy(e: ErrorRecord, cat: ErrCategory): string {
  const msg = e.message ?? '';
  // Feedback + QA findings: the written description IS the content.
  if (cat === 'report' || cat === 'suggestion' || cat === 'qa') return msg || '—';
  const code = (e.code ?? '').toLowerCase();
  const low = msg.toLowerCase();
  if (e.context?.silent === true) return 'הפעולה הסתיימה בלי שגיאה, אבל התוצאה לא הייתה כצפוי';
  if (code.includes('permission') || low.includes('permission')) return 'אין הרשאה (permission-denied)';
  if (code.includes('unauthenticated') || low.includes('unauthenticated')) return 'המשתמש לא מחובר';
  if (code.includes('unavailable') || low.includes('unavailable')) return 'השירות אינו זמין כרגע';
  if (code.includes('network') || low.includes('network')) return 'בעיית רשת / אין חיבור';
  if (code.includes('not-found') || low.includes('not found')) return 'הפריט לא נמצא';
  if (code.includes('deadline') || low.includes('timeout')) return 'הבקשה לקחה יותר מדי זמן';
  if (code.includes('already-exists')) return 'כבר קיים';
  if (code.includes('resource-exhausted')) return 'חריגה ממכסה';
  if (code.includes('cancel')) return 'בוטל';
  return msg || 'סיבה לא ידועה';
}

export interface ErrorView {
  title: string;
  category: ErrCategory;
  catLabel: string;
  catEmoji: string;
  catColor: string;
  whereLabel?: string; // Hebrew screen name
  whereRaw?: string; // raw screen id
  operation: string;
  why: string;
  attempted: { label: string; value: string }[];
}

export function describeError(e: ErrorRecord): ErrorView {
  const cat = categoryOf(e);
  const title =
    e.title || OP_TITLES[e.operation] || `${CAT_META[cat].label} · ${e.operation}`;
  const attempted: { label: string; value: string }[] = [];
  for (const [k, v] of Object.entries(e.context ?? {})) {
    if (CTX_SKIP.has(k) || v == null || v === '') continue;
    attempted.push({
      label: CTX_LABELS[k] ?? k,
      value: typeof v === 'object' ? JSON.stringify(v) : String(v),
    });
  }
  return {
    title,
    category: cat,
    catLabel: CAT_META[cat].label,
    catEmoji: CAT_META[cat].emoji,
    catColor: CAT_META[cat].color,
    whereLabel: e.screen ? SCREEN_LABELS[e.screen] : undefined,
    whereRaw: e.screen,
    operation: e.operation,
    why: humanizeWhy(e, cat),
    attempted,
  };
}
