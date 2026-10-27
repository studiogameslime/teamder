import { mergePersonalActivityWindows, personalActivityEligibility, personalActivityPlayerIds, personalActivityWindows,
  type PersonalActivityGame, type PersonalActivityTimeline } from '../../src/utils/personalActivityWindows';
import { exchangeLivePlayers } from '../../src/utils/liveSubstitution';
import type { DraftTeamsResult, MatchRotation } from '../../src/types';

const timeline = (entries: Array<[number, string[]]>): PersonalActivityTimeline => ({ version: 1,
  startedAt: entries[0][0], entries: entries.map(([at, playerIds]) => ({ at, playerIds })) });
const game = (history = timeline([[0, ['a']], [40, ['b']], [80, ['a']]])): PersonalActivityGame => ({
  status: 'active', personalActivityTimeline: history,
  liveMatch: { activeIntervals: [{ s: 10, e: 30 }, { s: 20, e: 60 }, { s: 70, e: 100 }] },
});

test('substitution intersects only running timer segments, merging duplicate clock data', () => {
  expect(personalActivityWindows(game(), 'a', 100)).toEqual({ status: 'available',
    windows: [{ from: 10, to: 40 }, { from: 80, to: 100 }], eligibleMs: 50, timerMs: 80, knownFrom: 0 });
  expect(personalActivityWindows(game(), 'b', 100).windows).toEqual([{ from: 40, to: 60 }, { from: 70, to: 80 }]);
});

test('waiting player has a proven zero, while missing history remains unavailable', () => {
  expect(personalActivityWindows(game(), 'waiting', 100)).toMatchObject({ status: 'available', eligibleMs: 0 });
  expect(personalActivityWindows({ liveMatch: game().liveMatch }, 'a', 100)).toMatchObject({ status: 'unavailable', reason: 'missing-history' });
});

test('history begins at proven coverage without borrowing final lineup for earlier minutes', () => {
  expect(personalActivityWindows(game(timeline([[50, ['a']]])), 'a', 100)).toMatchObject({
    windows: [{ from: 50, to: 60 }, { from: 70, to: 100 }], eligibleMs: 40, timerMs: 40, knownFrom: 50,
  });
});

test('live measurement includes the open timer interval up to the requested boundary', () => {
  const state = game(timeline([[0, ['a']], [90, []]]));
  state.liveMatch = { timerRunning: true, timerLastStartedAt: 50, activeIntervals: [{ s: 0, e: 20 }] };
  expect(personalActivityWindows(state, 'a', 100).windows).toEqual([{ from: 0, to: 20 }, { from: 50, to: 90 }]);
});

test.each(['finished', 'cancelled'])('terminal %s never extrapolates an unclosed timer', status => {
  const state = game(timeline([[0, ['a']]]));
  state.status = status;
  state.liveMatch = { timerRunning: true, timerLastStartedAt: 50, activeIntervals: [{ s: 0, e: 20 }] };
  expect(personalActivityWindows(state, 'a', 100).windows).toEqual([{ from: 0, to: 20 }]);
});

test('the exact substitution instant belongs only to the incoming player', () => {
  const state = game(timeline([[0, ['a']], [50, ['b']]]));
  state.liveMatch = { activeIntervals: [{ s: 50, e: 80 }] };
  expect(personalActivityWindows(state, 'a', 80).eligibleMs).toBe(0);
  expect(personalActivityWindows(state, 'b', 80).eligibleMs).toBe(30);
});

test('reset and next game do not erase closed evening participation windows', () => {
  const state = game(timeline([[0, ['a']], [30, ['b']], [60, ['a']]]));
  state.liveMatch = { timerRunning: false, timerLastStartedAt: null, activeIntervals: [{ s: 0, e: 30 }, { s: 60, e: 90 }] };
  expect(personalActivityWindows(state, 'a', 100).eligibleMs).toBe(60);
});

test.each([
  timeline([[20, ['a']], [10, ['b']]]),
  timeline([[20, ['a']], [20, ['b']]]),
  { ...timeline([[0, ['a']]]), startedAt: 1 },
  { ...timeline([[0, ['a']]]), entries: [{ at: NaN, playerIds: ['a'] }] },
])('ambiguous or malformed membership evidence is unavailable: %j', history => {
  expect(personalActivityWindows(game(history), 'a', 100).status).toBe('unavailable');
});

test('invalid clock segments cannot create negative time or double count overlaps', () => {
  const state = game(timeline([[0, ['a']]]));
  state.liveMatch = { activeIntervals: [{ s: -10, e: 10 }, { s: 80, e: 20 }, { s: NaN, e: 40 }, { s: 20, e: 60 }, { s: 50, e: 200 }] };
  expect(personalActivityWindows(state, 'a', 100).windows).toEqual([{ from: 20, to: 100 }]);
});

