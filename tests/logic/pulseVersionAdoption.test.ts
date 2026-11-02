jest.mock('../../pulse/src/services/cache', () => ({ cached: jest.fn((_key, fn) => fn()) }));
jest.mock('../../pulse/src/services/deviceVersions', () => ({ fetchUserDevices: jest.fn() }));
jest.mock('../../pulse/src/services/appStoreConnect', () => ({ fetchAppleVersions: jest.fn() }));
jest.mock('../../pulse/src/services/firestoreRest', () => ({ queryDocumentPage: jest.fn(), getDoc: jest.fn() }));
jest.mock('../../pulse/src/services/firebase', () => ({ isTestAccount: (email: string) => email?.endsWith('@cloudtestlabaccounts.com') }));
import { compareAppVersions, fetchVersionAdoption, liveAppleTarget, liveAndroidTarget, summarizeAdoption, VERSION_ADOPTION_TTL, type AdoptionUser, type VersionAdoption } from '../../pulse/src/services/versionAdoption';
import { fetchUserDevices } from '../../pulse/src/services/deviceVersions';
import { fetchAppleVersions } from '../../pulse/src/services/appStoreConnect';
import { getDoc, queryDocumentPage } from '../../pulse/src/services/firestoreRest';
import { cached } from '../../pulse/src/services/cache';
const now = Date.parse('2026-11-02T12:00:00Z'), day = 86400000;
const device = (version: string, observedAt = now - 100, platform = 'android') => ({ version, observedAt, platform, device: '' });
const user = (userId: string, devices = [device('1.1.72')], extra = {}): AdoptionUser => ({ userId, name: userId, devices, failed: false, ...extra });
const data = (users: AdoptionUser[], target: string | null = '1.1.72'): VersionAdoption => ({ users, targets: { android: target ? { version: target, partial: false } : null, ios: { version: '1.1.69', partial: false } }, failedStores: [], at: now });
beforeEach(() => {
  jest.clearAllMocks(); jest.spyOn(Date, 'now').mockReturnValue(now);
  (fetchAppleVersions as jest.Mock).mockResolvedValue([{ version: '1.1.69', state: 'READY_FOR_SALE' }]);
  (getDoc as jest.Mock).mockResolvedValue({ versions: { '1.1.72': { androidProductionPromoted: true, androidPublicAvailabilityConfirmedByOwner: true } } });
  (fetchUserDevices as jest.Mock).mockResolvedValue([device('1.1.72')]);
});
afterEach(() => jest.restoreAllMocks());

test('targets are the live release of each store, never a newer draft or review', () => {
  expect(liveAppleTarget([{ version: '1.1.72', state: 'WAITING_FOR_REVIEW' }, { version: '1.1.9', state: 'READY_FOR_SALE' }, { version: '1.1.69', state: 'READY_FOR_DISTRIBUTION' }])).toEqual({ version: '1.1.69', partial: false, source: 'store' });
  expect(liveAndroidTarget({ versions: { '1.1.72': { androidProductionPromoted: true, androidPublicAvailabilityConfirmedByOwner: true, androidProductionStatus: 'inProgress' } } })).toEqual({ version: '1.1.72', partial: true, source: 'releaseLog' });
  expect(liveAndroidTarget({ versions: { '1.1.73': { androidProductionPromoted: true }, '1.1.72': { androidPublicAvailabilityVerified: true } } })).toBeNull();
  expect(liveAndroidTarget({ versions: { '1.1.73': { androidProductionPromoted: false }, '1.1.72': { androidPublicAvailabilityVerified: true } } })?.version).toBe('1.1.72');
  expect(liveAppleTarget([{ version: '1.1.72', state: 'PENDING_DEVELOPER_RELEASE' }])).toBeNull();
  expect(compareAppVersions('1.1.9', '1.1.72')).toBe(-1);
  expect(compareAppVersions('1.1.72.0', '1.1.72')).toBe(0);
  expect(compareAppVersions('1.1.72-preview', '1.1.72')).toBeNull();
});

test('each account counts once per platform, newer versions stay distinct from older ones', () => {
  const current = user('current', [device('1.1.60', now - day), device('1.1.72'), device('1.1.69', now - 50, 'ios')]);
  const summary = summarizeAdoption(data([current, current, user('old', [device('1.1.9')]), user('new', [device('1.1.73')]), user('unknown', [], { platform: 'android' }), user('failed', [], { platform: 'android', failed: true }), user('ios-only', [device('1.1.69', now, 'ios')]), user('unattributed', [])]), 'android', now);
  expect(summary).toMatchObject({ total: 5, known: 3, current: 1, older: 1, newer: 1, missing: 1, failed: 1, percent: 33 });
  expect(summary.current + summary.older + summary.newer + summary.missing + summary.failed).toBe(summary.total);
  expect(summary.versions).toEqual([['1.1.73', 1], ['1.1.72', 1], ['1.1.9', 1]]);
  expect(summarizeAdoption(data([current]), 'ios', now)).toMatchObject({ total: 1, current: 1, percent: 100 });
});

