jest.mock('firebase/firestore', () => ({ doc: jest.fn(), getDoc: jest.fn() }));
jest.mock('@/firebase/config', () => ({ getFirebase: () => ({ db: {} }), USE_MOCK_DATA: false }));
jest.mock('@/services/storage', () => ({ storage: { getWhatsNewSeenVersion: jest.fn(), setWhatsNewSeenVersion: jest.fn() } }));
jest.mock('@/services/updateService', () => ({ getCurrentVersion: () => '1.1.50', compareVersions: (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true }) }));
jest.mock('@/services/errorLog', () => ({ logError: jest.fn(), isExpectedDenial: () => true }));
jest.mock('@/data/mockData', () => ({ mockWhatsNew: {} }));
import { getDoc } from 'firebase/firestore';
import { storage } from '@/services/storage';
import { resolveWhatsNew, markWhatsNewSeen } from '@/services/whatsNewService';
const item = (version: string) => ({ version, emoji: '⚽', title: 'חדש', body: 'תיאור' });
function config(items: unknown[], enabled = true) {
  (getDoc as jest.Mock).mockResolvedValue({ exists: () => true, data: () => ({ enabled, items }) });
}
beforeEach(() => { jest.resetAllMocks(); (storage.getWhatsNewSeenVersion as jest.Mock).mockResolvedValue('1.1.46'); });
it('preserves eligibility after an offline launch and delivers after reconnect', async () => {
  (getDoc as jest.Mock).mockRejectedValueOnce(new Error('offline'));
  await expect(resolveWhatsNew()).rejects.toThrow('offline');
  expect(storage.setWhatsNewSeenVersion).not.toHaveBeenCalled();
  config([item('1.1.50')]);
  expect((await resolveWhatsNew())?.items).toHaveLength(1);
  expect(storage.setWhatsNewSeenVersion).not.toHaveBeenCalled();
  await markWhatsNewSeen('1.1.50');
  expect(storage.setWhatsNewSeenVersion).toHaveBeenCalledWith('1.1.50');
});
it.each(['missing', 'disabled', 'empty'])('does not consume a %s publication', async kind => {
  if (kind === 'missing') (getDoc as jest.Mock).mockResolvedValue({ exists: () => false });
  else config([], kind !== 'disabled');
  expect(await resolveWhatsNew()).toBeNull();
  expect(storage.setWhatsNewSeenVersion).not.toHaveBeenCalled();
  config([item('1.1.50')]);
  expect((await resolveWhatsNew())?.items).toHaveLength(1);
});
it('filters skipped versions and excludes future or malformed content', async () => {
  config([item('1.1.46'), item('1.1.49'), item('1.1.50'), item('1.1.51'), { ...item('1.1.50'), body: {} }]);
  expect((await resolveWhatsNew())?.items.map(value => value.version)).toEqual(['1.1.50', '1.1.49']);
});
it('shows only the installed release without a previous baseline', async () => {
  (storage.getWhatsNewSeenVersion as jest.Mock).mockResolvedValue(null);
  config([item('1.1.49'), item('1.1.50')]);
  expect((await resolveWhatsNew())?.items.map(value => value.version)).toEqual(['1.1.50']);
});
it('does not fetch again for an already shown release', async () => {
  (storage.getWhatsNewSeenVersion as jest.Mock).mockResolvedValue('1.1.50');
  expect(await resolveWhatsNew()).toBeNull(); expect(getDoc).not.toHaveBeenCalled();
});
