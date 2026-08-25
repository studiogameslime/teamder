// The whole path for structures the old picker could not express.
//
// Opening the picker to 3–11 per team × 2–7 teams is only honest if what
// happens AFTER the choice holds up: the balancer has to fill every team, the
// rotation has to seat every team in the queue, and each team has to come out
// of it with its own identity. Two of these three used to be capped below what
// the picker offered, so the check is not theoretical.

// rotationView → '@/theme' imports react-native (only `Appearance`, unused).
// Stub it so the colour helpers can be imported under jest/node.
jest.mock('react-native', () => ({ Appearance: {} }), { virtual: true });

import { balanceCore } from '@/utils/teamBalanceCore';
import {
  startRotation,
  recordWinner,
  recordTie,
  rosterOf,
  canStart,
  type RotationTeam,
} from '@/services/rotationEngine';
import { TEAM_COUNT_MAX, TEAM_SIZE_MAX } from '@/types';
import { teamName } from '@/utils/draft';
import { teamColor, TEAM_PALETTE } from '@/components/match/rotationView';

const pickFirst = <T>(arr: T[], n: number): T[] => arr.slice(0, n);
const seq = (() => {
  let s = 7;
  return () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
})();

function roster(n: number): { ids: string[]; ratings: Record<string, number> } {
  const ids = Array.from({ length: n }, (_, i) => `p${i}`);
  const ratings: Record<string, number> = {};
  // A spread of ratings across the 1–10 internal scale, so a lopsided split
  // would actually show up as a gap rather than being masked by flat inputs.
  ids.forEach((id, i) => {
    ratings[id] = 1 + (i % 10);
  });
  return { ids, ratings };
}

function teamsFrom(split: string[][]): RotationTeam[] {
  return split.map((playerIds, index) => ({ index, playerIds }));
}

// Scenario A (5 × 6 = 30) and B (8 × 4 = 32) from the spec, plus the two ends
// of the range. Scenario C in the spec was 4 × 8 = 32, which the agreed ceiling
// of 7 teams does not allow; 4 × 7 = 28 stands in for it.
const SCENARIOS: Array<{ label: string; perTeam: number; numTeams: number }> = [
  { label: '5 × 5 · 3 teams (today\'s normal game)', perTeam: 5, numTeams: 3 },
  { label: '5 × 5 · 6 teams', perTeam: 5, numTeams: 6 },
  { label: '8 × 8 · 4 teams', perTeam: 8, numTeams: 4 },
  { label: '4 × 4 · 7 teams', perTeam: 4, numTeams: 7 },
  { label: '11 × 11 · 7 teams (the maximum)', perTeam: TEAM_SIZE_MAX, numTeams: TEAM_COUNT_MAX },
];

describe.each(SCENARIOS)('$label', ({ perTeam, numTeams }) => {
  const total = perTeam * numTeams;
  const { ids, ratings } = roster(total);

  const split = balanceCore({
    playerIds: ids,
    ratings,
    numTeams,
    perTeam,
    rng: seq,
  });

  it('balances into exactly the requested teams, nobody benched', () => {
    expect(split.teams).toHaveLength(numTeams);
    expect(split.teams.flat()).toHaveLength(total);
    expect(new Set(split.teams.flat()).size).toBe(total);
    for (const t of split.teams) expect(t).toHaveLength(perTeam);
  });

  it('starts a rotation with two on the pitch and the rest queued', () => {
    const teams = teamsFrom(split.teams);
    expect(canStart(teams, perTeam)).toBe(true);

    const started = startRotation(teams, perTeam, 'temporary', pickFirst);
    expect(started).not.toBeNull();
    const { rotation } = started!;

    expect(rotation.playing).toHaveLength(2);
    // Every team is accounted for exactly once: two playing, the rest waiting
    // in order. A queue that quietly dropped teams 5-7 is the failure this is
    // here to catch.
    const seated = [...rotation.playing, ...rotation.waiting];
    expect(seated).toHaveLength(numTeams);
    expect(new Set(seated).size).toBe(numTeams);
    expect([...seated].sort((a, b) => a - b)).toEqual(
      Array.from({ length: numTeams }, (_, i) => i),
    );
  });

  it('rotates through every team without losing one', () => {
    const teams = teamsFrom(split.teams);
    let state = startRotation(teams, perTeam, 'temporary', pickFirst)!;

    // Play a full lap and a bit, always letting the lower index win, so the
    // queue is exercised rather than one team parking on the pitch.
    for (let round = 0; round < numTeams * 2; round++) {
      const winner = Math.min(...state.rotation.playing);
      state = recordWinner(
        winner,
        state.teams,
        state.rotation,
        perTeam,
        'temporary',
        pickFirst,
      );
      const seated = [...state.rotation.playing, ...state.rotation.waiting];
      expect(new Set(seated).size).toBe(numTeams);
    }
  });

  it('a drawn round sends both out and pulls the next two in', () => {
    const teams = teamsFrom(split.teams);
    const started = startRotation(teams, perTeam, 'temporary', pickFirst)!;
    const before = started.rotation.waiting.slice(0, 2);

    const after = recordTie(
      started.teams,
      started.rotation,
      perTeam,
      'temporary',
      'bothOut',
      pickFirst,
    );

    // "Both out" needs TWO teams waiting. With 2 or 3 teams there are fewer
    // than that, so the engine falls back to sending the veteran off — the same
    // rule the live screen states in its confirmation before applying it.
    if (numTeams > 3) {
      expect(after.rotation.playing).toEqual(before);
    } else {
      expect(after.rotation.playing).toHaveLength(2);
    }
    const seated = [...after.rotation.playing, ...after.rotation.waiting];
    expect(new Set(seated).size).toBe(numTeams);
  });

  it('every team has a full roster on the pitch', () => {
    const teams = teamsFrom(split.teams);
    const started = startRotation(teams, perTeam, 'temporary', pickFirst)!;
    for (const idx of started.rotation.playing) {
      expect(
        rosterOf(idx, started.teams, started.rotation.loans),
      ).toHaveLength(perTeam);
    }
  });

  it('every team gets its own name and its own colour', () => {
    const names = Array.from({ length: numTeams }, (_, i) => teamName(i));
    const colours = Array.from({ length: numTeams }, (_, i) => teamColor(i));
    expect(new Set(names).size).toBe(numTeams);
    expect(new Set(colours).size).toBe(numTeams);
    expect(colours.every((c) => typeof c === 'string' && c.length > 0)).toBe(true);
  });
});

describe('the colour vocabulary covers the whole range', () => {
  it('has a distinct colour for each of the seven teams', () => {
    const colours = Array.from({ length: TEAM_COUNT_MAX }, (_, i) => teamColor(i));
    expect(new Set(colours).size).toBe(TEAM_COUNT_MAX);
    expect(colours).not.toContain(undefined);
  });

  it('the admin-facing palette is at least as wide', () => {
    expect(TEAM_PALETTE.length).toBeGreaterThanOrEqual(TEAM_COUNT_MAX);
  });
});
