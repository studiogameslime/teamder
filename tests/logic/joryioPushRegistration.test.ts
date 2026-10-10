jest.mock('react-native', () => ({ Platform: { OS: 'android', select: (o: Record<string, unknown>) => o.android ?? o.default } }), { virtual: true });
jest.mock('expo-constants', () => ({ default: {} }), { virtual: true });
jest.mock('@/firebase/config', () => ({ USE_MOCK_DATA: false }));
const logUnexpected = jest.fn();
jest.mock('@/services/errorLog', () => ({ logUnexpected: (...a: unknown[]) => logUnexpected(...a) }));
(globalThis as { __DEV__?: boolean }).__DEV__ = false;
const sdk = {
  initialize: jest.fn().mockResolvedValue(undefined),
  registerPushToken: jest.fn(),
  getPushPermissionStatus: jest.fn().mockResolvedValue('granted'),
  setAttribute: jest.fn(),
};
const getAPNSToken = jest.fn();
jest.mock('@react-native-firebase/messaging', () => ({ default: () => ({ getAPNSToken }) }), { virtual: true });
jest.mock('@joryio/react-native-sdk', () => ({ __esModule: true, default: sdk }), { virtual: true });
import { registerPushToken } from '@/services/joryio';
import { Platform } from 'react-native';
const TOKEN = 'android-fcm-token';
beforeEach(() => {
  (Platform as { OS: string }).OS = 'android';
  logUnexpected.mockReset();
  sdk.registerPushToken.mockReset().mockResolvedValue({ success: true });
  sdk.setAttribute.mockClear();
  getAPNSToken.mockReset().mockResolvedValue('a'.repeat(64));
});
it('returns confirmed success, not a local dispatch acknowledgement', async () => {
  expect(await registerPushToken(TOKEN)).toBe(true);
  expect(sdk.registerPushToken).toHaveBeenCalledWith(TOKEN);
});
it('reports the registration result itself when the backend refuses it', async () => {
  sdk.registerPushToken.mockResolvedValue({ success: false, message: 'denied', isUnauthorized: true, isRetryable: false });
  expect(await registerPushToken(TOKEN)).toBe(false);
  expect(logUnexpected).toHaveBeenCalledWith('joryioRegisterPushToken', expect.objectContaining({ message: 'denied', isUnauthorized: true, isRetryable: false }));
  expect(sdk.setAttribute).not.toHaveBeenCalled();
});
it('reports retryable transport failures', async () => {
  sdk.registerPushToken.mockResolvedValue({ success: false, message: 'offline', isRetryable: true });
  expect(await registerPushToken(TOKEN)).toBe(false);
  expect(logUnexpected).toHaveBeenCalledWith('joryioRegisterPushToken', expect.objectContaining({ isRetryable: true }));
});
it('does not replace the iOS SDK APNs token with a Firebase token', async () => {
  (Platform as { OS: string }).OS = 'ios';
  expect(await registerPushToken(TOKEN)).toBe(true);
  expect(sdk.registerPushToken).toHaveBeenCalledWith('a'.repeat(64));
  expect(sdk.registerPushToken).not.toHaveBeenCalledWith(TOKEN);
});
it('does not send an invalid or missing APNs token', async () => {
  (Platform as { OS: string }).OS = 'ios';
  getAPNSToken.mockResolvedValue(null);
  expect(await registerPushToken(TOKEN)).toBe(false);
  expect(sdk.registerPushToken).not.toHaveBeenCalled();
});
it('does not register empty tokens', async () => {
  expect(await registerPushToken('')).toBe(false);
  expect(sdk.registerPushToken).not.toHaveBeenCalled();
});
