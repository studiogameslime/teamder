import { completeSeasonHistory } from '../../src/utils/completeSeasonHistory';

test('a partially returned season list cannot be labelled an all-time total', () => {
  expect(completeSeasonHistory(3, 2, [{ goals: 7 }, { goals: 8 }])).toBe(false);
});
test('a missing sealed table blocks the sum even with a complete card list', () => {
  expect(completeSeasonHistory(2, 2, [{ goals: 7 }, null])).toBe(false);
  expect(completeSeasonHistory(2, 2, [{ goals: 7 }])).toBe(false);
});
test('clubs without closed seasons and fully loaded historical zero tables are valid', () => {
  expect(completeSeasonHistory(0, 0, [])).toBe(true);
  expect(completeSeasonHistory(2, 2, [{ goals: 0 }, { goals: 0 }])).toBe(true);
});
