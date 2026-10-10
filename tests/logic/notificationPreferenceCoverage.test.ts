import fs from 'fs';
import path from 'path';
import { defaultNotificationPrefs } from '@/types';
import { NOTIFICATION_CATEGORIES } from '@/utils/notificationPreferenceCatalog';
import { mergeNotificationPreferences } from '@/utils/notificationPreferences';

const rows = NOTIFICATION_CATEGORIES.flatMap(category => category.rows);

test('every backend notification type has exactly one visible preference control', () => {
  const server = fs.readFileSync(path.join(__dirname, '../../functions/src/index.ts'), 'utf8');
  const union = server.match(/type NotificationType\s*=([\s\S]*?);/)?.[1];
  expect(union).toBeDefined();
  const types = [...union!.matchAll(/\|\s*'([^']+)'/g)].map(match => match[1]);
  const mapping = server.replace(/\/\/[^\n]*/g, '').match(/const prefKey\s*=([\s\S]*?);/)?.[1];
  expect(mapping).toBeDefined();
  const serverPreference = new Function('type', `return (${mapping});`) as (type: string) => string;
  expect(types.length).toBeGreaterThanOrEqual(30);
  for (const type of types) {
    const key = serverPreference(type);
    expect(rows.filter(row => row.key === key)).toHaveLength(1);
    expect(typeof defaultNotificationPrefs[key as keyof typeof defaultNotificationPrefs]).toBe('boolean');
  }
  expect(rows.map(row => row.key).sort()).toEqual(Object.keys(defaultNotificationPrefs).sort());
  for (const row of rows) {
    expect(row.label.trim()).not.toBe('');
    expect(row.sub.trim()).not.toBe('');
  }
});

test('every visible preference preserves false through hydration and a JSON round trip', () => {
  for (const row of rows) {
    const saved = { [row.key]: false };
    const hydrated = mergeNotificationPreferences(JSON.parse(JSON.stringify(saved)));
    expect(hydrated[row.key]).toBe(false);
    expect(mergeNotificationPreferences(hydrated)[row.key]).toBe(false);
  }
});

test('partial private preferences do not reset legacy opt-outs; explicit private choices win', () => {
  expect(mergeNotificationPreferences({ seasonSummary: false, spotOffered: false }, { friendRequest: false }))
    .toMatchObject({ seasonSummary: false, spotOffered: false, friendRequest: false });
  expect(mergeNotificationPreferences({ seasonSummary: false }, { seasonSummary: true }).seasonSummary).toBe(true);
  expect(mergeNotificationPreferences({ seasonSummary: false }, { seasonSummary: 'true', arbitrary: false }).seasonSummary).toBe(false);
  expect(mergeNotificationPreferences(null, undefined).seasonSummary).toBe(true);
});
