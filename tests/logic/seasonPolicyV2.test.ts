import * as client from '@/utils/seasonPolicy';
import * as server from '../../functions/src/seasonPolicy';
import { computeSeasonAwards, type SeasonPlayerLine } from '@/utils/seasonAwards';
import { isOrganizedEveningAwaitingDecision } from '@/utils/eveningPlayed';
const now = Date.parse('2026-10-19T10:00:00Z');
const target = (n: number) => client.makeSeasonTarget('rounds', n, '2026-10-01');
describe.each([client, server])('approved season policy on each side of the wire', policy => {
  it('requires five evenings and limits a normal season to 200', () => {
    for (const n of [0, 1, 2, 4, 4.5, 201, Infinity, NaN]) expect(policy.validateSeasonTarget({ target: target(n), played: 0, now }).ok).toBe(false);
    for (const n of [5, 24, 200]) expect(policy.validateSeasonTarget({ target: target(n), played: 0, now }).ok).toBe(true);
  });
  it('permits up to 200 further evenings when including 205 existing evenings', () => {
    expect(policy.maxSeasonTarget(205)).toBe(405);
    expect(policy.validateSeasonTarget({ target: target(405), played: 205, includedHistory: 205, now }).ok).toBe(true);
    expect(policy.validateSeasonTarget({ target: target(406), played: 205, includedHistory: 205, now }).ok).toBe(false);
  });
  it('allows equality for the same goal type, but never a goal behind the progress', () => {
    expect(policy.validateSeasonTarget({ target: target(19), previousType: 'rounds', played: 19, now })).toEqual({ ok: true, due: true });
    expect(policy.validateSeasonTarget({ target: target(18), previousType: 'rounds', played: 19, now }).ok).toBe(false);
  });
  it('a type switch must leave progress in the future', () => {
    expect(policy.validateSeasonTarget({ target: target(19), previousType: 'date', played: 19, now }).error).toBe('switchTargetReached');
    expect(policy.validateSeasonTarget({ target: target(20), previousType: 'date', played: 19, now }).ok).toBe(true);
  });
  it('counts inclusive Jerusalem calendar days even when UTC is still yesterday', () => {
    const date = policy.makeSeasonTarget('date', 1, '2026-09-20');
    expect(date.endsOn).toBe('2026-10-19');
    expect(policy.seasonTargetDue(date, 10, Date.parse('2026-10-19T20:59:59Z'))).toBe(false);
    expect(policy.seasonTargetDue(date, 10, Date.parse('2026-10-19T21:00:00Z'))).toBe(true);
  });
  it('pauses once, preserves six hours, and resumes exactly those six hours later', () => {
    const window: client.CorrectionWindow = { seasonId: 's2', dueAt: now - 18 * 3600000, closeAt: now + 6 * 3600000, reason: 'rounds' };
    const paused = policy.updateCorrectionWindow(window, 2, now);
    expect(paused.remainingMs).toBe(6 * 3600000);
    expect(policy.updateCorrectionWindow(paused, 1, now + 86400000).remainingMs).toBe(6 * 3600000);
    const resumed = policy.updateCorrectionWindow(paused, 0, now + 86400000);
    expect(resumed.closeAt).toBe(now + 30 * 3600000);
    expect(resumed.pausedAt).toBeUndefined();
    expect(policy.correctionTimeLeft(resumed, now + 31 * 3600000)).toBe(0);
  });
});

const player = (uid: string, games: number, avg: number, ratedRounds: number): SeasonPlayerLine => ({
  uid, games, mvpAvg: avg, ratedRounds, rounds: games * 3, goals: 0, assists: 0, wins: 0, cleanSheets: 0,
  penTaken: 0, penScored: 0, penFaced: 0, penSaved: 0,
});
it('averages actual grades, rounds to two decimals, and shares a tie after rounding', () => {
  const avg = (7.6 + 8.5 + 8) / 3;
  const awards = computeSeasonAwards([player('a', 3, avg, 3), player('b', 4, 8.034, 2)], [], 6);
  expect(awards.mvp).toEqual({ winners: ['a', 'b'], value: 8.03 });
});
it('requires half the entire season, not half of the maximum player attendance', () => {
  expect(computeSeasonAwards([player('a', 4, 10, 4), player('b', 3, 9, 3)], [], 10).mvp).toBeNull();
});
it('does not mistake a genuine six for a missing score', () => {
  expect(computeSeasonAwards([player('a', 5, 6, 5), player('missing', 5, 6, 0)], [], 5).mvp).toEqual({ winners: ['a'], value: 6 });
});
it('cumulative titles have no attendance gate and a single mutual assist wins the pair title', () => {
  const a = { ...player('visitor', 1, 10, 1), goals: 12 };
  const awards = computeSeasonAwards([a], [{ a: 'visitor', b: 'friend', score: 1, together: 1 }], 20);
  expect(awards.topScorer?.winners).toEqual(['visitor']);
  expect(awards.mvp).toBeNull(); expect(awards.deadlyDuo?.value).toBe(1);
});
it('organising without entering live can be resolved after its date, while future or played rounds are protected', () => {
  expect(isOrganizedEveningAwaitingDecision({ status: 'open', startsAt: now - 1 }, now)).toBe(true);
  expect(isOrganizedEveningAwaitingDecision({ status: 'locked', startsAt: now - 1 }, now)).toBe(true);
  expect(isOrganizedEveningAwaitingDecision({ status: 'open', startsAt: now + 1 }, now)).toBe(false);
  expect(isOrganizedEveningAwaitingDecision({ status: 'active', startsAt: now - 1 }, now)).toBe(false);
  expect(isOrganizedEveningAwaitingDecision({ status: 'open', startsAt: now - 1, committedRoundCount: 1 }, now)).toBe(false);
});
it('allows scheduling after the correction deadline and postpones its earliest date while paused', () => {
  expect(client.seasonScheduleBoundary(undefined, now)).toBeNull();
  expect(client.seasonScheduleBoundary({ pendingClose: { closeAt: now + 1000 } }, now)).toBe(now + 1000);
  expect(client.seasonScheduleBoundary({ pendingClose: { closeAt: now - 1000, pausedAt: now - 2000, remainingMs: 6 * 3600000 } }, now)).toBe(now + 6 * 3600000);
  expect(client.seasonScheduleBoundary({ operation: { kind: 'enable' } }, now)).toBe(Infinity);
});
