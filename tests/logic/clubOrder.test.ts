/**
 * One club order, and a TOTAL one.
 *
 * Two screens place a player inside a club: the club's own stats table and
 * the two-player screen. They used to reach their answer differently —
 *
 *   • the table sorted by the tapped column and let equal values "keep the
 *     incoming order", which is only meaningful if the incoming order means
 *     something. For a LIVE slice it does (it arrives ranked). For an
 *     ALL-TIME slice it does not: `mergeAllTime` emits rows in map-insertion
 *     order.
 *   • the two-player screen applied the canonical comparator.
 *
 * So two players level on wins could appear #4 and #5 on one screen and #5
 * and #4 on the other, each telling the reader a different position for the
 * same person in the same club. These tests pin the shared comparator and the
 * property that actually prevents it: the order must be TOTAL — independent
 * of the order the rows arrived in.
 */
import {
  comparePoints,
  compareByThen,
  type ChampionshipRow,
} from '@/utils/championship';
import { sortEfficiency, type EfficiencyRow } from '@/utils/efficiencyStats';

const row = (uid: string, o: Partial<ChampionshipRow> = {}): ChampionshipRow => ({
  uid,
  goals: 0,
  assists: 0,
  rounds: 0,
  wins: 0,
  ties: 0,
  losses: 0,
  games: 0,
  penTaken: 0,
  penScored: 0,
  penFaced: 0,
  penSaved: 0,
  ownGoals: 0,
  cleanSheets: 0,
  ...o,
});

/** Every ordering of the same set, so "depends on input order" cannot hide. */
function permutations<T>(xs: T[]): T[][] {
  if (xs.length <= 1) return [xs];
  const out: T[][] = [];
  xs.forEach((x, i) => {
    const rest = [...xs.slice(0, i), ...xs.slice(i + 1)];
    for (const p of permutations(rest)) out.push([x, ...p]);
  });
  return out;
}

describe('the club order', () => {
  it('ranks by wins first', () => {
    const a = row('a', { wins: 3, goals: 0 });
    const b = row('b', { wins: 5, goals: 0 });
    expect([a, b].sort(comparePoints).map((r) => r.uid)).toEqual(['b', 'a']);
  });

  it('then goals, then assists', () => {
    const rows = [
      row('x', { wins: 4, goals: 2, assists: 9 }),
      row('y', { wins: 4, goals: 7, assists: 0 }),
      row('z', { wins: 4, goals: 2, assists: 1 }),
    ];
    expect([...rows].sort(comparePoints).map((r) => r.uid)).toEqual(['y', 'x', 'z']);
  });

  it('and finally uid — which is what makes the order TOTAL', () => {
    // Identical on every ranked field. Without the last key these two are
    // interchangeable and their order is whatever the caller handed over.
    const rows = [row('zed', { wins: 4 }), row('amy', { wins: 4 })];
    expect([...rows].sort(comparePoints).map((r) => r.uid)).toEqual(['amy', 'zed']);
    expect([...rows].reverse().sort(comparePoints).map((r) => r.uid)).toEqual([
      'amy',
      'zed',
    ]);
  });

  it('gives the SAME answer from every input order', () => {
    // The property that matters. A live slice arrives ranked and an all-time
    // slice arrives in map order; both must land on one answer.
    const rows = [
      row('d', { wins: 4, goals: 2 }),
      row('a', { wins: 4, goals: 2 }),
      row('c', { wins: 4, goals: 9 }),
      row('b', { wins: 7, goals: 0 }),
    ];
    const answers = new Set(
      permutations(rows).map((p) => [...p].sort(comparePoints).map((r) => r.uid).join(',')),
    );
    expect([...answers]).toEqual(['b,c,a,d']);
  });
});

describe('sorting by a tapped column', () => {
  it('keeps that column as the primary key', () => {
    const rows = [
      row('a', { goals: 1, wins: 9 }),
      row('b', { goals: 8, wins: 0 }),
    ];
    expect([...rows].sort(compareByThen('goals')).map((r) => r.uid)).toEqual(['b', 'a']);
  });

  it('breaks ties with the club order, not with the input order', () => {
    const rows = [
      row('a', { goals: 5, wins: 1 }),
      row('b', { goals: 5, wins: 6 }),
      row('c', { goals: 5, wins: 3 }),
    ];
    const expected = ['b', 'c', 'a']; // equal goals → by wins
    for (const p of permutations(rows)) {
      expect([...p].sort(compareByThen('goals')).map((r) => r.uid)).toEqual(expected);
    }
  });

  it('is total even when the column and every ranked field tie', () => {
    const rows = [row('zed', { goals: 3 }), row('amy', { goals: 3 })];
    for (const p of permutations(rows)) {
      expect([...p].sort(compareByThen('goals')).map((r) => r.uid)).toEqual(['amy', 'zed']);
    }
  });

  it('treats a missing column value as 0 rather than throwing', () => {
    const rows = [row('a', { wins: 1 }), row('b', { wins: 2 })];
    expect(() => [...rows].sort(compareByThen('csRounds'))).not.toThrow();
    // Both undefined → straight to the club order.
    expect([...rows].sort(compareByThen('csRounds')).map((r) => r.uid)).toEqual(['b', 'a']);
  });
});

describe('the efficiency table is total too', () => {
  const eff = (uid: string, gaPerGame: number | null, rounds: number): EfficiencyRow =>
    ({ uid, gaPerGame, rounds }) as EfficiencyRow;

  it('equal rate AND equal sample no longer depends on input order', () => {
    const rows = [eff('zed', 1.5, 20), eff('amy', 1.5, 20)];
    expect(sortEfficiency(rows, 'gaPerGame').map((r) => r.uid)).toEqual(['amy', 'zed']);
    expect(sortEfficiency([...rows].reverse(), 'gaPerGame').map((r) => r.uid)).toEqual([
      'amy',
      'zed',
    ]);
  });

  it('still ranks by the rate first, and by sample second', () => {
    const rows = [eff('a', 1.0, 99), eff('b', 2.0, 5), eff('c', 1.0, 50)];
    expect(sortEfficiency(rows, 'gaPerGame').map((r) => r.uid)).toEqual(['b', 'a', 'c']);
  });

  it('unrankable rows stay last, and order among themselves', () => {
    const rows = [eff('zed', null, 4), eff('amy', null, 4), eff('b', 0.5, 10)];
    expect(sortEfficiency(rows, 'gaPerGame').map((r) => r.uid)).toEqual([
      'b',
      'amy',
      'zed',
    ]);
  });
});
