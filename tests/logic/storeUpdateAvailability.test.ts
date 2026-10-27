jest.mock('react-native', () => ({ Platform: { OS: 'android' }, NativeModules: { TeamderStoreUpdate: { check: jest.fn() } }, Linking: { openURL: jest.fn() } }));
jest.mock('expo-application', () => ({ nativeApplicationVersion: '1.1.50', nativeBuildVersion: '283' }));
jest.mock('expo-localization', () => ({ getLocales: () => [{ regionCode: 'IL' }] }));
jest.mock('firebase/firestore', () => ({ doc: jest.fn(), getDoc: jest.fn() }));
jest.mock('@/firebase/config', () => ({ getFirebase: () => ({ db: {} }), USE_MOCK_DATA: false }));
jest.mock('@/services/errorLog', () => ({ logError: jest.fn(), isExpectedDenial: () => true }));
jest.mock('../../src/utils/errorObservation', () => ({ observeCaughtError: jest.fn() }));
import { observeCaughtError } from '../../src/utils/errorObservation';
import { Linking, NativeModules, Platform } from 'react-native';
import { getDoc } from 'firebase/firestore';
import { checkForUpdate, openStore } from '@/services/updateService';
const bridge = NativeModules.TeamderStoreUpdate;
const lookup = jest.fn();
beforeEach(() => {
  jest.clearAllMocks(); (globalThis as any).__DEV__ = false; (globalThis as any).fetch = lookup;
  (Platform as any).OS = 'android'; NativeModules.TeamderStoreUpdate = bridge;
  bridge.check.mockResolvedValue({ available: true, versionCode: 284 });
  (getDoc as jest.Mock).mockResolvedValue({ exists: () => true, data: () => ({ latestVersion: '9.0.0', minimumSupportedVersion: '1.0.0' }) });
  (Linking.openURL as jest.Mock).mockResolvedValue(undefined);
});
test('Android uses account/track availability, not a higher configured version', async () => {
  bridge.check.mockResolvedValue({ available: false, versionCode: 900 });
  expect(await checkForUpdate()).toBeNull();
  expect(getDoc).not.toHaveBeenCalled();
});
test.each([283, 282, NaN, 284.5])('rejects invalid or non-newer Android build %s', async versionCode => {
  bridge.check.mockResolvedValue({ available: true, versionCode }); expect(await checkForUpdate()).toBeNull();
});
test('same version name but higher native build is an available update', async () => {
  expect(await checkForUpdate()).toMatchObject({ kind: 'optional', fromVersion: '1.1.50', fromBuild: '283', targetBuild: 284 });
});
test('missing bridge and unavailable store do not block app use', async () => {
  NativeModules.TeamderStoreUpdate = undefined; expect(await checkForUpdate()).toBeNull();
  NativeModules.TeamderStoreUpdate = bridge; bridge.check.mockRejectedValue(new Error('Not owned by Play')); expect(await checkForUpdate()).toBeNull();
});

test('Play ownership -10 is normal unavailability at both observation points', async () => {
  bridge.check.mockRejectedValue(new Error('-10: Install Error(-10): The app is not owned by any user on this device.'));
  expect(await checkForUpdate()).toBeNull();
  expect(observeCaughtError).not.toHaveBeenCalled();
  expect(getDoc).not.toHaveBeenCalled();
});

test('other native store failures remain visible', async () => {
  const error = new Error('Install Error(-2): internal failure');
  bridge.check.mockRejectedValue(error);
  expect(await checkForUpdate()).toBeNull();
  expect(observeCaughtError).toHaveBeenCalledWith(error, expect.objectContaining({ handler: 'bounded' }));
});

test('temporary device installation restrictions leave checking retryable without an incident', async () => {
  bridge.check.mockRejectedValueOnce(new Error('Install Error(-6): ERROR_INSTALL_NOT_ALLOWED'));
  expect(await checkForUpdate()).toBeNull();expect(observeCaughtError).not.toHaveBeenCalled();
  bridge.check.mockResolvedValueOnce({available:true,versionCode:284});
  expect(await checkForUpdate()).toMatchObject({targetBuild:284});
});
test('config failure leaves verified store update optional', async () => {
  (getDoc as jest.Mock).mockRejectedValue(new Error('offline')); expect((await checkForUpdate())?.kind).toBe('optional');
});
test('existing minimum policy can force only a store-confirmed update', async () => {
  (getDoc as jest.Mock).mockResolvedValue({ exists: () => true, data: () => ({ minimumSupportedVersion: '1.1.51' }) });
  expect((await checkForUpdate())?.kind).toBe('force');
});
test('parallel foreground checks share one store request', async () => {
  const a = checkForUpdate(), b = checkForUpdate(); await Promise.all([a, b]); expect(bridge.check).toHaveBeenCalledTimes(1);
});
function apple(version: string, trackId = 6775178022, bundleId = 'com.studiogameslime.soccerapp') {
  (Platform as any).OS = 'ios'; lookup.mockResolvedValue({ ok: true, json: async () => ({ results: [{ version, trackId, bundleId }] }) });
}
test.each(['1.1.50', '1.1.49', 'garbage', ''])('Apple does not offer same, older or invalid version %s', async version => {
  apple(version); expect(await checkForUpdate()).toBeNull();
});
test('Apple lookup verifies exact app identity and published version', async () => {
  apple('1.1.51'); expect(await checkForUpdate()).toMatchObject({ kind: 'optional', source: 'app_store', targetVersion: '1.1.51' });
  expect(lookup.mock.calls[0][0]).toContain('country=il');
  apple('9.0.0', 123); expect(await checkForUpdate()).toBeNull();
  apple('9.0.0', 6775178022, 'another.app'); expect(await checkForUpdate()).toBeNull();
});
test('iOS cannot force a minimum not yet published in the queried store', async () => {
  apple('1.1.51'); (getDoc as jest.Mock).mockResolvedValue({ exists: () => true, data: () => ({ minimumSupportedVersion: '1.1.52' }) });
  expect((await checkForUpdate())?.kind).toBe('optional');
});
test('Apple scheme failure falls back to the exact app web page, total failure is false', async () => {
  (Platform as any).OS = 'ios'; (Linking.openURL as jest.Mock).mockRejectedValueOnce(new Error('scheme'));
  expect(await openStore()).toBe(true); expect(Linking.openURL).toHaveBeenLastCalledWith('https://apps.apple.com/app/id6775178022');
  (Linking.openURL as jest.Mock).mockRejectedValue(new Error('no store')); expect(await openStore()).toBe(false);
});
test('Android opens Play directly with a web fallback if the scheme is unavailable', async () => {
  expect(await openStore()).toBe(true); expect(Linking.openURL).toHaveBeenLastCalledWith('market://details?id=com.studiogameslime.soccerapp');
  (Linking.openURL as jest.Mock).mockRejectedValueOnce(new Error('no market'));
  expect(await openStore()).toBe(true); expect(Linking.openURL).toHaveBeenLastCalledWith('https://play.google.com/store/apps/details?id=com.studiogameslime.soccerapp');
});
