import * as phone from '../../src/utils/personalActivityWindows';
import * as server from '../../functions/src/personalActivityWindows';

test('phone and server select identical active players across rotation, loans, departures and terminal state', () => {
  for (let seed = 0; seed < 100; seed++) {
    const teams = [0, 1, 2].map(index => ({ index, playerIds: [`p${index}a`, `p${index}b`] }));
    const state: phone.PersonalActivityGame = {
      status: ['active', 'finished', 'cancelled'][seed % 7] ?? 'active',
      draftTeams: { teams, leftHome: seed % 3 ? [] : [{ playerId: 'p0a' }] },
      rotation: { playing: [seed % 3, (seed + 1) % 3], loans: [
        { playerId: `p${(seed + 2) % 3}a`, homeTeam: (seed + 2) % 3, filledTeam: seed % 3 },
      ] },
      liveMatch: { timerRunning: seed % 2 === 0, timerLastStartedAt: 5, assignments: { stale: 'teamA' } },
    };
    expect(server.personalActivityPlayerIds(state)).toEqual(phone.personalActivityPlayerIds(state));
    expect(server.personalActivityEligibility(state, 'p0a', 100)).toEqual(phone.personalActivityEligibility(state, 'p0a', 100));
    delete state.rotation;
    state.liveMatch!.assignments = { a: 'teamA', b: 'teamB', c: 'teamC', keeper: 'gkA', bench: 'bench' };
    expect(server.personalActivityPlayerIds(state)).toEqual(phone.personalActivityPlayerIds(state));
  }
});

test('phone and server intersect historical windows identically', () => {
  for (let seed = 0; seed < 30; seed++) {
    const state: phone.PersonalActivityGame = {
      personalActivityTimeline: { version: 1, startedAt: 0, entries: Array.from({ length: 10 }, (_, i) =>
        ({ at: i * 10, playerIds: (i + seed) % 3 ? ['a'] : [] })) },
      liveMatch: { activeIntervals: Array.from({ length: 10 }, (_, i) => ({ s: i * 9, e: i * 9 + (seed + i) % 15 })) },
    };
    expect(server.personalActivityWindows(state, 'a', 100)).toEqual(phone.personalActivityWindows(state, 'a', 100));
  }
});
