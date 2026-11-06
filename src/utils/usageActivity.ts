/** Private usage stream. Keep the server/Pulse copies byte-identical. */
import productKeys from './productActionKeys.json';
const productCatalog = new Set(productKeys);
export const isProductKey = (value: unknown): value is string => typeof value === 'string' && productCatalog.has(value);
export const USAGE_SCHEMA = 1;
export const USAGE_SCREENS: Record<string, string> = {
  Profile: 'מסך הבית', GuestHome: 'מסך הבית לאורח', GamesList: 'רשימת המחזורים', CommunitiesFeed: 'רשימת המועדונים',
  CommunityDetails: 'מועדון', CommunityDetailsPublic: 'מועדון ציבורי', CommunityStats: 'סטטיסטיקת המועדון',
  CommunityPlayers: 'שחקני המועדון', CommunityHistory: 'היסטוריית המועדון', ManagerDashboard: 'לוח המנהל',
  MatchDetails: 'מחזור', MatchPlayers: 'שחקני המחזור', MatchRounds: 'משחקי המחזור', LiveMatch: 'המחזור החי',
  PlayerCard: 'כרטיס שחקן', PlayerCompare: 'השוואת שחקנים', Statistics: 'סטטיסטיקה אישית',
  SeasonSummary: 'סיכום עונה', EveningSummary: 'סיכום מחזור', Achievements: 'הישגים', MyActivity: 'הפעילות האישית',
  PublicGroupsFeed: 'חיפוש מועדונים', Players: 'חיפוש שחקנים', History: 'היסטוריית מחזורים',
};
export const USAGE_SECTIONS: Record<string, string> = { info: 'מידע', stats: 'סטטיסטיקה', players: 'שחקנים', games: 'משחקים', history: 'היסטוריה', overview: 'סקירה', club: 'מועדון', ratings: 'ציונים', equipment: 'ציוד' };
export const USAGE_ACTIONS = ['app_opened', 'app_returned', 'screen_view', 'registration_attempt', 'registration_result', 'coverage_gap','product_action'] as const;
export type UsageAction = typeof USAGE_ACTIONS[number];
export type UsageContext = { screen?: string; section?: string; groupId?: string; gameId?: string; playerId?: string; seasonId?: string };
export type UsageEvent = UsageContext & { eventId: string; visitId: string; sequence: number; occurredAt: number; action: UsageAction; productKey?: string; operationId?: string; resultSequence?: number; result?: 'players' | 'waitlist' | 'pending' | 'failed'; platform: string; appVersion: string; schemaVersion: number };
export type LocalUsageEvent = UsageEvent & { ownerUid: string | null };
export const usageId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,140}$/.test(v);
export function usageContext(screen: string, params: unknown = {}): UsageContext {
  if (!Object.prototype.hasOwnProperty.call(USAGE_SCREENS, screen)) return {};
  const p = (params && typeof params === 'object' ? params : {}) as Record<string, unknown>;
  const out: UsageContext = { screen };
  for (const field of ['groupId', 'gameId', 'playerId', 'seasonId'] as const) if (usageId(p[field])) out[field] = p[field];
  if (screen === 'PlayerCard' && usageId(p.userId)) out.playerId = p.userId;
  if (screen === 'PlayerCompare' && usageId(p.otherUid)) out.playerId = p.otherUid;
  const initial = p.section ?? p.initialTab ?? (['CommunityDetails', 'MatchDetails'].includes(screen) ? 'info' : screen === 'ManagerDashboard' ? 'overview' : undefined);
  if (typeof initial === 'string' && Object.prototype.hasOwnProperty.call(USAGE_SECTIONS, initial)) out.section = initial;
  return out;
}
export function usageScreenKey(context: UsageContext): string {
  return JSON.stringify([context.screen, context.section, context.groupId, context.gameId, context.playerId, context.seasonId]);
}
export function validUsageEvent(raw: unknown): raw is UsageEvent {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const e = raw as UsageEvent;
  return typeof e.visitId === 'string' && /^[a-z0-9-]{10,80}$/.test(e.visitId)
    && Number.isSafeInteger(e.sequence) && e.sequence > 0 && e.sequence <= 10_000_000
    && e.eventId === `${e.visitId}-${e.sequence}` && Number.isSafeInteger(e.occurredAt) && e.occurredAt > 0 && e.occurredAt <= 8_640_000_000_000_000
    && USAGE_ACTIONS.includes(e.action) && e.schemaVersion === USAGE_SCHEMA
    && ['android', 'ios', 'web', 'unknown'].includes(e.platform)
    && typeof e.appVersion === 'string' && /^[\w.-]{1,40}$/.test(e.appVersion)
    && (e.screen === undefined || Object.prototype.hasOwnProperty.call(USAGE_SCREENS, e.screen))
    && (e.section === undefined || Object.prototype.hasOwnProperty.call(USAGE_SECTIONS, e.section))
    && ['groupId', 'gameId', 'playerId', 'seasonId', 'operationId'].every(k => (e as any)[k] === undefined || usageId((e as any)[k]))
    && (e.action !== 'screen_view' || !!e.screen)
    && (e.action === 'product_action'
      ? isProductKey(e.productKey) && ['screen','section','groupId','gameId','playerId','seasonId','operationId','resultSequence','result'].every(k => (e as any)[k] === undefined)
      : e.productKey === undefined)
    && (!e.action.startsWith('registration_') || (!!e.gameId && !!e.operationId))
    && (e.result === undefined || ['players', 'waitlist', 'pending', 'failed'].includes(e.result))
    && (e.resultSequence === undefined || (Number.isSafeInteger(e.resultSequence) && e.resultSequence > e.sequence && e.resultSequence <= 10_000_000))
    && (e.action !== 'registration_attempt' || e.resultSequence === e.sequence + 1)
    && (e.action !== 'registration_result' || ['players', 'waitlist', 'pending', 'failed'].includes(e.result ?? ''));
}
/** Construct a closed payload; never forward names, free text, auth claims or analytics params. */
export function usageWire(e: UsageEvent): UsageEvent {
  const out: UsageEvent = { eventId: e.eventId, visitId: e.visitId, sequence: e.sequence, occurredAt: e.occurredAt, action: e.action, platform: e.platform, appVersion: e.appVersion, schemaVersion: e.schemaVersion };
  for (const field of ['screen', 'section', 'groupId', 'gameId', 'playerId', 'seasonId', 'operationId', 'resultSequence', 'result','productKey'] as const) if (e[field] !== undefined) (out as any)[field] = e[field];
  return out;
}
export function usageLabel(e: UsageContext & { action: string; result?: string; labelSnapshot?: string; uid?: string; registrationState?: string }): string {
  if (e.action === 'product_action') return 'ביצע פעולה באפליקציה';
  if (e.action === 'app_opened') return 'פתח את האפליקציה';
  if (e.action === 'app_returned') return 'חזר לאפליקציה';
  if (e.action === 'coverage_gap') return 'חלק מהתיעוד לא נשמר';
  if (e.action === 'registration_attempt') return 'שלח בקשת הרשמה למחזור';
  if (e.action === 'registration_result' && e.registrationState && e.registrationState !== 'created' && e.result !== 'failed') return ({ players: 'המשתמש רשום למחזור לפי השרת', waitlist: 'המשתמש ברשימת ההמתנה לפי השרת', pending: 'בקשת ההרשמה ממתינה לאישור' } as Record<string, string>)[e.result ?? ''] ?? 'מצב ההרשמה אינו ידוע';
  if (e.action === 'registration_result') return ({ players: 'ההרשמה למחזור אושרה', waitlist: 'נכנס לרשימת ההמתנה למחזור', pending: 'בקשת ההרשמה ממתינה לאישור', failed: 'ניסיון ההרשמה לא הושלם' } as Record<string, string>)[e.result ?? ''] ?? 'תוצאת ההרשמה אינה זמינה';
  if (e.screen === 'PlayerCard' && e.uid && e.playerId === e.uid) return 'פתח את כרטיס השחקן האישי שלו';
  const title = e.section && e.section !== 'info' ? USAGE_SECTIONS[e.section] : USAGE_SCREENS[e.screen ?? ''];
  return `פתח ${title ?? 'מסך'}${e.labelSnapshot ? `: \u2068${e.labelSnapshot}\u2069` : ''}`;
}
