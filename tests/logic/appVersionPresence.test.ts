jest.mock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: { getItem: jest.fn(), setItem: jest.fn() } }));
jest.mock('expo-application', () => ({ get nativeApplicationVersion() { return mockNativeVersion; }, get applicationId() { return mockApplicationId; } }));
jest.mock('react-native', () => ({ Platform: { OS: 'android' } }));
jest.mock('firebase/firestore', () => ({ setDoc: jest.fn(), serverTimestamp: () => ({ _serverTimestamp: true }) }));
jest.mock('@/firebase/config', () => ({ USE_MOCK_DATA: false, getFirebase: () => ({ auth: mockAuth }) }));
jest.mock('@/firebase/firestore', () => ({ docs: { userPrivatePush: (id: string) => `users/${id}/private/push` } }));
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { setDoc } from 'firebase/firestore';
import { recordAppVersionPresence } from '@/services/appVersionPresence';
const now = Date.parse('2026-11-02T12:00:00Z');
let mockAuth = { currentUser: { uid: 'owner', isAnonymous: false } as { uid: string; isAnonymous: boolean } | null };
let mockNativeVersion: string | null = '1.1.73';
let mockApplicationId = 'com.studiogameslime.soccerapp';
beforeEach(() => {
  jest.clearAllMocks(); jest.spyOn(Date, 'now').mockReturnValue(now);
  mockAuth.currentUser = { uid: 'owner', isAnonymous: false }; mockNativeVersion = '1.1.73';
  mockApplicationId = 'com.studiogameslime.soccerapp';
  (Platform as any).OS = 'android'; (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
  (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined); (setDoc as jest.Mock).mockResolvedValue(undefined);
});
afterEach(() => jest.restoreAllMocks());

test('records a private native version with server time, without push tokens or preference changes', async () => {
  await recordAppVersionPresence('owner');
  expect(setDoc).toHaveBeenCalledWith('users/owner/private/push', { appSessions: { android: { platform: 'android', appVersion: '1.1.73', observedAt: { _serverTimestamp: true } } } }, { merge: true });
  expect(AsyncStorage.setItem).toHaveBeenCalledWith('footy.versionPresence.owner.android', JSON.stringify({ version: '1.1.73', at: now }));
});
test('deduplicates concurrent calls and the cache is specific to account, platform and version', async () => {
  let release!: () => void;
  (setDoc as jest.Mock).mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
  const one = recordAppVersionPresence('owner'), two = recordAppVersionPresence('owner');
  expect(one).toBe(two); await Promise.resolve(); release(); await Promise.all([one, two]);
  expect(setDoc).toHaveBeenCalledTimes(1);
  (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify({ version: '1.1.72', at: now - 1 }));
  await recordAppVersionPresence('owner'); expect(setDoc).toHaveBeenCalledTimes(2);
  mockAuth.currentUser = { uid: 'other', isAnonymous: false };
  await recordAppVersionPresence('other'); expect(AsyncStorage.getItem).toHaveBeenLastCalledWith('footy.versionPresence.other.android');
});
test('throttles the same version for one hour, but records the first observation after Israel midnight', async () => {
  (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify({ version: '1.1.73', at: now - 1000 }));
  await recordAppVersionPresence('owner'); expect(setDoc).not.toHaveBeenCalled();
  jest.mocked(Date.now).mockReturnValue(Date.parse('2026-11-02T22:01:00Z'));
  (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify({ version: '1.1.73', at: Date.parse('2026-11-02T21:59:00Z') }));
  await recordAppVersionPresence('owner'); expect(setDoc).toHaveBeenCalledTimes(1);
});
test('does not latch failed writes, and retries instead of treating them as a successful observation', async () => {
  (setDoc as jest.Mock).mockRejectedValueOnce(Error('offline'));
  await expect(recordAppVersionPresence('owner')).resolves.toBeUndefined(); expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  await recordAppVersionPresence('owner'); expect(setDoc).toHaveBeenCalledTimes(2); expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1);
});
test('never attributes a session to a guest, a different account, or an account switched during storage lookup', async () => {
  await recordAppVersionPresence('other'); expect(setDoc).not.toHaveBeenCalled();
  mockAuth.currentUser!.isAnonymous = true; await recordAppVersionPresence('owner'); expect(setDoc).not.toHaveBeenCalled();
  mockAuth.currentUser!.isAnonymous = false;
  (AsyncStorage.getItem as jest.Mock).mockImplementationOnce(async () => { mockAuth.currentUser = { uid: 'other', isAnonymous: false }; return null; });
  await recordAppVersionPresence('owner'); expect(setDoc).not.toHaveBeenCalled();
});
test('unknown native versions and web cannot claim a store installation; corrupt or future cache cannot suppress a real write', async () => {
  mockNativeVersion = null; await recordAppVersionPresence('owner'); expect(setDoc).not.toHaveBeenCalled();
  mockNativeVersion = '1.1.73'; (Platform as any).OS = 'web'; await recordAppVersionPresence('owner'); expect(setDoc).not.toHaveBeenCalled();
  (Platform as any).OS = 'android'; mockApplicationId = 'host.exp.exponent'; await recordAppVersionPresence('owner'); expect(setDoc).not.toHaveBeenCalled();
  mockApplicationId = 'com.studiogameslime.soccerapp'; (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce('invalid-json'); await recordAppVersionPresence('owner');
  (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(JSON.stringify({ version: '1.1.73', at: now + 100 })); await recordAppVersionPresence('owner'); expect(setDoc).toHaveBeenCalledTimes(2);
});
