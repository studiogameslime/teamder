// Persist only supported, unresolved short URLs; never invent a target offline.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import { parseInviteUrl, resolveInviteUrl } from './deepLinkService';
import { receivePendingInvite } from './pendingAction';
import { storage, type PendingInvite } from './storage';

const KEY = 'footy.invite.unresolved';
const SHORT = /^https:\/\/(teamderfc\.web\.app|teamderfc\.firebaseapp\.com)\/i\/[A-Za-z0-9_-]{1,80}(?:[?#].*)?$/;
function isResolvableShort(url: string): boolean {
  if (SHORT.test(url)) return true;
  try {
    const u = new URL(url);
    return ['teamderfc.web.app', 'teamderfc.firebaseapp.com'].includes(u.hostname) && u.protocol === 'https:' && ['/app', '/go'].includes(u.pathname) && /^[A-Za-z0-9_-]{1,80}$/.test(u.searchParams.get('code') ?? '');
  } catch { return false; }
}
let revision = 0;
let resolving = 0;
const failureListeners = new Set<() => void>();
let writes: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const next = writes.then(fn, fn); writes = next.catch(() => {}); return next;
}
export async function resolveIncomingInvite(
  url: string, origin: 'deep_link' | 'deferred_deep_link' = 'deep_link',
): Promise<PendingInvite | null> {
  if (!isResolvableShort(url) && !parseInviteUrl(url)) return null;
  if (origin === 'deferred_deep_link') {
    const before = revision;
    await writes;
    const unresolved = await AsyncStorage.getItem(KEY);
    if (resolving || before !== revision || unresolved || await storage.getPendingInvite()) return null;
  }
  const attempt = ++revision;
  resolving++;
  try {
  const invite = await resolveInviteUrl(url);
  return await serial(async () => {
    if (attempt !== revision) return null;
    if (invite) {
      await AsyncStorage.removeItem(KEY);
      return invite;
    }
    await AsyncStorage.setItem(KEY, JSON.stringify({ url, origin }));
    // Preserve query metadata in the URL, but do not credit an unverified
    // query inviter until the code's canonical owner is resolved.
    failureListeners.forEach((listener) => listener());
    return null;
  });
  } finally { resolving--; }
}
export async function retryUnresolvedInvite(): Promise<boolean> {
  await writes;
  if (resolving) return false;
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return false;
  let saved: { url: string; origin: 'deep_link' | 'deferred_deep_link' };
  try { saved = JSON.parse(raw); } catch { return false; }
  if (!isResolvableShort(saved.url) || !['deep_link', 'deferred_deep_link'].includes(saved.origin)) return false;
  const attempt = revision;
  const invite = await resolveInviteUrl(saved.url);
  if (!invite) return false;
  return serial(async () => {
    if (resolving || attempt !== revision || await AsyncStorage.getItem(KEY) !== raw) return false;
    await receivePendingInvite(invite, saved.origin);
    await storage.markInviteAttributionResolved(saved.url);
    await AsyncStorage.removeItem(KEY);
    return true;
  });
}
/** Three bounded retries on launch/foreground, including later warm failures.
 * No clipboard reread, no guest/account creation and no background timer. */
export function startInviteRecovery(onRecovered: () => Promise<void> = async () => {}): () => void {
  let stopped = false;
  let run = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const recover = () => {
    const current = ++run;
    if (timer) clearTimeout(timer);
    let remaining = 3;
    const step = async () => {
      if (stopped || current !== run) return;
      try { await retryUnresolvedInvite(); await onRecovered(); } catch { /* next foreground can retry */ }
      if (!stopped && current === run && --remaining > 0) timer = setTimeout(step, 5000);
    };
    timer = setTimeout(step, 1500);
  };
  const sub = AppState.addEventListener('change', (state) => {
    if (state === 'active') recover();
    else { run++; if (timer) clearTimeout(timer); }
  });
  // Warm failures trigger the same bounded foreground window.
  const onFailure = () => { if (AppState.currentState === 'active') recover(); };
  failureListeners.add(onFailure);
  if (AppState.currentState === 'active') recover();
  return () => { stopped = true; run++; if (timer) clearTimeout(timer); failureListeners.delete(onFailure); sub.remove(); };
}
