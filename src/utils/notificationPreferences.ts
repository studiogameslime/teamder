import { defaultNotificationPrefs, type NotificationPrefs } from '@/types';

/** Private preferences override legacy values, without treating false as missing. */
export function mergeNotificationPreferences(...sources: unknown[]): NotificationPrefs {
  const merged = { ...defaultNotificationPrefs };
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue;
    const prefs = source as Record<string, unknown>;
    for (const key of Object.keys(defaultNotificationPrefs) as (keyof NotificationPrefs)[]) {
      if (typeof prefs[key] === 'boolean') merged[key] = prefs[key] as boolean;
    }
  }
  return merged;
}
