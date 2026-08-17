import {
  cleanSheetCredits,
  cleanSheetSides,
  cleanSheetTotals,
  type CleanSheetRound,
} from '@/utils/cleanSheets';
import { rankChampionshipRows } from '@/utils/championship';

const A = ['a1', 'a2', 'a3'];
const B = ['b1', 'b2', 'b3'];
const round = (scoreA: number | null | undefined, scoreB: number | null | undefined,
  sideA = A, sideB = B): CleanSheetRound => ({ sideA, sideB, scoreA, scoreB });

describe('the clean-sheet rule', () => {
  it('1:0 — the side that conceded nothing gets it', () => {
    const c = cleanSheetCredits(round(1, 0));
    expect(c).toEqual({ a1: 1, a2: 1, a3: 1 });
    expect(cleanSheetSides(round(1, 0))).toEqual({ a: true, b: false });
  });

  it('3:0 — ONE clean sheet each, not one per goal', () => {
    const c = cleanSheetCredits(round(3, 0));
    expect(Object.values(c)).toEqual([1, 1, 1]);
    expect(c.b1).toBeUndefined();
  });

  it('3:1 — nobody gets one', () => {
    expect(cleanSheetCredits(round(3, 1))).toEqual({});
  });

  it('0:0 — both sides get one', () => {
    expect(cleanSheetCredits(round(0, 0))).toEqual({
      a1: 1, a2: 1, a3: 1, b1: 1, b2: 1, b3: 1,
    });
  });

  it('a round with no usable result credits nobody', () => {
    // The dangerous case: an unplayed / unfinished mini-game must never read
    // as "0:0" and hand everybody a clean sheet.
    expect(cleanSheetCredits(round(undefined, undefined))).toEqual({});
    expect(cleanSheetCredits(round(null, 0))).toEqual({});
    expect(cleanSheetCredits(round(0, null))).toEqual({});
    expect(cleanSheetCredits(round(-1, 0))).toEqual({});
  });

  it('an own goal denies the conceding side its clean sheet', () => {
    // The stored score credits a goal to the side that BENEFITED, so an own
    // goal by a B player shows as a point for A — and B is not clean.
    expect(cleanSheetSides(round(1, 0))).toEqual({ a: true, b: false });
  });

  it('never credits a player twice in one mini-game', () => {
    // Malformed payload: the same id on both sides of a 0:0.
    const c = cleanSheetCredits(round(0, 0, ['x', 'a2'], ['x', 'b2']));
    expect(c.x).toBe(1);
  });

  it('is pure — running it again on the same round changes nothing', () => {
    const r = round(2, 0);
    expect(cleanSheetCredits(r)).toEqual(cleanSheetCredits(r));
  });
});

describe('accumulating over an evening', () => {
  it('adds up across mini-games', () => {
    const totals = cleanSheetTotals([
      round(1, 0), // A clean
      round(0, 0), // both
      round(2, 3), // neither
      round(0, 4), // B clean
    ]);
    expect(totals.a1).toBe(2); // 1:0 and 0:0
    expect(totals.b1).toBe(2); // 0:0 and 0:4
  });

  it('follows the ACTUAL line-up of each mini-game, not the opening split', () => {
    // A player who went home after round 1, and a player who swapped sides.
    const totals = cleanSheetTotals([
      { sideA: ['gone', 'stay', 'swap'], sideB: ['b1'], scoreA: 1, scoreB: 0 },
      { sideA: ['stay'], sideB: ['b1', 'swap'], scoreA: 1, scoreB: 0 },
    ]);
    expect(totals.gone).toBe(1); // only the mini-game they were actually in
    expect(totals.stay).toBe(2);
    expect(totals.swap).toBe(1); // earned on side A, then conceded on side B
    expect(totals.b1).toBeUndefined();
  });

  it('can never exceed the number of mini-games played', () => {
    const rounds = [round(0, 0), round(1, 0), round(0, 2)];
    const totals = cleanSheetTotals(rounds);
    for (const n of Object.values(totals)) {
      expect(n).toBeLessThanOrEqual(rounds.length);
    }
  });

  it('an empty evening credits nothing', () => {
    expect(cleanSheetTotals([])).toEqual({});
  });
});

describe('the stat tables carry it', () => {
  it('rankChampionshipRows keeps cleanSheets off the raw stat docs', () => {
    const rows = rankChampionshipRows(
      [
        { userId: 'u1', goals: 2, assists: 1, rounds: 8, wins: 5, cleanSheets: 4 },
        { userId: 'u2', goals: 0, assists: 0, rounds: 8, wins: 3, cleanSheets: 6 },
      ],
      'points',
      true,
    );
    expect(rows.find((r) => r.uid === 'u1')?.cleanSheets).toBe(4);
    expect(rows.find((r) => r.uid === 'u2')?.cleanSheets).toBe(6);
  });

  it('defaults to 0 for a doc written before the field existed', () => {
    const rows = rankChampionshipRows(
      [{ userId: 'old', goals: 3, rounds: 5 }],
      'points',
      true,
    );
    expect(rows[0].cleanSheets).toBe(0);
  });
});
