import React from 'react';
const { renderToStaticMarkup } = require('react-dom/server') as { renderToStaticMarkup: (element: React.ReactNode) => string };
jest.mock('react-native', () => ({ View: 'div', Text: 'span', StyleSheet: { create: (x: unknown) => x } }));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: jest.fn() }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@/components/InfoTip', () => ({ InfoTip: () => null }));
jest.mock('@/theme', () => ({ colors: {}, radius: {}, shadows: {}, spacing: {}, typography: {}, RTL_LABEL_ALIGN: 'left' }));
jest.mock('@/services/seasonService', () => ({ seasonService: { sync: jest.fn() } }));
import { readGroupSeasons } from '@/firebase/firestore';
import { SeasonsCard } from '@/components/community/SeasonsCard';

const base = { enabled: true, currentId: 's3', currentNo: 3, startedAt: Date.now() - 10 * 86400000,
  playedRounds: 7, cadence: { type: 'rounds', targetRounds: 7 },
  pendingClose: { seasonId: 's3', dueAt: Date.now() - 2 * 86400000, closeAt: Date.now() - 86400000 } };
const render = (closureStatus?: unknown, isMember = true) => renderToStaticMarkup(<SeasonsCard groupId="club" isMember={isMember}
  seasons={readGroupSeasons({ ...base, closureStatus })} />);
test('a diagnosis survives the real converter and replaces the misleading completed-timer line with dates and reasons', () => {
  const html = render({ seasonId: 's3', since: 1, active: 0, unverified: 0, unsealed: 2,
    rounds: [{ id: 'g1', startsAt: Date.parse('2026-10-15T12:00:00Z'), reason: 'unsealed' }, { id: 'g2', reason: 'unsealed' }] });
  expect(html).toContain('2 מחזורים'); expect(html).toContain('15'); expect(html).toContain('ללא מועד');
  expect(html).toContain('אין צורך להזין מחדש תוצאות'); expect(html).not.toContain('משלימים את סגירת');
  expect(html).not.toContain('ממתינים לבדיקת הסגירה');
});
test('active rounds, admin verification and server processing are visible together', () => {
  const html = render({ seasonId: 's3', since: 1, active: 1, unverified: 1, unsealed: 1, rounds: [] });
  expect(html).toContain('מחזור פעיל'); expect(html).toContain('מנהל המועדון'); expect(html).toContain('סיכום');
});
test('an older server without a diagnosis does not pretend to know why, and nonmembers see no private diagnosis', () => {
  expect(render()).toContain('ממתינים לבדיקת הסגירה האוטומטית');
  expect(render({ seasonId: 's3', since: 1, active: 0, unverified: 0, unsealed: 1, rounds: [] }, false)).toBe('');
});
