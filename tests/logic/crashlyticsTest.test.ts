let mockMode = false;
let mockPlatform = 'android';
let mockNative = true;
let mockAuth: { currentUser: { uid: string } | null };
const mockCrash = jest.fn();
const mockSetUserId = jest.fn();
const mockInstance = { isCrashlyticsCollectionEnabled: true };
jest.mock('react-native', () => ({ get Platform() { return { OS: mockPlatform }; }, get NativeModules() { return mockNative ? { RNFBCrashlyticsModule: {} } : {}; } }));
jest.mock('@/firebase/config', () => ({ get USE_MOCK_DATA() { return mockMode; }, getFirebase: () => ({ auth: mockAuth }) }));
jest.mock('@react-native-firebase/crashlytics', () => ({ getCrashlytics: () => mockInstance, setUserId: (...args: unknown[]) => mockSetUserId(...args), crash: (...args: unknown[]) => mockCrash(...args) }));
import { triggerCrashlyticsTest } from '@/services/crashlyticsTestService';
const runtime = globalThis as unknown as { __DEV__: boolean };
const previousDev = runtime.__DEV__;
beforeEach(() => { runtime.__DEV__ = false; mockMode = false; mockPlatform = 'android'; mockNative = true; mockAuth = { currentUser: { uid: 'tester' } }; mockInstance.isCrashlyticsCollectionEnabled = true; mockCrash.mockReset(); mockSetUserId.mockReset().mockResolvedValue(null); });
afterAll(() => { runtime.__DEV__ = previousDev; });
test('native crash is explicitly associated with the current authenticated tester', async () => {
  expect(await triggerCrashlyticsTest('tester')).toBe('triggered');
  expect(mockSetUserId).toHaveBeenCalledWith(mockInstance, 'tester');
  expect(mockCrash).toHaveBeenCalledWith(mockInstance);
  expect(mockSetUserId.mock.invocationCallOrder[0]).toBeLessThan(mockCrash.mock.invocationCallOrder[0]);
});
test.each(['development', 'mock', 'web', 'old-binary', 'disabled', 'signed-out', 'other-user'])('does not crash for %s', async mode => {
  if (mode === 'development') runtime.__DEV__ = true;
  if (mode === 'mock') mockMode = true;
  if (mode === 'web') mockPlatform = 'web';
  if (mode === 'old-binary') mockNative = false;
  if (mode === 'disabled') mockInstance.isCrashlyticsCollectionEnabled = false;
  if (mode === 'signed-out') mockAuth.currentUser = null;
  if (mode === 'other-user') mockAuth.currentUser = { uid: 'other' };
  expect(await triggerCrashlyticsTest('tester')).not.toBe('triggered');
  expect(mockSetUserId).not.toHaveBeenCalled();
  expect(mockCrash).not.toHaveBeenCalled();
});
test('a changed session during identity setup aborts and clears test identity', async () => {
  mockSetUserId.mockImplementationOnce(async () => { mockAuth.currentUser = { uid: 'next' }; });
  expect(await triggerCrashlyticsTest('tester')).toBe('session-changed');
  expect(mockSetUserId).toHaveBeenLastCalledWith(mockInstance, '');
  expect(mockCrash).not.toHaveBeenCalled();
});
test('a failed identity setup never triggers a crash', async () => {
  mockSetUserId.mockRejectedValueOnce(new Error('native bridge unavailable'));
  expect(await triggerCrashlyticsTest('tester')).toBe('unavailable');
  expect(mockCrash).not.toHaveBeenCalled();
});
