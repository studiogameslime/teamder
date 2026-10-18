const mockDisk = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(async (k: string) => mockDisk.get(k) ?? null), setItem: jest.fn(async (k: string, v: string) => { mockDisk.set(k, v); }) }));
jest.mock('@/services/updateService', () => ({ updateTargetKey: (u: any) => `${u.source}:${u.targetBuild ?? u.targetVersion}` }));
jest.mock('@/services/analyticsService', () => ({ logEvent: jest.fn(), AnalyticsEvent: { UpdatePromptDismissed: 'dismissed' } }));
const update = { kind: 'optional', source: 'google_play', fromVersion: '1.1.50', fromBuild: '283', targetBuild: 284 };
beforeEach(() => { jest.resetModules(); mockDisk.clear(); jest.clearAllMocks(); });
test('dismissal survives relaunch for 24 hours; a newer target is not suppressed', async () => {
  let api = require('@/store/updatePromptStore');
  await api.applyStoreUpdate(update); api.dismissStoreUpdate(); await Promise.resolve();
  jest.resetModules(); api = require('@/store/updatePromptStore');
  await api.applyStoreUpdate(update); expect(api.useUpdatePromptStore.getState().update).toBeNull();
  await api.applyStoreUpdate({ ...update, targetBuild: 285 }); expect(api.useUpdatePromptStore.getState().update.targetBuild).toBe(285);
  const now = Date.now(); jest.spyOn(Date, 'now').mockReturnValue(now + 86400001);
  await api.applyStoreUpdate(update); expect(api.useUpdatePromptStore.getState().update.targetBuild).toBe(284); jest.restoreAllMocks();
});
test('force ignores snooze and cannot be dismissed; no update restores ordinary header', async () => {
  const api = require('@/store/updatePromptStore'); await api.applyStoreUpdate(update); api.dismissStoreUpdate();
  await api.applyStoreUpdate({ ...update, kind: 'force' }); api.dismissStoreUpdate(); expect(api.useUpdatePromptStore.getState().update.kind).toBe('force');
  await api.applyStoreUpdate(null); expect(api.useUpdatePromptStore.getState().update).toBeNull();
});
