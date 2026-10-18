const mockDisk = new Map<string, string>();
let mockBuild = '283';
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(async (k: string) => mockDisk.get(k) ?? null), setItem: jest.fn(async (k: string, v: string) => { mockDisk.set(k, v); }), removeItem: jest.fn(async (k: string) => { mockDisk.delete(k); }) }));
jest.mock('expo-application', () => ({ get nativeBuildVersion() { return mockBuild; } }));
jest.mock('@/services/updateService', () => ({
  getCurrentVersion: jest.fn(() => '1.1.50'), openStore: jest.fn(async () => true),
  isReleaseVersion: (v: any) => typeof v === 'string' && /^\d+(\.\d+){1,3}$/.test(v),
  compareVersions: (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true }),
  updateTargetKey: (u: any) => `${u.source}:${u.targetBuild ?? u.targetVersion}`,
}));
jest.mock('@/services/analyticsService', () => ({ logEvent: jest.fn(), AnalyticsEvent: {
  UpdatePromptTapped: 'tap', UpdateStoreOpenFailed: 'failed', UpdateStoreOpened: 'opened', UpdatePromptCompleted: 'completed',
} }));
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Application from 'expo-application';
import { getCurrentVersion, openStore, type StoreUpdate } from '@/services/updateService';
import { logEvent } from '@/services/analyticsService';
import { openTrackedUpdate, reconcileStoreUpdate } from '@/services/updateAttributionService';
const update: StoreUpdate = { kind: 'optional', source: 'google_play', fromVersion: '1.1.50', fromBuild: '283', targetBuild: 284 };
beforeEach(() => { mockDisk.clear(); jest.clearAllMocks(); mockBuild = '283'; (getCurrentVersion as jest.Mock).mockReturnValue('1.1.50'); (openStore as jest.Mock).mockResolvedValue(true); });
const completed = () => (logEvent as jest.Mock).mock.calls.filter(([name]) => name === 'completed');
test('returning from store without updating is not a completion', async () => {
  await openTrackedUpdate(update, 'owner', 'home_banner'); await reconcileStoreUpdate('owner');
  expect(completed()).toHaveLength(0); expect(logEvent).toHaveBeenCalledWith('opened', expect.objectContaining({ actor_id: 'owner' }));
});
test('new native build, even with same name, completes once and preserves correlation', async () => {
  await openTrackedUpdate(update, 'owner', 'home_banner');
  const tap = (logEvent as jest.Mock).mock.calls.find(([name]) => name === 'tap')![1];
  mockBuild = '284';
  await Promise.all([reconcileStoreUpdate('owner'), reconcileStoreUpdate('owner')]); await reconcileStoreUpdate('owner');
  expect(completed()).toHaveLength(1); expect(completed()[0][1]).toMatchObject({ attempt_id: tap.attempt_id, actor_id: 'owner', installed_build: '284' });
});
test('different account, lower target and stale attribution cannot claim update', async () => {
  await openTrackedUpdate({ ...update, targetBuild: 285 }, 'owner', 'home_banner');
  mockBuild = '284'; await reconcileStoreUpdate('owner'); expect(completed()).toHaveLength(0);
  mockBuild = '285'; await reconcileStoreUpdate('other'); expect(completed()).toHaveLength(0);
  jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 15 * 86400000); await reconcileStoreUpdate('owner'); expect(completed()).toHaveLength(0); jest.restoreAllMocks();
});
test('failed store opening is not an update; previous successful attribution survives', async () => {
  await openTrackedUpdate(update, 'owner', 'home_banner'); const saved = [...mockDisk.values()][0];
  (openStore as jest.Mock).mockResolvedValue(false); expect(await openTrackedUpdate(update, 'owner', 'home_banner')).toBe(false);
  expect([...mockDisk.values()][0]).toBe(saved);
  expect(logEvent).toHaveBeenCalledWith('failed', expect.anything()); expect(completed()).toHaveLength(0);
});
test('unreachable store alone never leaves a completable receipt', async () => {
  (openStore as jest.Mock).mockRejectedValue(new Error('no handler')); await openTrackedUpdate(update, null, 'home_banner');
  mockBuild = '284'; await reconcileStoreUpdate(null); expect(completed()).toHaveLength(0);
});
test('Apple version jump is attributed on next launch, not on store visit', async () => {
  await openTrackedUpdate({ ...update, source: 'app_store', targetBuild: undefined, targetVersion: '1.1.51' }, 'owner', 'home_banner');
  await reconcileStoreUpdate('owner'); expect(completed()).toHaveLength(0);
  (getCurrentVersion as jest.Mock).mockReturnValue('1.1.52'); await reconcileStoreUpdate('owner'); expect(completed()).toHaveLength(1);
});
test('storage failure never blocks opening store; reported marker prevents duplicate after failed removal', async () => {
  (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('disk')); await openTrackedUpdate(update, 'owner', 'home_banner'); expect(openStore).toHaveBeenCalledTimes(1);
  mockBuild = '284'; (AsyncStorage.removeItem as jest.Mock).mockRejectedValueOnce(new Error('disk'));
  await reconcileStoreUpdate('owner'); await reconcileStoreUpdate('owner'); expect(completed()).toHaveLength(1);
});
