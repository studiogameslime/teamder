// Per-type push toggles. Stored in Firestore (adminConfig/prefs) so the
// server-side Cloud Functions filter BEFORE sending — a toggle works even
// when Pulse is closed. Default (missing) = on.

import { getDoc, patchDoc } from './firestoreRest';

export interface NotifTypeDef {
  key: string;
  label: string;
  emoji: string;
  hint?: string;
}

export const NOTIF_TYPES: NotifTypeDef[] = [
  { key: 'newUser', label: 'משתמש חדש נרשם', emoji: '🎉' },
  { key: 'gameCreate', label: 'מישהו יצר משחק', emoji: '⚽' },
  { key: 'gameJoin', label: 'מישהו נרשם למשחק', emoji: '🙋' },
  { key: 'communityCreate', label: 'מישהו יצר קהילה', emoji: '🏟️' },
  { key: 'communityJoin', label: 'מישהו הצטרף לקהילה', emoji: '👥' },
  { key: 'availabilityUpdate', label: 'מישהו עדכן זמינות', emoji: '🗓️' },
  {
    key: 'review',
    label: 'ביקורות ודירוגים',
    emoji: '⭐',
    hint: 'רק עם טקסט — החנויות לא חושפות דירוג ללא טקסט',
  },
  { key: 'error', label: 'שגיאות וקריסות חדשות', emoji: '💥' },
  { key: 'bug', label: 'דיווחי תקלות ממשתמשים', emoji: '🐛' },
  { key: 'suggestion', label: 'רעיונות לפיצ׳רים', emoji: '💡' },
];

export type NotifPrefs = Record<string, boolean>;

export async function fetchNotifPrefs(): Promise<NotifPrefs> {
  const doc = await getDoc('adminConfig/prefs').catch(() => null);
  const prefs: NotifPrefs = {};
  for (const t of NOTIF_TYPES) prefs[t.key] = doc?.[t.key] !== false; // default on
  return prefs;
}

export function setNotifPref(key: string, value: boolean): Promise<boolean> {
  return patchDoc('adminConfig/prefs', { [key]: value });
}
