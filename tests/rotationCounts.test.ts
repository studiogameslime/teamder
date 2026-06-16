import {
  startRotation,
  recordWinner,
  rosterOf,
  canStart,
  type RotationTeam,
} from '@/services/rotationEngine';

const pickFirst = <T>(arr: T[], n: number): T[] => arr.slice(0, n);

// Build N registered players split into the given team sizes.
function build(sizes: number[]): RotationTeam[] {
  let n = 0;
  return sizes.map((size, idx) => ({
    index: idx,
    playerIds: Array.from({ length: size }, () => `p${++n}`),
  }));
}

const PER = 5;
const CASES: { n: number; sizes: number[] }[] = [
  { n: 10, sizes: [5, 5] },
  { n: 11, sizes: [5, 3, 3] },
  { n: 12, sizes: [4, 4, 4] },
  { n: 14, sizes: [5, 5, 4] },
  { n: 15, sizes: [5, 5, 5] },
];

describe('rotationEngine — registered-player counts 10/11/12/14/15', () => {
  for (const { n, sizes } of CASES) {
    it(`${n} players (${sizes.join('-')}): two full teams + correct waiting`, () => {
      const teams = build(sizes);
      expect(canStart(teams, PER)).toBe(true);
      const start = startRotation(teams, PER, 'temporary', pickFirst)!;
      const r = start.rotation;
      // Both playing teams full.
      expect(rosterOf(r.playing[0], teams, r.loans).length).toBe(PER);
      expect(rosterOf(r.playing[1], teams, r.loans).length).toBe(PER);
      // Waiting = the rest.
      expect(r.waiting.length).toBe(sizes.length - 2);
      // eslint-disable-next-line no-console
      console.log(
        `[${n}] start: ${r.playing.map((i) => `t${i}=${rosterOf(i, teams, r.loans).length}`).join(' vs ')} | waiting=[${r.waiting}] | loans=${r.loans.length}`,
      );
    });

    it(`${n} players: a win keeps the field full + stamps winners/losers`, () => {
      const teams = build(sizes);
      const start = startRotation(teams, PER, 'temporary', pickFirst)!;
      const next = recordWinner(start.rotation.playing[0], teams, start.rotation, PER, 'temporary', pickFirst);
      const r = next.rotation;
      expect(rosterOf(r.playing[0], teams, r.loans).length).toBe(PER);
      expect(rosterOf(r.playing[1], teams, r.loans).length).toBe(PER);
      // Winners = a full team of registered players (5), losers too.
      expect(r.lastRoundWinners?.length).toBe(PER);
      expect(r.lastRoundLosers?.length).toBe(PER);
      // No guest ids leaked into the credited lists.
      expect(r.lastRoundWinners?.every((u) => !u.startsWith('guest:'))).toBe(true);
      // eslint-disable-next-line no-console
      console.log(
        `[${n}] after win: ${r.playing.map((i) => `t${i}=${rosterOf(i, teams, r.loans).length}`).join(' vs ')} | W=${r.lastRoundWinners?.length} L=${r.lastRoundLosers?.length}`,
      );
    });
  }
});
