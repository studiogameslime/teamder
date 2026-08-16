// Regression guards for the team-split persistence path.
//
// `readDraftTeams` and `readTeamBalanceMeta` rebuild their objects field by
// field, keeping ONLY what they explicitly deserialize. That is not a
// theoretical risk here — it already happened twice:
//
//   • `originalTeams` (the split as first drawn) was written on save but never
//     read back, so every live mutation round-tripped `{...draft}` through the
//     converter and erased it. In production not one finished game still had
//     it, which left `teams` — the END state, missing anyone who went home — as
//     the only record of who started on which team.
//   • the same class of bug silently disabled draft mode in 1.0.85.
//
// The variety model reads past splits to decide who has been playing together,
// and the diagnostics exist to calibrate its parameters from real weeks, so
// both are worth a guard.
//
// `@/firebase/config` is mocked because the real module pulls in AsyncStorage
// (native) at import time; the functions under test are pure.

jest.mock('@/firebase/config', () => ({ getFirebase: jest.fn() }));

import { readDraftTeams, readTeamBalanceMeta } from '@/firebase/firestore';

describe('readDraftTeams — the frozen original split survives', () => {
  const raw = {
    method: 'snake',
    numTeams: 2,
    createdAt: 111,
    createdBy: 'admin',
    // What the split became by the end of the night: someone went home.
    teams: [
      { index: 0, captainId: 'a', playerIds: ['a', 'b'] },
      { index: 1, captainId: 'c', playerIds: ['c'] },
    ],
    // What it was when it was drawn.
    originalTeams: [
      { index: 0, captainId: 'a', playerIds: ['a', 'b'] },
      { index: 1, captainId: 'c', playerIds: ['c', 'd'] },
    ],
  };

  it('keeps originalTeams, with its members', () => {
    const out = readDraftTeams(raw);
    expect(out?.originalTeams).toHaveLength(2);
    expect(out?.originalTeams?.[1].playerIds).toEqual(['c', 'd']);
  });

  it('keeps the live teams separately — they are not the same record', () => {
    const out = readDraftTeams(raw);
    expect(out?.teams[1].playerIds).toEqual(['c']);
  });

  it('survives the mutation round-trip that used to erase it', () => {
    // Exactly what markPlayerWentHome / swapPlayers do: read, spread, write.
    const read = readDraftTeams(raw)!;
    const mutated = {
      ...read,
      teams: read.teams.map((t) => ({ ...t, playerIds: [] })),
    };
    const reread = readDraftTeams(JSON.parse(JSON.stringify(mutated)));
    expect(reread?.originalTeams?.[1].playerIds).toEqual(['c', 'd']);
  });

  it('a legacy split with no snapshot still reads', () => {
    const { originalTeams, ...legacy } = raw;
    const out = readDraftTeams(legacy);
    expect(out?.teams).toHaveLength(2);
    expect(out?.originalTeams).toBeUndefined();
  });
});

describe('readTeamBalanceMeta — the calibration fields survive', () => {
  it('keeps gap, band, repeat, fallback and historyGames', () => {
    const out = readTeamBalanceMeta({
      generatedAt: 5,
      algorithm: 'rating_balanced_v2',
      unratedCount: 1,
      teamRatings: [3.4, 3.4, 3.4],
      gap: 0.043,
      band: 'A',
      repeat: 5.2,
      fallback: false,
      historyGames: 6,
    });
    expect(out).toMatchObject({
      gap: 0.043,
      band: 'A',
      repeat: 5.2,
      fallback: false,
      historyGames: 6,
    });
  });

  it('reads a v1 meta from before the fields existed', () => {
    const out = readTeamBalanceMeta({
      generatedAt: 5,
      algorithm: 'rating_greedy_v1',
      unratedCount: 0,
      teamRatings: [17.4, 17.6],
    });
    expect(out?.algorithm).toBe('rating_greedy_v1');
    expect(out?.gap).toBeUndefined();
    expect(out?.band).toBeUndefined();
  });

  it('rejects a bogus band instead of storing it', () => {
    const out = readTeamBalanceMeta({
      generatedAt: 5,
      algorithm: 'rating_balanced_v2',
      unratedCount: 0,
      teamRatings: [],
      band: 'Z',
    });
    expect(out?.band).toBeUndefined();
  });

  it('drops the whole meta when the algorithm tag is unknown', () => {
    expect(
      readTeamBalanceMeta({ generatedAt: 5, algorithm: 'something_else' }),
    ).toBeUndefined();
  });
});