test('today requires version evidence today, not a recent presence attached to an old device report', () => {
  const snapshot = data([
    user('current'), user('old-today', [device('1.1.60')]),
    user('presence-only', [device('1.1.72', now - 40 * day)], { platform: 'android', lastSeenAt: now }),
    user('failed-today', [], { platform: 'android', lastSeenAt: now, failed: true }),
    user('no-presence', [device('1.1.72', now - 2 * day)]),
    user('another-platform-today', [device('1.1.72', now - day)], { platform: 'ios', lastSeenAt: now }),
    user('future', [device('1.1.72', now + 100)], { platform: 'android', lastSeenAt: now + 100 }),
  ]);
  expect(summarizeAdoption(snapshot, 'android', now)).toMatchObject({ today: 4, todayCurrent: 1, todayOlder: 1, todayUnknown: 2, stale: 1 });
  expect(summarizeAdoption(snapshot, 'android', now + day)).toMatchObject({ today: 0, todayCurrent: 0 });
});

test('ambiguous, future and invalid observations stay unknown, store failure never becomes zero adoption', () => {
  const rows = [user('tie', [device('1.1.72'), device('1.1.60')]), user('bad', [device('preview')]), user('future', [device('1.1.72', now + 1)])];
  expect(summarizeAdoption(data(rows), 'android', now)).toMatchObject({ total: 3, known: 0, missing: 3, percent: null });
  expect(summarizeAdoption(data([user('current')], null), 'android', now)).toMatchObject({ known: 1, percent: null, todayUnknown: 1 });
  expect(summarizeAdoption(data([]), 'android', now)).toMatchObject({ total: 0, percent: null });
});

test('all projected user pages are scanned and device failures remain separate with bounded concurrency', async () => {
  const cursor = { values: [{ referenceValue: 'users/last' }] };
  (queryDocumentPage as jest.Mock).mockImplementation(async (_collection, options) => {
    expect(options.fields).toEqual(['name', 'email', 'qa', 'platform', 'lastSeenAt']);
    expect(options.orderField).toBe('__name__'); expect(options.direction).toBe('ASCENDING');
    return options.cursor ? { rows: [{ id: 'last', platform: 'ios' }] } : { rows: [...Array.from({ length: 100 }, (_, i) => ({ id: `u${i}`, platform: 'android', lastSeenAt: now })), { id: 'qa', qa: true }, { id: 'robot', email: 'robot@cloudtestlabaccounts.com' }, { id: 'deleted', name: 'משתמש שהוסר' }], next: cursor };
  });
  let active = 0, maximum = 0;
  (fetchUserDevices as jest.Mock).mockImplementation(async (id, force) => {
    expect(force).toBe(true); maximum = Math.max(maximum, ++active);
    await new Promise(resolve => setTimeout(resolve, 1)); active--;
    if (id === 'u2') throw Error('denied');
    return id === 'last' ? [device('1.1.69', now, 'ios')] : [device('1.1.72')];
  });
  const result = await fetchVersionAdoption(true);
  expect(result.users).toHaveLength(101); expect(fetchUserDevices).toHaveBeenCalledTimes(101);
  expect(maximum).toBe(6); expect(result.users.filter(u => u.failed)).toHaveLength(1);
  expect(summarizeAdoption(result, 'android')).toMatchObject({ total: 100, known: 99, current: 99, failed: 1, percent: 100 });
  expect(cached).toHaveBeenCalledWith('home-version-adoption-v1', expect.any(Function), { force: true, ttl: VERSION_ADOPTION_TTL });
});

test('user enumeration failure rejects the measurement; unavailable store keeps device counts', async () => {
  (queryDocumentPage as jest.Mock).mockRejectedValueOnce(Error('users unavailable'));
  await expect(fetchVersionAdoption()).rejects.toThrow('users unavailable');
  (queryDocumentPage as jest.Mock).mockResolvedValue({ rows: [{ id: 'real', platform: 'android' }] });
  (getDoc as jest.Mock).mockRejectedValueOnce(Error('store unavailable'));
  const result = await fetchVersionAdoption();
  expect(result.failedStores).toEqual(['android']); expect(result.targets.android).toBeNull();
  expect(summarizeAdoption(result, 'android')).toMatchObject({ known: 1, percent: null });
});