test('caller-provided arrays are not mutated during canonicalization', () => {
  const rows = [{ from: 20, to: 30 }, { from: 10, to: 20 }];
  expect(mergePersonalActivityWindows(rows)).toEqual([{ from: 10, to: 30 }]);
  expect(rows).toEqual([{ from: 20, to: 30 }, { from: 10, to: 20 }]);
});

test('effective rotation lineup includes a loan into playing side and excludes waiting, loaned out and left-home players', () => {
  const state: PersonalActivityGame = {
    draftTeams: { teams: [{ index: 2, playerIds: ['a', 'left'] }, { index: 5, playerIds: ['b'] }, { index: 7, playerIds: ['filler', 'waiting'] }], leftHome: [{ playerId: 'left' }] },
    rotation: { playing: [2, 5], loans: [{ playerId: 'filler', homeTeam: 7, filledTeam: 2 }, { playerId: 'a', homeTeam: 2, filledTeam: 7 }] },
    liveMatch: { assignments: { stale: 'teamA' } },
  };
  expect(personalActivityPlayerIds(state)).toEqual(['b', 'filler']);
});

test('simple match accepts both keepers but excludes bench and waiting teams', () => {
  expect(personalActivityPlayerIds({ liveMatch: { assignments: {
    a: 'teamA', b: 'teamB', ka: 'gkA', kb: 'gkB', waiting: 'teamC', bench: 'bench', invalid: 'A',
  } } })).toEqual(['a', 'b', 'ka', 'kb']);
});

test('invalid rotation must not fall back to stale simple assignments', () => {
  expect(personalActivityPlayerIds({ draftTeams: { teams: [{ index: 1, playerIds: ['a'] }] },
    rotation: { playing: [1, 1] }, liveMatch: { assignments: { a: 'teamA' } } })).toEqual([]);
});

test('current sensor eligibility requires both on-field membership and a valid running timer', () => {
  const state: PersonalActivityGame = { status: 'active', liveMatch: { timerRunning: true,
    timerLastStartedAt: 10, assignments: { a: 'teamA', b: 'bench' } } };
  expect(personalActivityEligibility(state, 'a', 20)).toEqual({ eligible: true, onField: true, timerRunning: true });
  expect(personalActivityEligibility(state, 'b', 20).eligible).toBe(false);
  expect(personalActivityEligibility(state, 'a', 5).eligible).toBe(false);
  state.liveMatch!.timerRunning = false;
  expect(personalActivityEligibility(state, 'a', 20).eligible).toBe(false);
});

test('connected temporary swaps preserve actual field membership through multiple exchanges', () => {
  let draft = { teams: [0, 1, 2].map((index, i) => ({ index, playerIds: [['a'], ['b'], ['c']][i], captainId: ['a', 'b', 'c'][i] })) } as DraftTeamsResult;
  let rotation: MatchRotation = { playing: [0, 1], waiting: [2], loans: [], roundInstanceId: 'same-game' };
  const entries = [{ at: 0, playerIds: personalActivityPlayerIds({ draftTeams: draft, rotation }) }];
  for (const [at, a, b] of [[20, 'a', 'c'], [50, 'c', 'b'], [80, 'b', 'a']] as const) {
    const result = exchangeLivePlayers(draft, rotation, a, b, 'temporary', `swap${at}`);
    draft = result.draft; rotation = result.rotation!;
    entries.push({ at, playerIds: personalActivityPlayerIds({ draftTeams: draft, rotation }) });
    expect(rotation.roundInstanceId).toBe('same-game');
  }
  expect(entries.map(entry => entry.playerIds)).toEqual([['a', 'b'], ['b', 'c'], ['b', 'c'], ['a', 'c']]);
  expect(personalActivityWindows({ personalActivityTimeline: { version: 1, startedAt: 0, entries },
    liveMatch: { activeIntervals: [{ s: 0, e: 100 }] } }, 'a', 100).windows).toEqual([{ from: 0, to: 20 }, { from: 80, to: 100 }]);
});

test('randomized membership and running segments match a discrete reference without counting bench or paused time', () => {
  for (let seed = 0; seed < 30; seed++) {
    const entries: Array<[number, string[]]> = Array.from({ length: 10 }, (_, i) => [i * 10, (i * 7 + seed) % 3 ? ['a'] : []]);
    const state = game(timeline(entries));
    const clock = Array.from({ length: 10 }, (_, i) => ({ s: i * 9, e: i * 9 + (seed * 3 + i) % 15 }));
    state.liveMatch = { activeIntervals: clock };
    let expected = 0;
    for (let t = 0; t < 100; t++) {
      const member = entries.filter(([at]) => at <= t).at(-1)![1].includes('a');
      if (member && clock.some(iv => iv.s <= t && iv.e > t)) expected++;
    }
    expect(personalActivityWindows(state, 'a', 100).eligibleMs).toBe(expected);
  }
});
