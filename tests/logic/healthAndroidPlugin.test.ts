import fs from 'fs';
import vm from 'vm';

test('Health Connect plugin is Android only, idempotent and opens privacy from both OS permission flows', async () => {
  const mods: Record<string, Function> = {};
  const output: Record<string, string> = {};
  const exported: { exports?: (c: any) => void } = {};
  vm.runInNewContext(fs.readFileSync('plugins/withHealth.js', 'utf8'), {
    module: exported,
    require: (id: string) => id === '../src/config/sportsActivity.json' ? { enabled: true } : id === 'fs' ? { mkdirSync: jest.fn(), writeFileSync: (p: string, s: string) => { output[p] = s; } }
      : id === 'path' ? require('path') : {
        withAndroidManifest: (c: any, fn: Function) => { mods.manifest = fn; return c; },
        withMainActivity: (c: any, fn: Function) => { mods.activity = fn; return c; },
        withDangerousMod: (c: any, [, fn]: [string, Function]) => { mods.file = fn; return c; },
        AndroidConfig: { Manifest: { getMainApplicationOrThrow: (m: any) => m.manifest.application[0] } },
      },
  });
  exported.exports!({});
  const cfg: any = { modResults: { manifest: { application: [{}] } } };
  mods.manifest(cfg); mods.manifest(cfg);
  expect(cfg.modResults.manifest['uses-permission'].map((p: any) => p.$['android:name'])).toEqual(
    ['DISTANCE', 'STEPS', 'SPEED', 'ACTIVE_CALORIES_BURNED'].map(p => `android.permission.health.READ_${p}`));
  const app = cfg.modResults.manifest.application[0];
  expect(app.activity).toHaveLength(1);
  expect(app['activity-alias']).toHaveLength(1);
  expect(app['activity-alias'][0].$['android:targetActivity']).toBe(app.activity[0].$['android:name']);
  expect(app['activity-alias'][0].$['android:permission']).toBe('android.permission.START_VIEW_PERMISSION_USAGE');
  const activity = { modResults: { language: 'kt', contents: 'package com.example\nclass MainActivity {\n super.onCreate(null)\n}' } };
  mods.activity(activity); mods.activity(activity);
  expect(activity.modResults.contents.match(/setPermissionDelegate\(this\)/g)).toHaveLength(1);
  expect(activity.modResults.contents).toContain('super.onCreate(null)\n    HealthConnectPermissionDelegate');
  await mods.file({ android: { package: 'com.example' }, modRequest: { platformProjectRoot: 'android' } });
  expect(Object.values(output)[0]).toContain('https://teamderfc.web.app/privacy');
  expect(Object.values(output)[0]).toContain('ActivityNotFoundException');
  expect(JSON.parse(fs.readFileSync('app.json', 'utf8')).expo.plugins).toContain('./plugins/withHealth.js');
});
