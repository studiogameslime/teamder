// The club's all-time table, across seasons.
//
// "למה אין טבלה של כל הזמנים?" — because closing a season zeroes every live
// counter after archiving it, so the live rows only ever answer "this season".
// All-time is live + every archive, and the awkward part is the coverage
// denominators, which mean "the metric was being measured" and must not be
// invented by addition.
import { mergeAllTime, type TableSlice } from '@/utils/allTimeTable';
import type { ChampionshipRow } from '@/utils/championship';

const row = (
  uid: string,
  o: Partial<ChampionshipRow> = {},
): ChampionshipRow => ({
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

const slice = (
  players: ChampionshipRow[],
  o: Partial<TableSlice> = {},
): TableSlice => ({
  totalGoals: 0,
  totalRounds: 0,
  tiedRounds: 0,
  shootoutRounds: 0,
  scorelessRounds: 0,
  guestGoals: 0,
  ownGoals: 0,
  players,
  ...o,
});

describe('adding seasons together', () => {
  it('sums a player across the live season and an archive', () => {
    const out = mergeAllTime([
      slice([
        row('a', { goals: 3, assists: 1, rounds: 10, wins: 6, games: 4 }),
      ]),
      slice([
        row('a', { goals: 9, assists: 4, rounds: 40, wins: 20, games: 12 }),
      ]),
    ]);
    const a = out.players.find((p) => p.uid === 'a')!;
    expect(a.goals).toBe(12);
    expect(a.assists).toBe(5);
    expect(a.rounds).toBe(50);
    expect(a.wins).toBe(26);
    expect(a.games).toBe(16);
  });

  it('keeps a player who only exists in an old archive', () => {
    const out = mergeAllTime([
      slice([row('still-here', { goals: 2 })]),
      slice([row('left-the-club', { goals: 30 })]),
    ]);
    expect(out.players.map((p) => p.uid).sort()).toEqual([
      'left-the-club',
      'still-here',
    ]);
    expect(out.players.find((p) => p.uid === 'left-the-club')!.goals).toBe(30);
  });

  it('sums the club totals too', () => {
    const out = mergeAllTime([
      slice([], {
        totalGoals: 100,
        totalRounds: 40,
        guestGoals: 3,
        ownGoals: 1,
      }),
      slice([], {
        totalGoals: 250,
        totalRounds: 110,
        guestGoals: 9,
        ownGoals: 4,
      }),
    ]);
    expect(out.totalGoals).toBe(350);
    expect(out.totalRounds).toBe(150);
    expect(out.guestGoals).toBe(12);
    expect(out.ownGoals).toBe(5);
  });

  it('prefers the CURRENT name over a frozen one', () => {
    // The live slice is passed first, so somebody who changed their name since
    // an old season keeps the name they use now.
    const out = mergeAllTime([
      slice([row('a')], { names: { a: 'דני כהן' } }),
      slice([row('a')], { names: { a: 'דני' } }),
    ]);
    expect(out.names!.a).toBe('דני כהן');
  });
});

describe('coverage denominators', () => {
  it('adds them when BOTH sides measured', () => {
    const out = mergeAllTime([
      slice([row('a', { cleanSheets: 2, csRounds: 10, asRounds: 10 })]),
      slice([row('a', { cleanSheets: 5, csRounds: 40, asRounds: 40 })]),
    ]);
    const a = out.players[0];
    expect(a.cleanSheets).toBe(7);
    expect(a.csRounds).toBe(50);
    expect(a.asRounds).toBe(50);
  });

  it('drops them entirely when one side never measured', () => {
    // Absent means "never measured", which is NOT zero. Adding a present one
    // to an absent one would invent coverage and deflate the rate — the reader
    // has a fallback for absent, and it must survive the merge.
    const out = mergeAllTime([
      slice([row('a', { cleanSheets: 2, csRounds: 10 })]),
      slice([row('a', { cleanSheets: 5 })]), // an old season, before coverage existed
    ]);
    const a = out.players[0];
    expect(a.cleanSheets).toBe(7);
    expect('csRounds' in a).toBe(false);
  });
});

describe('degenerate inputs', () => {
  it('one slice is returned as itself', () => {
    const only = slice([row('a', { goals: 4 })], { totalGoals: 4 });
    const out = mergeAllTime([only]);
    expect(out.players).toEqual(only.players);
    expect(out.totalGoals).toBe(4);
  });

  it('no slices is an empty table, not a crash', () => {
    const out = mergeAllTime([]);
    expect(out.players).toEqual([]);
    expect(out.totalGoals).toBe(0);
  });

  it('is associative — order of seasons cannot change the answer', () => {
    const a = slice([row('x', { goals: 1 })], { totalGoals: 1 });
    const b = slice([row('x', { goals: 2 })], { totalGoals: 2 });
    const c = slice([row('x', { goals: 4 })], { totalGoals: 4 });
    const one = mergeAllTime([a, b, c]).players[0].goals;
    const two = mergeAllTime([c, a, b]).players[0].goals;
    expect(one).toBe(7);
    expect(two).toBe(7);
  });
});
