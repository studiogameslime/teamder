import { chooseFillPlayer, initialFillSelection, type FillSelection } from '../../src/utils/fillSelection';

test.each([4, 5, 6, 7, 8, 9, 10, 11])('manual completion works at capacity %i, without choosing the same donor twice', capacity => {
  const counts = [1, 1] as const;
  let state = initialFillSelection([capacity - 1, capacity - 1], capacity);
  expect(state.picks).toEqual([[], []]);
  state = chooseFillPlayer(state, 'guest:ori', counts, ['guest:ori', 'moshe'], false);
  expect(state).toEqual({ picks: [['guest:ori'], []], editing: 1 });
  expect(chooseFillPlayer(state, 'guest:ori', counts, ['guest:ori', 'moshe'], false)).toBe(state);
  state = chooseFillPlayer(state, 'moshe', counts, ['guest:ori', 'moshe'], false);
  expect(state.picks).toEqual([['guest:ori'], ['moshe']]);
});

test('several missing players are selected up to the deficit before focusing the next side', () => {
  let state = initialFillSelection([2, 3], 5);
  const pool = ['x', 'y', 'z', 'a', 'b'];
  for (const id of ['x', 'y']) state = chooseFillPlayer(state, id, [3, 2], pool, false);
  expect(state.editing).toBe(0);
  state = chooseFillPlayer(state, 'z', [3, 2], pool, false);
  expect(state.editing).toBe(1);
  for (const id of ['a', 'b']) state = chooseFillPlayer(state, id, [3, 2], pool, false);
  expect(state.picks).toEqual([['x', 'y', 'z'], ['a', 'b']]);
  expect(chooseFillPlayer(state, 'foreign', [3, 2], pool, false)).toBe(state);
});

test('editing a completed single slot replaces the player; tapping a selection removes it', () => {
  const state: FillSelection = { picks: [['x'], ['z']], editing: 0 };
  const next = chooseFillPlayer(state, 'y', [1, 1], ['x', 'y', 'z'], false);
  expect(next.picks).toEqual([['y'], ['z']]);
  expect(chooseFillPlayer(next, 'y', [1, 1], ['x', 'y', 'z'], false).picks).toEqual([[], ['z']]);
  expect(state.picks).toEqual([['x'], ['z']]);
});

test('a scarce last donor stays on the selected side; no second player is invented', () => {
  const state = chooseFillPlayer(initialFillSelection([3, 3], 4), 'x', [1, 1], ['x'], false);
  expect(state).toEqual({ picks: [['x'], []], editing: 0 });
});

test('sequential completion never switches to the side reserved for another step', () => {
  const state = initialFillSelection([3, 3], 4, 1);
  expect(chooseFillPlayer(state, 'x', [0, 1], ['x', 'y'], true)).toEqual({ picks: [[], ['x']], editing: 1 });
  expect(initialFillSelection([4, 3], 4).editing).toBe(1);
});
