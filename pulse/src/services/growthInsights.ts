import { didEveningHappen, eveningPlayState, type PlayableEvening } from './eveningPlayed';
import type { FsDoc } from './firestoreRest';

export const GROWTH_DAY = 86400000;
export const ids = (value: unknown): string[] => Array.isArray(value)
  ? value.flatMap(v => typeof v === 'string' ? [v] : v && typeof v === 'object' && typeof v.userId === 'string' ? [v.userId] : []) : [];
export const millis = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
export const text = (value: unknown, fallback = ''): string => typeof value === 'string' && value.trim() ? value : fallback;
export const isClubGroup = (group: FsDoc): boolean => group.isPersonal !== true;
export type GrowthCollection = 'users' | 'groups' | 'games';
export interface GrowthSource { rows: FsDoc[]; limited: boolean; at: number }
export interface GrowthData {
  users: GrowthSource | null; groups: GrowthSource | null; games: GrowthSource | null;
  failed: GrowthCollection[]; at: number;
}
export interface PersonInsight { user: FsDoc; stage: string; summary: string; next: string; follow: boolean; source: string; groups: FsDoc[]; pending: FsDoc[]; games: FsDoc[]; partial: boolean }
export function personSource(user: FsDoc, users: FsDoc[]): string {
  const attribution = user.entryAttribution ?? user.entrySource ?? {};
  const campaign = text(attribution.campaign) || text(attribution.channel) || text(user.acquisition?.campaign) || text(user.acquisition?.source);
  if (campaign) return campaign;
  if (typeof user.invitedBy === 'string') {
    const inviter = users.find(u => u.id === user.invitedBy);
    return inviter ? `הזמנה של ${text(inviter.name, 'משתמש')}` : 'הגיע דרך הזמנה אישית';
  }
  if (attribution.entrySource === 'organic') return 'כניסה ללא הזמנה';
  return 'מקור הגעה לא תועד';
}
export function personInsight(user: FsDoc, data: GrowthData, now: number): PersonInsight {
  const groups = (data.groups?.rows ?? []).filter(g => isClubGroup(g) && [...ids(g.playerIds), ...ids(g.adminIds)].includes(user.id));
  const pending = (data.groups?.rows ?? []).filter(g => isClubGroup(g) && ids(g.pendingPlayerIds).includes(user.id));
  const games = (data.games?.rows ?? []).filter(g => ids(g.players).includes(user.id) && g.status !== 'cancelled');
  const managed = groups.filter(g => g.creatorId === user.id || ids(g.adminIds).includes(user.id));
  const partial = !data.groups || !data.games || data.groups.limited || data.games.limited;
  let stage = 'בתחילת הדרך';
  let summary = 'החשבון נוצר. עדיין אין מספיק מידע כדי לדעת מה הצעד הבא שלו.';
  let next = 'אפשר לשאול מה הוא מחפש באפליקציה, בלי להניח שנתקל בתקלה.';
  let follow = false;
  if (millis(user.stats?.attended) > 0) {
    stage = 'נרשמה השתתפות'; summary = 'בנתוני החשבון נרשמה השתתפות במחזור. אפשר לבדוק איך הייתה החוויה הראשונה.';
    next = 'אפשר לשאול מה עבד היטב ומה היה חסר בדרך למגרש.';
  } else if (managed.length) {
    stage = 'מארגן מועדון'; summary = managed.length === 1 ? 'מנהל מועדון אחד מתוך המידע שנטען.' : `מנהל ${managed.length} מועדונים מתוך המידע שנטען.`;
    const opened = data.games?.rows.filter(g => g.createdBy === user.id) ?? [];
    next = opened.length ? 'אפשר לברר איך מתקדמת ההרשמה למחזור שפתח.' : 'כדאי לבדוק אם הוא צריך עזרה בפתיחת המחזור הראשון.';
    follow = !partial && !opened.length;
  } else if (games.length) {
    stage = 'רשום למחזור'; summary = `נמצאה הרשמה ל${games.length === 1 ? 'מחזור אחד' : `־${games.length} מחזורים`} במידע שנטען. הרשמה אינה הוכחה להשתתפות.`;
    next = 'אפשר לוודא שהבין מתי ואיפה משחקים ומה מצב ההרשמה.';
  } else if (pending.length) {
    stage = 'ממתין לאישור'; summary = `בקשת ההצטרפות שלו ממתינה במועדון ${text(pending[0].name, 'ללא שם')}.`;
    next = 'כדאי לבדוק עם מנהל המועדון אם ראה את הבקשה. אין כרגע הוכחה שהמשתמש נכשל.'; follow = true;
  } else if (groups.length) {
    stage = 'הצטרף למועדון'; summary = `חבר במועדון ${text(groups[0].name, 'ללא שם')}. לא נמצאה הרשמה למחזור במידע שנטען.`;
    next = 'אפשר לבדוק אם יש במועדון מחזור מתאים ולהציע עזרה בהרשמה.';
    follow = !partial;
  } else if (!partial) {
    stage = user.onboardingCompleted === true ? 'מחפש איפה לשחק' : 'חשבון חדש';
    summary = 'לא נמצאה חברות במועדון או הרשמה למחזור במידע שנטען. הסיבה לכך אינה ידועה.';
    follow = millis(user.createdAt) > 0 && now - millis(user.createdAt) >= 2 * GROWTH_DAY;
  }
  return { user, stage, summary, next, follow, source: personSource(user, data.users?.rows ?? []), groups, pending, games, partial };
}

