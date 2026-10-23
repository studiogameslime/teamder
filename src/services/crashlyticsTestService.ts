import { NativeModules, Platform } from 'react-native';
import { getFirebase, USE_MOCK_DATA } from '@/firebase/config';

export type CrashTestResult = 'triggered' | 'development' | 'unavailable' | 'session-changed' | 'collection-disabled';

/** Only called after the user confirms the temporary home-screen test. */
export async function triggerCrashlyticsTest(expectedUserId: string): Promise<CrashTestResult> {
  if (USE_MOCK_DATA || (typeof __DEV__ !== 'undefined' && __DEV__)) return 'development';
  if ((Platform.OS !== 'android' && Platform.OS !== 'ios') || !NativeModules?.RNFBCrashlyticsModule) return 'unavailable';
  try {
    const { auth } = getFirebase();
    const userId = auth.currentUser?.uid;
    if (!userId || userId !== expectedUserId) return 'session-changed';
    const sdk = require('@react-native-firebase/crashlytics') as typeof import('@react-native-firebase/crashlytics');
    const instance = sdk.getCrashlytics();
    if (!instance.isCrashlyticsCollectionEnabled) return 'collection-disabled';
    // This identifier belongs to the explicit test report, not the general
    // sanitized error sink. Never copy the user's email or display name.
    await sdk.setUserId(instance, userId);
    if (auth.currentUser?.uid !== userId) {
      await sdk.setUserId(instance, '');
      return 'session-changed';
    }
    sdk.crash(instance);
    return 'triggered';
  } catch {
    return 'unavailable';
  }
}
