import fs from 'fs';
import os from 'os';
import path from 'path';
import vm from 'vm';
import ts from 'typescript';
import React from 'react';
import { SPORTS_ACTIVITY_ENABLED, SportsActivityDisabledError, assertSportsActivityEnabled } from '../../src/config/sportsActivity';

function load(file: string, imports: Record<string, any>) {
  const exports: any = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText, { exports, require: (id: string) => {if(id.endsWith('/joinDiagnosticId'))return require('@/utils/joinDiagnosticId');if(id.endsWith('/diagnosticJournal'))return require('@/services/diagnosticJournal');if(id==='@/services/diagnosticCallable')id='firebase/functions';
    if (id === '@/config/sportsActivity') return { SPORTS_ACTIVITY_ENABLED, SportsActivityDisabledError, assertSportsActivityEnabled };
    if (!(id in imports)) throw Error('Missing fixture ' + id);
    return imports[id];
  }, setInterval: jest.fn(), clearInterval: jest.fn(), Map, Set, JSON });
  return exports;
}
const observe = { observeCaughtError: jest.fn() };
test('release switch is off and blocked work has a distinct error', () => {
  expect(SPORTS_ACTIVITY_ENABLED).toBe(false);
  expect(assertSportsActivityEnabled).toThrow(SportsActivityDisabledError);
});
test('phone measurement cannot ask for location, notifications or native sensor data', async () => {
  const request = jest.fn(), start = jest.fn(), snapshot = jest.fn();
  const f = load('src/services/phoneActivity.ts', {
    'react-native': { NativeModules: { PhoneActivity: { start, snapshot } }, Platform: { OS: 'android', Version: 36 }, PermissionsAndroid: { request } },
    'expo-location': { requestForegroundPermissionsAsync: request }, '@/utils/errorObservation': observe,
    '@/store/userStore': { useUserStore: { subscribe: jest.fn(), getState: jest.fn() } },
  });
  expect(f.phoneMeasurementAvailable).toBe(false);
  await expect(f.startPhoneMeasurement()).rejects.toBeInstanceOf(SportsActivityDisabledError);
  await expect(f.readPhoneMeasurement()).rejects.toBeInstanceOf(SportsActivityDisabledError);
  expect(request).not.toHaveBeenCalled(); expect(start).not.toHaveBeenCalled(); expect(snapshot).not.toHaveBeenCalled();
});
test('health discovery, reads and consent stop before loading the native provider', async () => {
  const nativeLoad = jest.fn();
  const f = load('src/services/myActivityHealthConnect.ts', {
    '../utils/activityProviders': {}, 'react-native': { Platform: { OS: 'android' } },
    '../utils/errorObservation': observe, '../utils/activityMovement': {}, 'react-native-health-connect': nativeLoad,
  });
  await expect(f.requestActivityHealthPermissions()).rejects.toBeInstanceOf(SportsActivityDisabledError);
  await expect(f.discoverActivityHealthOrigins(1000, 2000)).rejects.toBeInstanceOf(SportsActivityDisabledError);
  await expect(f.readActivityHealthWindow('vendor.app', 1000, 2000)).rejects.toBeInstanceOf(SportsActivityDisabledError);
  expect(nativeLoad).not.toHaveBeenCalled();
});
test('daily state, source changes and queued uploads never call Firebase or acknowledge old data', async () => {
  const callable = jest.fn(), getFirebase = jest.fn(), ack = jest.fn();
  const f = load('src/services/myActivityService.ts', {
    'react-native': { NativeModules: { WatchBridge: { ackStandaloneActivity: ack } }, Platform: { OS: 'android' } },
    'firebase/functions': { httpsCallable: callable }, '@/firebase/config': { getFirebase }, '@/store/userStore': {},
    './staleSession': {}, '../utils/errorObservation': observe, '../utils/activityMovement': {},
  });
  await expect(f.getMyActivityState('u')).rejects.toBeInstanceOf(SportsActivityDisabledError);
  await expect(f.setMyActivitySource('u', 1, null)).rejects.toBeInstanceOf(SportsActivityDisabledError);
  await expect(f.flushMyActivity('u')).rejects.toBeInstanceOf(SportsActivityDisabledError);
  expect(callable).not.toHaveBeenCalled(); expect(getFirebase).not.toHaveBeenCalled(); expect(ack).not.toHaveBeenCalled();
});
test('app bootstrap does not subscribe, schedule or upload sports records', async () => {
  const effect: Function[] = [], subscribe = jest.fn(), callable = jest.fn();
  const f = load('src/services/personalActivityService.ts', {
    react: { useEffect: (fn: Function) => effect.push(fn) },
    'react-native': { NativeModules: {}, Platform: { OS: 'android' }, AppState: { addEventListener: subscribe } },
    'firebase/functions': { httpsCallable: callable }, '@/firebase/config': {}, '@/store/userStore': {},
    '@/services/staleSession': {}, '../utils/errorObservation': observe,
  });
  f.usePersonalActivitySync('u'); effect.forEach(fn => fn());
  await expect(f.flushPersonalActivity('u')).rejects.toBeInstanceOf(SportsActivityDisabledError);
  await expect(f.getMyPersonalActivity('g', 'u')).resolves.toEqual({ status: 'unavailable', summary: null, reason: 'feature-disabled' });
  expect(callable).not.toHaveBeenCalled(); expect(subscribe).not.toHaveBeenCalled();
});
test('a retained navigation route renders no activity hook, dashboard or permission action', () => {
  const hook = jest.fn();
  const f = load('src/screens/profile/MyActivityScreen.tsx', {
    react: React, 'react-native': { View: 'View', Text: 'Text', StyleSheet: { create: (v: any) => v } },
    '@/components/SafeModal': {}, '@/utils/errorObservation': observe,
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' }, '@expo/vector-icons': {},
    '@/components/ScreenHeader': { ScreenHeader: 'Header' }, '@/components/ScrollSurface': {},
    '@/components/activity/MyActivityDashboard': {}, '@/components/activity/ActivityProviderIcon': {},
    '@/utils/activityProviders': {}, '@/services/useMyActivity': { useMyActivity: hook },
    '@/theme/rtl': {}, '@/components/activity/PhoneActivityTest': {}, '@/services/phoneActivity': {},
  });
  const tree = f.MyActivityScreen();
  expect(tree.type).toBe('SafeAreaView'); expect(JSON.stringify(tree)).toContain('הפעילות אינה זמינה כרגע');
  expect(hook).not.toHaveBeenCalled();
});
test.each(['withHealth', 'withPhoneActivity'])('%s registers no sports permissions or services while disabled', name => {
  const register = jest.fn(); const module: any = {};
  vm.runInNewContext(fs.readFileSync(`plugins/${name}.js`, 'utf8'), { module, require: (id: string) =>
    {if(id.endsWith('/joinDiagnosticId'))return require('@/utils/joinDiagnosticId');if(id.endsWith('/diagnosticJournal'))return require('@/services/diagnosticJournal');if(id==='@/services/diagnosticCallable')id='firebase/functions';return id.endsWith('sportsActivity.json') ? { enabled: false } : id === 'fs' ? fs : id === 'path' ? path : new Proxy({}, { get: () => register });} });
  const config = {}; expect(module.exports(config)).toBe(config); expect(register).not.toHaveBeenCalled();
});
test('clean native generation removes sports scopes and service and shares the disabled switch with both native packages', () => {
  const mods: Function[] = []; const module: any = {};
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'teamder-sports-off-'));
  try {
    vm.runInNewContext(fs.readFileSync('plugins/withWearApp.js', 'utf8'), { module, __dirname: path.resolve('plugins'), require: (id: string) =>
      {if(id.endsWith('/joinDiagnosticId'))return require('@/utils/joinDiagnosticId');if(id.endsWith('/diagnosticJournal'))return require('@/services/diagnosticJournal');if(id==='@/services/diagnosticCallable')id='firebase/functions';return id.endsWith('sportsActivity.json') ? { enabled: false } : id === 'fs' ? fs : id === 'path' ? path : {
        withDangerousMod: (c: any, [, fn]: any) => { mods.push(fn); return c; },
        ...Object.fromEntries(['withSettingsGradle', 'withAppBuildGradle', 'withMainApplication', 'withAndroidManifest'].map(k => [k, (c: any) => c])),
      };} });
    module.exports({}); mods[0]({ modRequest: { platformProjectRoot: root } });
    const manifest = fs.readFileSync(path.join(root, 'wear/src/main/AndroidManifest.xml'), 'utf8');
    expect(manifest).not.toMatch(/ACTIVITY_RECOGNITION|BODY_SENSORS|health.READ_HEART_RATE|FOREGROUND_SERVICE_HEALTH|PersonalExerciseService/);
    expect(manifest).toContain('POST_NOTIFICATIONS'); expect(manifest).toContain('TeamderTileService');
    for (const folder of ['wear/src/main/java/com/studiogameslime/soccerapp/wear', 'app/src/main/java/com/studiogameslime/soccerapp/watch']) {
      expect(fs.readFileSync(path.join(root, folder, 'SportsActivity.kt'), 'utf8')).toContain('ENABLED = false');
    }
    const blocked = JSON.parse(fs.readFileSync('app.json', 'utf8')).expo.android.blockedPermissions;
    expect(blocked).toEqual(expect.arrayContaining(['android.permission.ACTIVITY_RECOGNITION', 'android.permission.health.READ_STEPS', 'android.permission.FOREGROUND_SERVICE_HEALTH']));
    expect(blocked).not.toContain('android.permission.ACCESS_FINE_LOCATION');
  } finally {
    if (path.dirname(path.resolve(root)) !== path.resolve(os.tmpdir())) throw Error('Unexpected temporary directory');
    fs.rmSync(root, { recursive: true, force: true });
  }
});
