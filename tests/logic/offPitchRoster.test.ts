jest.mock('react-native', () => ({ Appearance: {} }), { virtual: true });
import { buildOffPitchRoster, buildRoster, makeResolver } from '@/components/match/rotationView';
import { exchangeLivePlayers } from '@/utils/liveSubstitution';
import { recordWinnerSkeleton } from '@/services/rotationEngine';
import { readRotation } from '@/firebase/firestore';
import type { DraftTeamsResult, MatchRotation } from '@/types';
jest.mock('@/firebase/config', () => ({ getFirebase: jest.fn() }));

const draft = () => ({ teams: [
  { index: 0, captainId: 'a', playerIds: ['a', 'a2', 'a3', 'shlomi', 'lioz'] },
  { index: 1, captainId: 'b', playerIds: ['b', 'b2', 'b3', 'b4', 'b5'] },
  { index: 2, captainId: 'eliran', playerIds: ['eliran', 'dani', 'c3', 'c4', 'c5'] },
] } as DraftTeamsResult);
const rotation = (): MatchRotation => ({ playing: [0, 1], waiting: [2], loans: [], round: 1 });
const resolve = makeResolver({ lioz: { displayName: 'ליעוז' }, shlomi: { displayName: 'שלומי' }, eliran: { displayName: 'אלירן' }, dani: { displayName: 'דני' } });

test('two independent swaps keep five on field and retain both replaced identities through the real reader', () => {
  const one = exchangeLivePlayers(draft(), rotation(), 'lioz', 'eliran', 'temporary', 'one');
  const two = exchangeLivePlayers(one.draft, one.rotation, 'shlomi', 'dani', 'temporary', 'two');
  const r = readRotation(two.rotation)!;
  const active = buildRoster(0, two.draft.teams, r, resolve);
  expect(active).toHaveLength(5);
  expect(active.filter(p => p.isFiller).map(p => [p.id, p.fromTeam])).toEqual([['eliran', 2], ['dani', 2]]);
  expect(buildOffPitchRoster(0, two.draft.teams, r, resolve)).toEqual([
    expect.objectContaining({ id: 'lioz', name: 'ליעוז', replacementName: 'אלירן', isFiller: false }),
    expect.objectContaining({ id: 'shlomi', name: 'שלומי', replacementName: 'דני', isFiller: false }),
  ]);
  expect(buildOffPitchRoster(1, two.draft.teams, r, resolve)).toEqual([]);
  const next = recordWinnerSkeleton(0, two.draft.teams, r, 5, 'temporary');
  expect(buildOffPitchRoster(0, next.teams, next.rotation, resolve)).toEqual([]);
  expect(buildRoster(0, next.teams, next.rotation, resolve).map(p => p.id)).toContain('lioz');
});

test('a replacement swapped again is resolved from its current linked exchange', () => {
  const one = exchangeLivePlayers(draft(), rotation(), 'lioz', 'eliran', 'temporary', 'one');
  const two = exchangeLivePlayers(one.draft, one.rotation, 'eliran', 'dani', 'temporary', 'two');
  expect(buildOffPitchRoster(0, two.draft.teams, two.rotation!, resolve)[0].replacementName).toBe('דני');
});

test('a player on the other playing team is not described as off the pitch', () => {
  const swapped = exchangeLivePlayers(draft(), rotation(), 'lioz', 'b', 'temporary', 'one');
  expect(buildOffPitchRoster(0, swapped.draft.teams, swapped.rotation!, resolve)).toEqual([]);
});

test('ambiguous connected exchanges, ordinary legacy loans and departures do not invent a replacement', () => {
  const one = exchangeLivePlayers(draft(), rotation(), 'lioz', 'eliran', 'temporary', 'one');
  const two = exchangeLivePlayers(one.draft, one.rotation, 'shlomi', 'dani', 'temporary', 'two');
  const r = { ...two.rotation!, loans: two.rotation!.loans.map(l => ({ ...l, swapId: 'connected' })) };
  expect(buildOffPitchRoster(0, two.draft.teams, r, resolve).map(p => p.replacementName)).toEqual([undefined, undefined]);
  const legacy = { ...r, loans: r.loans.map(({ swapId, ...l }) => l) };
  expect(buildOffPitchRoster(0, two.draft.teams, legacy, resolve)[0].replacementName).toBeUndefined();
  expect(buildOffPitchRoster(0, two.draft.teams, r, resolve, new Set(['lioz'])).map(p => p.id)).toEqual(['shlomi']);
});

test('permanent exchanges do not leave a player attached to their old team', () => {
  const swapped = exchangeLivePlayers(draft(), rotation(), 'lioz', 'eliran', 'permanent', 'one');
  expect(buildOffPitchRoster(0, swapped.draft.teams, swapped.rotation!, resolve)).toEqual([]);
  expect(buildRoster(0, swapped.draft.teams, swapped.rotation!, resolve).every(p => !p.isFiller)).toBe(true);
});

test('guest identity is resolved and returning the original player removes the inactive row', () => {
  const d = draft(); d.teams[0].playerIds[4] = 'guest:lioz';
  const guests = makeResolver({ eliran: { displayName: 'אלירן' } }, [{ id: 'lioz', name: 'ליעוז אורח' }]);
  const one = exchangeLivePlayers(d, rotation(), 'guest:lioz', 'eliran', 'temporary', 'one');
  expect(buildOffPitchRoster(0, one.draft.teams, one.rotation!, guests)[0]).toMatchObject({ name: 'ליעוז אורח', replacementName: 'אלירן' });
  const back = exchangeLivePlayers(one.draft, one.rotation, 'guest:lioz', 'eliran', 'temporary', 'back');
  expect(buildOffPitchRoster(0, back.draft.teams, back.rotation!, guests)).toEqual([]);
});
