// Local history of every notification Pulse shows — so missed pushes are
// recoverable on a dedicated screen. Persisted to AsyncStorage (capped).
//
// Captured from two places:
//   • notify() (local notifications — reviews, new users, quota), which runs
//     even from the background poller task.
//   • a foreground notification-received listener (remote admin-alert pushes:
//     game/community created & joined).
// A short same-content dedupe window stops a local notification that triggers
// both paths from being logged twice.

import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'notifLog';
const MAX = 120;
const DEDUPE_MS = 4000;

export interface NotifLogEntry {
  id: string;
  title: string;
  body: string;
  at: number; // ms epoch
  kind?: string; // data.type / data.kind when present
  eventId?: string;
  sessionId?: string;
}

let pendingWrite: Promise<void> = Promise.resolve();
export function logNotification(title: string, body: string, data?: Record<string, unknown>): Promise<void> {
  const append = () => appendNotification(title, body, data);
  pendingWrite = pendingWrite.then(append, append);
  return pendingWrite;
}

async function appendNotification(
  title: string,
  body: string,
  data?: Record<string, unknown>,
): Promise<void> {
  try {
    const list = await getNotificationLog();
    const now = Date.now();
    // Skip an identical notification logged moments ago (local + listener
    // double-fire).
    const recent = list[0];
    const eventId = typeof data?.eventId === 'string' ? data.eventId : undefined;
    const sessionId = typeof data?.sessionId === 'string' ? data.sessionId : undefined;
    if (eventId ? list.some(entry => entry.eventId === eventId) : recent && recent.title === title && recent.body === body && now - recent.at < DEDUPE_MS) {
      return;
    }
    const kind =
      typeof data?.type === 'string'
        ? data.type
        : typeof data?.kind === 'string'
          ? data.kind
          : undefined;
    list.unshift({ id: `n_${now}_${Math.floor(Math.random() * 1000)}`, title, body, at: now, kind, eventId, sessionId });
    await AsyncStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch {
    /* non-fatal */
  }
}

export async function getNotificationLog(): Promise<NotifLogEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as NotifLogEntry[]) : [];
  } catch {
    return [];
  }
}

export async function clearNotificationLog(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    /* non-fatal */
  }
}
