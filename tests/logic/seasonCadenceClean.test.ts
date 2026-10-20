import { makeSeasonTarget } from '@/utils/seasonPolicy';
import { makeSeasonTarget as serverTarget } from '../../functions/src/seasonPolicy';
describe.each([makeSeasonTarget, serverTarget])('target fields stay exclusive on both sides', make => {
  it('switching to rounds clears all previous date fields even with a map merge', () => {
    const old = make('date', 6, '2026-09-01');
    const changed = { ...old, ...make('rounds', 24, '2026-09-01') };
    expect(changed).toEqual({ type: 'rounds', targetRounds: 24, months: null, endsAt: null, startsOn: null, endsOn: null });
  });
  it('switching to months clears the previous rounds target', () => {
    const changed = { ...make('rounds', 24, '2026-09-01'), ...make('date', 3, '2026-09-01') };
    expect(changed.targetRounds).toBeNull(); expect(changed.endsOn).toBe('2026-11-30'); expect(changed.type).toBe('date');
  });
});
