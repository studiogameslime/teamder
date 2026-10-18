import type { DraftTeamsResult } from '@/types';
import { changeOpeningColor, chooseOpeningTeam, initialOpeningPlan, moveOpeningWaiting, openingFingerprint, shuffleOpening } from '@/utils/openingTeams';

const draft = (count = 5) => ({ teams: Array.from({ length: count }, (_, index) => ({ index, captainId: `p${index}`, playerIds: [`p${index}`] })) } as DraftTeamsResult);
test('three or more teams begin without an accidental starting pair', () => {
  const plan = initialOpeningPlan(draft());
  expect(plan.selected).toEqual([]);
  expect(plan.waiting).toEqual([0, 1, 2, 3, 4]);
  expect(initialOpeningPlan(draft(2)).selected).toEqual([0, 1]);
});
test('a third choice never silently removes a selected team', () => {
  const plan = chooseOpeningTeam(chooseOpeningTeam(initialOpeningPlan(draft()), 0), 1);
  expect(chooseOpeningTeam(plan, 2)).toBe(plan);
  const next = chooseOpeningTeam(chooseOpeningTeam(plan, 0), 2);
  expect(next.selected).toEqual([1, 2]);
  expect(next.waiting).toEqual([3, 4, 0]);
});
test('shuffling includes the waiting order without changing colours', () => {
  const original = initialOpeningPlan(draft());
  const next = shuffleOpening(original, () => 0);
  expect(next.selected).toHaveLength(2);
  expect([...next.selected, ...next.waiting].sort()).toEqual([0, 1, 2, 3, 4]);
  expect(next.colors).toEqual(original.colors);
  expect(original.selected).toEqual([]);
});
test('queue controls preserve the chosen match and stop at the bounds', () => {
  const plan = shuffleOpening(initialOpeningPlan(draft()), () => 0);
  expect(moveOpeningWaiting(plan, plan.waiting[0], -1)).toBe(plan);
  const next = moveOpeningWaiting(plan, plan.waiting[1], -1);
  expect(next.selected).toEqual(plan.selected);
  expect(next.waiting).toEqual([plan.waiting[1], plan.waiting[0], plan.waiting[2]]);
});
test('taken colours exchange atomically and keep the match and queue', () => {
  const plan = shuffleOpening(initialOpeningPlan(draft()), () => 0);
  const next = changeOpeningColor(plan, 0, 'blue');
  expect(next.colors[0]).toBe('blue'); expect(next.colors[1]).toBe('red');
  expect(new Set(Object.values(next.colors)).size).toBe(5);
  expect(next.selected).toEqual(plan.selected); expect(next.waiting).toEqual(plan.waiting);
  expect(plan.colors[0]).toBe('red');
});
test('saved custom colours win over colliding defaults and survive restore', () => {
  const d = draft(3); d.teams[0].colorKey = 'green';
  const plan = initialOpeningPlan(d);
  expect(plan.colors[0]).toBe('green'); expect(new Set(Object.values(plan.colors)).size).toBe(3);
  const edited = changeOpeningColor(plan, 2, 'white');
  expect(initialOpeningPlan(d, edited)).toEqual(edited);
  const previous = openingFingerprint(d); d.teams[1].playerIds.push('new');
  expect(openingFingerprint(d)).not.toBe(previous);
});
