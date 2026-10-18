import { activityLabel } from './onboardingActivityCatalog';

type Activity = { action: string; actorName?: string; anonymous?: boolean; params?: Record<string, unknown>; guestNumber?: number; previousIntent?: string; inviterName?: string };
/** Notification copy only; identity comes from the server profile/snapshot. */
const text = (value: unknown, max = 60): string => typeof value === 'string'
  ? value.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
const isolate = (value: string) => `\u2068${value}\u2069`;
const channels: Record<string,string> = {whatsapp:'ווטסאפ',facebook:'פייסבוק',instagram:'אינסטגרם',telegram:'טלגרם',sms:'מסרון'};
const methods: Record<string,string> = {google:'גוגל',apple:'אפל',email:'דואר אלקטרוני',password:'דואר אלקטרוני'};

export function onboardingPushContent(event: Activity, user?: Record<string, unknown>): {title: string; body: string} {
  const p = event.params ?? {};
  const name = [user?.name, user?.displayName, event.actorName].map(v=>text(v)).find(v=>v && !['אורח','שחקן'].includes(v));
  // A restored account without a profile name is not an anonymous guest.
  const guest = typeof p.is_guest === 'boolean' ? p.is_guest : event.anonymous === true;
  const numberedGuest = Number.isSafeInteger(event.guestNumber) && Number(event.guestNumber) > 0 ? `אורח ${event.guestNumber}` : undefined;
  const who = name ? `${isolate(name)}${numberedGuest ? ` (${numberedGuest})` : ''}`
    : guest ? numberedGuest ?? 'אורח' : `משתמש מחובר ללא שם${numberedGuest ? ` (${numberedGuest})` : ''}`;
  const authenticated = ['auth_completed','sign_in_success'].includes(event.action);
  const intents: Record<string, string> = { create_club: 'הקמת מועדון', find_game: 'מציאת משחק', one_off_game: 'יצירת מחזור חד־פעמי', invite: 'המשך דרך ההזמנה' };
  const changed = event.action === 'entry_intent_selected' && event.previousIntent && intents[event.previousIntent] && intents[String(p.intent)] && event.previousIntent !== p.intent;
  const method = methods[String(p.auth_method ?? p.method ?? '')];
  const summary = event.action === 'entry_source_resolved' ? 'פתח את האפליקציה'
    : changed ? `שינה בחירה: מ־${isolate(intents[event.previousIntent!])} ל־${isolate(intents[String(p.intent)])}`
    : event.action === 'auth_prompt_shown' ? 'פתח את תהליך ההרשמה או ההתחברות'
    : authenticated ? `התחבר לחשבון${method ? ` באמצעות ${method}` : ''}`
    : activityLabel(event.action, p);
  const sources: Record<string,string> = {
    organic:'פתיחה רגילה', club_link:'קישור למועדון', game_link:'קישור למחזור', personal_invite:p.has_inviter === true ? 'הזמנה אישית לאפליקציה' : 'קישור לאפליקציה',
  };
  // Missing inviter does not turn a valid club/round link into an organic entry.
  const source = sources[String(p.entry_source)] ?? 'מקור כניסה לא ידוע';
  const channel = text(p.entry_channel);
  const campaign = text(p.entry_campaign);
  const details = [`מקור: ${source}`];
  const inviter = text(event.inviterName);
  if (inviter) details.push(`דרך ${isolate(inviter)}`);
  else if (p.has_inviter === true || p.inviter_uid) details.push('המזמין טרם זוהה');
  // Never show arbitrary URLs/contact details as a distribution channel.
  if(channel && !/https?:|@|\+?\d[\d -]{6,}/i.test(channel)) details.push(`ערוץ: ${isolate(channels[channel.toLowerCase()] ?? channel)}`);
  if(campaign && !/https?:|@/i.test(campaign)) details.push(`קמפיין: ${isolate(campaign)}`);
  return {
    title: authenticated ? 'התחברות לחשבון' : changed ? 'שינוי בחירה' : event.action === 'entry_source_resolved' ? 'כניסה לאפליקציה' : 'תהליך ההצטרפות',
    body: `${who}: ${summary}\n${details.join(' · ')}`,
  };
}
