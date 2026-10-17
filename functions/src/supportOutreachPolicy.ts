export interface OutreachConfig {
  enabled: boolean;
  delayHours: number;
  newUserDays: number;
  startHour: number;
  endHour: number;
  timeZone: string;
  template: string;
}
export const DEFAULT_OUTREACH: OutreachConfig = {
  enabled: false, delayHours: 24, newUserDays: 7, startHour: 9, endHour: 20,
  timeZone: 'Asia/Jerusalem',
  template: 'היי {name} 👋\nאיזה כיף שפתחת את ״{club}״! רצינו לשאול איך הולך.\n\n{focus}\nאם משהו לא ברור או שתרצה שנלווה אותך בהתחלה, אנחנו כאן בשמחה.\n\nפשוט תענה כאן, וההודעה תגיע אלינו ⚽\nצוות טימדר',
};
export function readOutreachConfig(raw: Record<string, unknown> = {}): OutreachConfig {
  const number = (key: keyof OutreachConfig, min: number, max: number) => typeof raw[key] === 'number' && Number.isFinite(raw[key]) && (raw[key] as number) >= min && (raw[key] as number) <= max ? raw[key] as number : DEFAULT_OUTREACH[key] as number;
  let timeZone = typeof raw.timeZone === 'string' ? raw.timeZone : DEFAULT_OUTREACH.timeZone;
  try { new Intl.DateTimeFormat('en', { timeZone }).format(); } catch { timeZone = DEFAULT_OUTREACH.timeZone; }
  const startHour = Math.floor(number('startHour', 0, 23)), endHour = Math.floor(number('endHour', 1, 24));
  return { enabled: raw.enabled === true, delayHours: number('delayHours', 0.1, 720), newUserDays: number('newUserDays', 0, 365),
    startHour: startHour < endHour ? startHour : 9, endHour: startHour < endHour ? endHour : 20, timeZone,
    template: typeof raw.template === 'string' && raw.template.trim() && raw.template.length <= 700 ? raw.template : DEFAULT_OUTREACH.template };
}
export function nextOutreachTime(at: number, config: OutreachConfig, userTimeZone?: string): number {
  let formatter: Intl.DateTimeFormat;
  try { formatter = new Intl.DateTimeFormat('en-GB', { timeZone: userTimeZone || config.timeZone, hour: '2-digit', hourCycle: 'h23' }); }
  catch { formatter = new Intl.DateTimeFormat('en-GB', { timeZone: config.timeZone, hour: '2-digit', hourCycle: 'h23' }); }
  for (let minutes = 0; minutes <= 48 * 60; minutes++) {
    const candidate = at + minutes * 60_000, hour = Number(formatter.format(new Date(candidate)));
    if (hour >= config.startHour && hour < config.endHour) return candidate;
  }
  throw new Error('OUTREACH_WINDOW_UNREACHABLE');
}
export function outreachEligible(userCreatedAt: number, clubCreatedAt: number, config: OutreachConfig): boolean {
  return userCreatedAt > 0 && clubCreatedAt >= userCreatedAt &&
    (config.newUserDays === 0 || clubCreatedAt - userCreatedAt <= config.newUserDays * 86400_000);
}
function clean(value: unknown, max: number): string {
  return String(value ?? '').replace(/[\u0000-\u001f\u202a-\u202e\u2066-\u2069]/g, ' ').trim().slice(0, max);
}
export function outreachText(config: OutreachConfig, name: unknown, club: unknown, players: number, hasRound: boolean): string {
  const focus = hasRound ? 'איך הולך עם המועדון והמחזור הראשון?' : players > 1 ? 'רוצה שנעזור לך לארגן את המחזור הראשון?' : 'רוצה עזרה בהזמנת החבר׳ה למועדון ובארגון המחזור הראשון?';
  const values: Record<string, string> = { name: `⁨${clean(name, 40).split(' ')[0] || 'חבר'}⁩`, club: `⁨${clean(club, 80) || 'המועדון שלך'}⁩`, focus };
  const text = config.template.replace(/\{(name|club|focus)\}/g, (_match, key) => values[key]);
  if (text.length > 1000) throw new Error('OUTREACH_TEXT_TOO_LONG');
  return text;
}
