import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Application from 'expo-application';
import { Platform } from 'react-native';
import { serverTimestamp, setDoc } from 'firebase/firestore';
import { getFirebase, USE_MOCK_DATA } from '@/firebase/config';
import { docs } from '@/firebase/firestore';
import { observeCaughtError } from '@/utils/errorObservation';

const INTERVAL = 60 * 60_000;
const pending = new Map<string, Promise<void>>();
const israelDay = (at: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);

/** A bounded, private version observation independent of push permission and campaign flags. */
export function recordAppVersionPresence(uid: string): Promise<void> {
  if (USE_MOCK_DATA || !uid || !['android', 'ios'].includes(Platform.OS) || Application.applicationId !== 'com.studiogameslime.soccerapp') return Promise.resolve();
  const version = Application.nativeApplicationVersion;
  if (!version || !/^\d+(?:\.\d+){1,3}$/.test(version)) return Promise.resolve();
  const key = `footy.versionPresence.${uid}.${Platform.OS}`;
  const current = () => { const user = getFirebase().auth.currentUser; return user?.uid === uid && !user.isAnonymous; };
  if (!current()) return Promise.resolve();
  const hit = pending.get(key);
  if (hit) return hit;
  const work = (async () => {
    try {
      const raw = await AsyncStorage.getItem(key);
      let previous: { version?: string; at?: number } | null = null;
      if (raw) {
        try { previous = JSON.parse(raw); }
        catch (error) { observeCaughtError(error, { source: 'src/services/appVersionPresence.ts', handler: 'recordAppVersionPresence', site: 'versionPresence:cache' }); }
      }
      const now = Date.now(), at = previous?.at;
      if (previous?.version === version && typeof at === 'number' && Number.isFinite(at) && at <= now && now - at < INTERVAL && israelDay(at) === israelDay(now)) return;
      if (!current()) return;
      // Merge one platform only. Preserve all tokens, preferences and the other platform.
      await setDoc(docs.userPrivatePush(uid), { appSessions: { [Platform.OS]: {
        platform: Platform.OS, appVersion: version, observedAt: serverTimestamp(),
      } } }, { merge: true });
      // Failed writes must remain retryable; never latch before acknowledgement.
      if (current()) await AsyncStorage.setItem(key, JSON.stringify({ version, at: now }));
    } catch (error) {
      observeCaughtError(error, { source: 'src/services/appVersionPresence.ts', handler: 'recordAppVersionPresence', site: 'versionPresence:write' });
    }
  })();
  pending.set(key, work);
  void work.then(() => { if (pending.get(key) === work) pending.delete(key); });
  return work;
}
