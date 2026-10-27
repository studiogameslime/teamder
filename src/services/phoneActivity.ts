import { SPORTS_ACTIVITY_ENABLED, assertSportsActivityEnabled } from '@/config/sportsActivity';
import { NativeModules, PermissionsAndroid, Platform } from 'react-native';
import * as Location from 'expo-location';
import { useUserStore } from '@/store/userStore';
import { observeCaughtError } from '@/utils/errorObservation';

export interface PhoneMeasurement {
  running: boolean;
  starting: boolean;
  elapsedMs: number;
  current: number | null;
  peak: number | null;
  distance: number | null;
  sprints: number | null;
  sprintMs: number | null;
  measuredMs: number;
  sprinting: boolean;
  quality: 'idle' | 'good' | 'waiting' | 'weak';
  error: string | null;
  graph: (number | null)[];
}
interface Bridge {
  snapshot(uid: string): Promise<string>;
  start(uid: string): Promise<string>;
  stop(uid: string): Promise<string>;
  clear(): Promise<void>;
}
const native = NativeModules.PhoneActivity as Bridge | undefined;
export const phoneMeasurementAvailable = SPORTS_ACTIVITY_ENABLED && Platform.OS === 'android' && !!native;
function uid() {
  const value = useUserStore.getState().currentUser?.id;
  if (!value) throw new Error('session_required');
  return value;
}
async function measurementFor(owner: string, operation: () => Promise<string>): Promise<PhoneMeasurement> {
  let payload: string;
  try {
    payload = await operation();
  } finally {
    // Fence both success and failure before either can leave the old session.
    if (useUserStore.getState().currentUser?.id !== owner) throw new Error('session_changed');
  }
  return JSON.parse(payload) as PhoneMeasurement;
}
useUserStore.subscribe((state, previous) => {
  if (state.currentUser?.id !== previous.currentUser?.id && native) {
    void native.clear().catch(error => observeCaughtError(error, { source: 'src/services/phoneActivity.ts', handler: 'sessionChanged', site: 'native.clear' }));
  }
});
export async function readPhoneMeasurement(): Promise<PhoneMeasurement> {
  assertSportsActivityEnabled();
  if (!native) throw new Error('unavailable');
  const owner = uid();
  return measurementFor(owner, () => native.snapshot(owner));
}
export async function startPhoneMeasurement(): Promise<PhoneMeasurement> {
  assertSportsActivityEnabled();
  if (!native) throw new Error('unavailable');
  const owner = uid();
  const permission = await Location.requestForegroundPermissionsAsync();
  if (!permission.granted || permission.android?.accuracy !== 'fine') throw new Error('precise_required');
  if (!await Location.hasServicesEnabledAsync()) throw new Error('location_off');
  // A visible, persistent stop control is required for this screen-off test.
  if (Platform.OS === 'android' && Number(Platform.Version) >= 33) {
    const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
    if (result !== PermissionsAndroid.RESULTS.GRANTED) throw new Error('notification_required');
  }
  if (uid() !== owner) throw new Error('session_changed');
  return measurementFor(owner, () => native.start(owner));
}
export async function stopPhoneMeasurement(): Promise<PhoneMeasurement> {
  if (!native) throw new Error('unavailable');
  const owner = uid();
  return measurementFor(owner, () => native.stop(owner));
}
export function phoneMeasurementError(code: string | null): string | null {
  if (!code) return null;
  if (code === 'precise_required' || code === 'permission') return 'נדרשת הרשאת מיקום מדויק. אפשר לאשר אותה בהגדרות הטלפון.';
  if (code === 'notification_required') return 'יש לאפשר התראות כדי להציג את המדידה ואת כפתור הסיום כשהמסך כבוי.';
  if (code === 'location_off') return 'המיקום בטלפון כבוי. הפעל אותו לפני תחילת המדידה.';
  if (code === 'limit') return 'הבדיקה הסתיימה לאחר שעתיים.';
  return 'לא ניתן להפעיל את המדידה כרגע. חזור למסך ונסה שוב.';
}
