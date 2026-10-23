import { readGroupSeasons } from '@/firebase/firestore';
import { seasonClosureMessages } from '@/utils/seasonClosureStatus';

const status = { seasonId: 's3', since: 100, active: 0, unverified: 0, unsealed: 2,
  rounds: [{ id: 'one', startsAt: 100, reason: 'unsealed' }, { id: 'two', reason: 'unsealed' }] };
const read = (closureStatus: unknown, currentId = 's3') => readGroupSeasons({ enabled: true, currentId, closureStatus });

test('real Firestore converter carries missing-summary diagnosis and dates to the UI', () => {
  expect(read(status)?.closureStatus).toEqual(status);
  const lines = seasonClosureMessages(read(status)?.closureStatus);
  expect(lines.join(' ')).toContain('2 מחזורים');
  expect(lines.join(' ')).toContain('אוטומטית');
  expect(lines.join(' ')).toContain('אין צורך להזין מחדש תוצאות');
  expect(lines.join(' ')).not.toContain('ממתינים לאימות');
});
test('every simultaneous blocker has a distinct explanation', () => {
  const lines = seasonClosureMessages({ ...read(status)!.closureStatus!, active: 1, unverified: 1 });
  expect(lines).toHaveLength(3);
  expect(lines[0]).toContain('מחזור פעיל');
  expect(lines[1]).toContain('מנהל המועדון');
  expect(lines[2]).toContain('סיכומי');
});
test('an old season diagnosis cannot leak to the next season or manufacture an all-clear', () => {
  expect(read(status, 's4')).not.toHaveProperty('closureStatus');
  expect(read(undefined)).not.toHaveProperty('closureStatus');
  for (const bad of [{ ...status, unsealed: -1 }, { ...status, since: NaN }, { ...status, unverified: '0' }]) {
    expect(read(bad)).not.toHaveProperty('closureStatus');
  }
  expect(seasonClosureMessages(undefined)).toEqual([]);
});
