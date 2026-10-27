import { activityProvider, matchesActivityProvider } from '../../src/utils/activityProviders';
test('phone synthetic origins are recognized without hardcoding a device token', () => {
  expect(activityProvider('com.android.healthconnect.phone.random-device')).toMatchObject({ label: 'הטלפון שלי', icon: 'phone' });
  expect(matchesActivityProvider('com.android.healthconnect.phone.another-device', 'phone')).toBe(true);
  expect(matchesActivityProvider('com.google.android.apps.fitness', 'phone')).toBe(false);
});
test('known sources have a stable brand and unknown sources never display package identifiers', () => {
  expect(activityProvider('com.google.android.apps.fitness')).toMatchObject({ label: 'גוגל פיט', icon: 'fit' });
  expect(activityProvider('private.vendor').label).not.toContain('private.vendor');
  expect(matchesActivityProvider('com.google.android.apps.fitness.fake', 'com.google.android.apps.fitness')).toBe(false);
});
