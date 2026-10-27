jest.mock('@/config/sportsActivity', () => ({ SPORTS_ACTIVITY_ENABLED: true, assertSportsActivityEnabled: () => {} }));
const mockNative = { snapshot: jest.fn(), start: jest.fn(), stop: jest.fn(), clear: jest.fn().mockResolvedValue(undefined) };
let mockUid: string | undefined = 'user-a';
let mockSubscriber: (state: any, previous: any) => void;
jest.mock('react-native', () => ({
  NativeModules: { PhoneActivity: mockNative }, Platform: { OS: 'android', Version: 35 },
  PermissionsAndroid: { request: jest.fn().mockResolvedValue('granted'), PERMISSIONS: { POST_NOTIFICATIONS: 'notifications' }, RESULTS: { GRANTED: 'granted' } },
}));
jest.mock('expo-location', () => ({ requestForegroundPermissionsAsync: jest.fn(), hasServicesEnabledAsync: jest.fn() }));
jest.mock('@/store/userStore', () => ({ useUserStore: { getState: () => ({ currentUser: mockUid ? { id: mockUid } : null }), subscribe: (fn: typeof mockSubscriber) => { mockSubscriber = fn; } } }));
import * as Location from 'expo-location';
import { PermissionsAndroid } from 'react-native';
import { readPhoneMeasurement, startPhoneMeasurement, stopPhoneMeasurement } from '@/services/phoneActivity';
beforeEach(() => {
  jest.clearAllMocks(); mockUid = 'user-a';
  (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true, android: { accuracy: 'fine' } });
  (Location.hasServicesEnabledAsync as jest.Mock).mockResolvedValue(true);
  (PermissionsAndroid.request as jest.Mock).mockResolvedValue('granted');
  mockNative.start.mockResolvedValue('{"running":true}'); mockNative.stop.mockResolvedValue('{"running":false}');
});
it('starts direct measurement only after fine location and notification consent', async () => {
  expect(await startPhoneMeasurement()).toEqual({ running: true });
  expect(mockNative.start).toHaveBeenCalledWith('user-a');
});
it.each([false, true])('rejects denied or approximate location without starting (%s)', async granted => {
  (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ granted, android: { accuracy: 'coarse' } });
  await expect(startPhoneMeasurement()).rejects.toThrow('precise_required'); expect(mockNative.start).not.toHaveBeenCalled();
});
it('does not start when location is disabled', async () => {
  (Location.hasServicesEnabledAsync as jest.Mock).mockResolvedValue(false);
  await expect(startPhoneMeasurement()).rejects.toThrow('location_off'); expect(mockNative.start).not.toHaveBeenCalled();
});
it('requires visible notification stop control', async () => {
  (PermissionsAndroid.request as jest.Mock).mockResolvedValue('denied');
  await expect(startPhoneMeasurement()).rejects.toThrow('notification_required'); expect(mockNative.start).not.toHaveBeenCalled();
});
it('rejects an account switch during permission UI', async () => {
  (Location.hasServicesEnabledAsync as jest.Mock).mockImplementation(async () => { mockUid = 'user-b'; return true; });
  await expect(startPhoneMeasurement()).rejects.toThrow('session_changed'); expect(mockNative.start).not.toHaveBeenCalled();
});
it('clears local test on account change but not profile refresh', () => {
  mockSubscriber({ currentUser: { id: 'user-a' } }, { currentUser: { id: 'user-a' } }); expect(mockNative.clear).not.toHaveBeenCalled();
  mockSubscriber({ currentUser: null }, { currentUser: { id: 'user-a' } }); expect(mockNative.clear).toHaveBeenCalledTimes(1);
});
it('reads and stops only for the current owner, refuses absent session', async () => {
  mockNative.snapshot.mockResolvedValue('{"peak":null}');
  expect(await readPhoneMeasurement()).toEqual({ peak: null });
  expect(await stopPhoneMeasurement()).toEqual({ running: false });
  expect(mockNative.stop).toHaveBeenCalledWith('user-a');
  mockUid = undefined; await expect(readPhoneMeasurement()).rejects.toThrow('session_required');
});

it.each(['read', 'start', 'stop'])('discards a %s response after the account changes during the native call', async operation => {
  let complete!: (value: string) => void;
  const pending = new Promise<string>(resolve => { complete = resolve; });
  const nativeMethod = operation === 'read' ? mockNative.snapshot : operation === 'start' ? mockNative.start : mockNative.stop;
  nativeMethod.mockReturnValueOnce(pending);
  const response = operation === 'read' ? readPhoneMeasurement() : operation === 'start' ? startPhoneMeasurement() : stopPhoneMeasurement();
  // Starting first awaits the permission flow, then enters the native bridge.
  for (let tick = 0; tick < 10 && nativeMethod.mock.calls.length === 0; tick++) await Promise.resolve();
  expect(nativeMethod).toHaveBeenCalledWith('user-a');
  mockUid = 'user-b';
  const rejected = expect(response).rejects.toThrow('session_changed');
  complete('{"peak":32,"distance":1000}');
  await rejected;
});

it('discards the old owner native error after logout', async () => {
  let fail!: (error: Error) => void;
  mockNative.snapshot.mockReturnValueOnce(new Promise((_resolve, reject) => { fail = reject; }));
  const response = readPhoneMeasurement();
  mockUid = undefined;
  const rejected = expect(response).rejects.toThrow('session_changed');
  fail(new Error('previous owner private native payload'));
  await rejected;
});
