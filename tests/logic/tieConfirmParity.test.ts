/**
 * The tie confirmation must name the teams the rotation engine will ACTUALLY
 * bring on.
 *
 * The dialog is a promise about what happens next, and it is built in the
 * screen while the decision is made in `recordTieSkeleton`. Two copies of one
 * rule: if the engine's fallback changes and the dialog's doesn't, the admin is
 * told the wrong team is coming on — a confident, specific lie, which is worse
 * than the silence this replaced.
 *
 * These assert the branch the screen encodes matches the engine, for the two
 * cases that differ: bothOut with two waiting (what the confirmation on the tie
 * chooser promises), and bothOut with only one, which the engine downgrades to
 * sending the veteran off — the reason the option is hidden below four teams.
 */
import { recordTieSkeleton } from '@/services/rotationEngine';
import type { RotationTeam } from '@/services/rotationEngine';
import type { MatchRotation } from '@/types';

const teams = (n: number): RotationTeam[] =>
  Array.from({ length: n }, (_, i) => ({ index: i, playerIds: [`p${i}a`, `p${i}b`] }));

const rot = (playing: [number, number], waiting: number[]): MatchRotation =>
  ({ playing, waiting, wins: {}, round: 1, loans: [] }) as unknown as MatchRotation;

describe('tie confirmation names the right incoming teams', () => {
  it('bothOut with two waiting → the two waiting teams come on', () => {
    const s = recordTieSkeleton(teams(4), rot([0, 1], [2, 3]), 2, 'temporary', 'bothOut');
    // What the dialog promises in this branch: waiting[0] and waiting[1].
    expect(s.playing).toEqual([2, 3]);
  });

  it('bothOut with ONE waiting → falls back to veteran-out, so only one team comes on', () => {
    const s = recordTieSkeleton(teams(3), rot([0, 1], [2]), 2, 'temporary', 'bothOut');
    // This is WHY the chooser hides "both teams out" unless two teams are
    // waiting: asking for it here would silently get something else, and the
    // confirmation would have named a team that never came on.
    expect(s.playing).toEqual([1, 2]);
  });

  it('veteranOut → the challenger stays and waiting[0] comes on', () => {
    const s = recordTieSkeleton(teams(4), rot([0, 1], [2, 3]), 2, 'temporary', 'veteranOut');
    expect(s.playing).toEqual([1, 2]);
  });

  it('nobody waiting → both teams stay, so there is nothing to promise', () => {
    const s = recordTieSkeleton(teams(2), rot([0, 1], []), 2, 'temporary', 'bothOut');
    expect(s.playing).toEqual([0, 1]);
  });
});
