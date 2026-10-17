import { getDoc, patchDoc, queryCollectionRecent } from './firestoreRest';
export interface OutreachSettings {
  enabled: boolean; delayHours: number; newUserDays: number;
  startHour: number; endHour: number; timeZone: string; template: string;
}
export const OUTREACH_DEFAULTS: OutreachSettings = {
  enabled: false, delayHours: 24, newUserDays: 7, startHour: 9, endHour: 20, timeZone: 'Asia/Jerusalem',
  template: 'היי {name} 👋\nאיזה כיף שפתחת את ״{club}״! רצינו לשאול איך הולך.\n\n{focus}\nאם משהו לא ברור או שתרצה שנלווה אותך בהתחלה, אנחנו כאן בשמחה.\n\nפשוט תענה כאן, וההודעה תגיע אלינו ⚽\nצוות טימדר',
};
export function validateOutreachSettings(settings: OutreachSettings): string | null {
  if (!Number.isFinite(settings.delayHours) || settings.delayHours < 0.1 || settings.delayHours > 720) return 'זמן ההמתנה חייב להיות בין 0.1 ל־720 שעות';
  if (!Number.isFinite(settings.newUserDays) || settings.newUserDays < 0 || settings.newUserDays > 365) return 'חלון משתמש חדש חייב להיות בין 0 ל־365 ימים';
  if (!Number.isInteger(settings.startHour) || !Number.isInteger(settings.endHour) || settings.startHour < 0 || settings.endHour > 24 || settings.startHour >= settings.endHour) return 'יש לבחור שעות שליחה תקינות, מתחילה ועד סיום';
  try { new Intl.DateTimeFormat('en', { timeZone: settings.timeZone }).format(); } catch { return 'אזור הזמן אינו תקין'; }
  if (!settings.template.trim() || settings.template.length > 700) return 'ההודעה חייבת להכיל בין 1 ל־700 תווים';
  return null;
}
export async function getOutreachSettings(): Promise<OutreachSettings> {
  const doc = await getDoc('adminConfig/supportOutreach');
  return { ...OUTREACH_DEFAULTS, ...doc } as OutreachSettings;
}
export async function saveOutreachSettings(settings: OutreachSettings): Promise<void> {
  const error = validateOutreachSettings(settings);
  if (error) throw new Error(error);
  const { enabled, delayHours, newUserDays, startHour, endHour, timeZone, template } = settings;
  if (!await patchDoc('adminConfig/supportOutreach', { enabled, delayHours, newUserDays, startHour, endHour, timeZone, template, updatedAt: Date.now() })) throw new Error('שמירת ההגדרות נכשלה');
}
export interface OutreachJob {
  id: string; userId: string; userName: string; clubName: string; status: string;
  createdAt: number; scheduledAt?: number; sentAt?: number; repliedAt?: number; reason?: string;
}
export async function getOutreachJobs(): Promise<OutreachJob[]> {
  return await queryCollectionRecent('supportOutreach', 20) as OutreachJob[];
}