export interface ClubInsight { group: FsDoc; members: string[]; managers: string[]; games: FsDoc[]; played: FsDoc[]; upcoming: FsDoc[]; unverified: FsDoc[]; stage: string; next: string; partial: boolean; recruiters: { id: string; count: number }[]; creators: { id: string; count: number }[] }
export function clubInsight(group: FsDoc, data: GrowthData, now: number): ClubInsight {
  const members = [...new Set([...ids(group.playerIds), ...ids(group.adminIds)])];
  const managers = [...new Set(ids(group.adminIds))];
  const games = (data.games?.rows ?? []).filter(g => g.groupId === group.id).sort((a,b) => millis(b.startsAt) - millis(a.startsAt));
  const played = games.filter(g => millis(g.startsAt) >= now - 30 * GROWTH_DAY && millis(g.startsAt) <= now && didEveningHappen(g as FsDoc & PlayableEvening));
  const upcoming = games.filter(g => millis(g.startsAt) > now && ['open','locked','live'].includes(g.status)).sort((a,b) => millis(a.startsAt)-millis(b.startsAt));
  const unverified = games.filter(g => eveningPlayState(g as FsDoc & PlayableEvening) === 'unverified');
  const partial = !data.games || data.games.limited;
  const historical = games.some(g => didEveningHappen(g as FsDoc & PlayableEvening));
  const stage = !data.games ? 'פעילות לא נטענה' : played.length ? 'משחקים בפועל' : upcoming.length ? 'מתכוננים למחזור' : partial ? 'לא נמצאה פעילות בחלון' : historical ? 'ללא מחזור ב־30 יום' : 'מתארגנים להתחלה';
  const next = !data.games ? 'צריך לטעון את המחזורים לפני שמסיקים מסקנה על הפעילות.' : ids(group.pendingPlayerIds).length ? 'יש בקשות הצטרפות שממתינות למנהל. כדאי לוודא שראה אותן.' : upcoming.length ? 'אפשר לבדוק עם המארגן איך מתקדמת ההרשמה למחזור הקרוב.' : played.length ? 'המועדון שיחק לאחרונה. אפשר לבדוק אם המארגן מתכנן מחזור נוסף.' : 'אפשר לברר עם המארגן אם חסרים שחקנים או עזרה בפתיחת מחזור.';
  const counts = (values: string[]) => [...values.reduce((m,id)=>m.set(id,(m.get(id)??0)+1),new Map<string,number>())].map(([id,count])=>({id,count})).sort((a,b)=>b.count-a.count || a.id.localeCompare(b.id));
  const referrals = (data.users?.rows ?? []).filter(u => members.includes(u.id) && u.invitedByType === 'team' && u.invitedByTargetId === group.id && typeof u.invitedBy === 'string');
  return {group,members,managers,games,played,upcoming,unverified,stage,next,partial,recruiters:counts(referrals.map(u=>u.invitedBy)),creators:counts(games.flatMap(g=>typeof g.createdBy==='string'?[g.createdBy]:[]))};
}

export interface JourneySession { id: string; rows: FsDoc[]; at: number }
export function journeySessions(rows: FsDoc[], uid: string): JourneySession[] {
  const sessions = new Map<string, FsDoc[]>();
  for (const row of rows) {
    // Identity is explicit. Never merge a different user's record by matching a name or device.
    if (row.uid !== uid || typeof row.sessionId !== 'string') continue;
    const group = sessions.get(row.sessionId) ?? []; group.push(row); sessions.set(row.sessionId,group);
  }
  return [...sessions].map(([id,entries])=>({id,rows:entries.sort((a,b)=>millis(a.occurredAt)-millis(b.occurredAt) || Number(a.sequence??0)-Number(b.sequence??0)),at:Math.max(...entries.map(e=>millis(e.occurredAt)))})).sort((a,b)=>b.at-a.at);
}
