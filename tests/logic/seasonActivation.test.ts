import { planActivation, isValidSeasonRounds, MIN_SEASON_ROUNDS } from '@/utils/seasonActivation';
const today = '2026-10-19';
const input = { cadence: 'rounds' as const, targetRounds: 24, choice: 'continue' as const, playedHistory: 18, today };
it('continues eighteen prior rounds with six remaining', () => {
  expect(planActivation(input)).toMatchObject({ ok: true, startsAtRounds: 18, roundsRemaining: 6, activeSeasonNo: 1 });
});
it('fresh history choice always starts the current season at zero', () => {
  expect(planActivation({ ...input, choice: 'fresh', playedHistory: 1000 })).toMatchObject({ ok: true, startsAtRounds: 0, roundsRemaining: 24 });
});
it('sealing history opens the following season at zero', () => {
  expect(planActivation({ ...input, choice: 'sealNow' })).toMatchObject({ ok: true, sealsSeason1: true, activeSeasonNo: 2, startsAtRounds: 0 });
});
it.each([0,1,2,3,4])('does not award historical periods with %i rounds', playedHistory => {
  expect(planActivation({ ...input, choice: 'sealNow', playedHistory }).error).toBe('sealTooFewRounds');
});
it('rejects history beyond or exactly filling an activation target', () => {
  expect(planActivation({ ...input, playedHistory: 25 }).error).toBe('historyExceedsTarget');
  expect(planActivation({ ...input, playedHistory: 24 }).error).toBe('historyFillsTarget');
});
it('same-type editing can identify a reached target without closing immediately', () => {
  expect(planActivation({ ...input, playedHistory: 24, equalTargetCloses: true })).toMatchObject({ ok: true, closesSeasonNow: true, roundsRemaining: 0 });
});
it('applies the five-to-two-hundred limits, including history expansion', () => {
  expect(MIN_SEASON_ROUNDS).toBe(5);
  for (const n of [0,1,2,4,4.5,201,NaN,Infinity]) expect(isValidSeasonRounds(n)).toBe(false);
  for (const n of [5,24,200]) expect(isValidSeasonRounds(n)).toBe(true);
  expect(isValidSeasonRounds(405,205)).toBe(true); expect(isValidSeasonRounds(406,205)).toBe(false);
});
it('computes historical date targets from the first included round, ignoring the removed date picker', () => {
  expect(planActivation({ ...input, cadence: 'date', months: 3, historyStartsOn: '2026-09-16', season1EndsOn: '2026-10-31' }))
    .toMatchObject({ ok: true, startsOn: '2026-09-16', endsOn: '2026-12-15' });
});
it('a historical date target already passed cannot be activated', () => {
  expect(planActivation({ ...input, cadence: 'date', months: 1, historyStartsOn: '2026-01-01' }).error).toBe('season1EndNotFuture');
});
it.each([0,25,1.5,NaN])('rejects %i months', months => {
  expect(planActivation({ ...input, cadence: 'date', months }).error).toBe('monthsInvalid');
});
it('fresh date target starts today even if the club history spans years', () => {
  expect(planActivation({ ...input, choice: 'fresh', cadence: 'date', months: 3, historyStartsOn: '2020-01-01' }))
    .toMatchObject({ ok: true, startsOn: today, endsOn: '2027-01-18' });
});
