// Local notifications (no server / no FCM). The poller fires these when a
// new review appears, even from the background task.
//
// expo-notifications hard-crashes on *import* inside Expo Go (push support
// was removed from Expo Go in SDK 53), so we lazy-require it and skip
// entirely when running under Expo Go. In a real dev/production build this
// guard is a no-op and notifications work fully.

import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { logNotification } from './notifLog';
import { navRef } from '../navigation/navRef';

const isExpoGo = Constants.executionEnvironment === 'storeClient';

type NotificationsModule = typeof import('expo-notifications');
let Notifications: NotificationsModule | null = null;

export async function openInitialOnboardingNotification(): Promise<void> {
  const response = await Notifications?.getLastNotificationResponseAsync();
  const data = response?.notification.request.content.data;
  if (data?.type === 'onboardingActivity' && navRef.isReady()) {
    (navRef as any).navigate('OnboardingActivity', { sessionId: data.sessionId });
    await Notifications?.clearLastNotificationResponseAsync();
  }
}

if (!isExpoGo) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  Notifications = require('expo-notifications') as NotificationsModule;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    }),
  });
  // Record remote pushes (admin alerts) received while the app is running, so
  // they show up in the "התראות אחרונות" screen. notify() logs local ones; the
  // dedupe in logNotification stops doubles.
  Notifications.addNotificationReceivedListener((n) => {
    const c = n.request.content;
    void logNotification(c.title ?? '', c.body ?? '', (c.data as Record<string, unknown>) ?? {});
  });
  Notifications.addNotificationResponseReceivedListener(response => {
    const data = response.notification.request.content.data;
    if (data?.type === 'onboardingActivity' && navRef.isReady()) {
      (navRef as any).navigate('OnboardingActivity', { sessionId: data.sessionId });
      void Notifications?.clearLastNotificationResponseAsync();
    }
  });
}

export async function ensureNotificationSetup(): Promise<boolean> {
  if (!Notifications) return false; // Expo Go
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('onboarding', {
      name: 'פעולות הצטרפות', importance: Notifications.AndroidImportance.HIGH,
      sound: 'default',
    });
    await Notifications.setNotificationChannelAsync('reviews', {
      name: 'Reviews & ratings',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#3B82F6',
    });
  }
  const current = await Notifications.getPermissionsAsync();
  let status = current.status;
  if (status !== 'granted') {
    const req = await Notifications.requestPermissionsAsync();
    status = req.status;
  }
  return status === 'granted';
}

// Native FCM device token (Android) — needs google-services.json in the build.
// Used to receive REMOTE pushes (e.g. the onNewUserJoined Cloud Function).
// Returns null under Expo Go or if permission/registration fails.
export async function getDevicePushToken(): Promise<string | null> {
  if (!Notifications) return null;
  try {
    if (!(await ensureNotificationSetup())) return null;
    const t = await Notifications.getDevicePushTokenAsync();
    return typeof t.data === 'string' ? t.data : null;
  } catch {
    return null;
  }
}

export async function notify(
  title: string,
  body: string,
  data: Record<string, unknown> = {},
): Promise<void> {
  // Log to history regardless of Expo Go / permission so the "התראות אחרונות"
  // screen is populated even when the OS banner is skipped.
  void logNotification(title, body, data);
  if (!Notifications) {
    console.log('[notify skipped — Expo Go]', title, body);
    return;
  }
  await Notifications.scheduleNotificationAsync({
    content: { title, body, data },
    trigger: null, // immediate
  });
}
