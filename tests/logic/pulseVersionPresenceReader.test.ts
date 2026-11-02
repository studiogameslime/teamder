jest.mock('../../pulse/src/services/auth', () => ({}));
jest.mock('../../pulse/src/services/adminTransport', () => ({}));
jest.mock('../../pulse/src/services/readMeter', () => ({}));
jest.mock('../../pulse/src/config', () => ({}));
jest.mock('../../pulse/src/services/cache', () => ({}));
jest.mock('../../pulse/src/services/firebase', () => ({}));
import { parseFields } from '../../pulse/src/services/firestoreRest';
import { readDeviceVersions } from '../../pulse/src/services/deviceVersions';

test('real REST timestamp deserializer preserves private session observations without any token or push permission', () => {
  const stored = parseFields({ appSessions: { mapValue: { fields: { android: { mapValue: { fields: {
    platform: { stringValue: 'android' }, appVersion: { stringValue: '1.1.73' }, observedAt: { timestampValue: '2026-11-02T12:00:00Z' },
  } } } } } } });
  expect(readDeviceVersions(stored)).toEqual([{ version: '1.1.73', platform: 'android', device: 'פעילות באפליקציה', observedAt: Date.parse('2026-11-02T12:00:00Z') }]);
});
test('session and legacy observations keep time ordering without exposing tokens or inventing devices', () => {
  const rows = readDeviceVersions({ appSessions: { android: { platform: 'android', appVersion: '1.1.73', observedAt: 200 }, ios: { platform: 'android', appVersion: '1.1.73', observedAt: 400 } },
    fcmTokens: ['secret'], devices: { secret: { appVersion: '1.1.72', platform: 'android', registeredAt: 300 }, retired: { appVersion: '1.1.74', registeredAt: 500 } } });
  expect(rows.map(r => [r.version, r.observedAt])).toEqual([['1.1.72', 300], ['1.1.73', 200]]);
  expect(JSON.stringify(rows)).not.toContain('secret');
  expect(readDeviceVersions({ appSessions: { android: { platform: 'android', appVersion: '1.1.73', observedAt: null } } })).toEqual([]);
});
