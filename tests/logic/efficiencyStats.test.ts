// The efficiency table, and the denominator that makes or breaks it.
//
// Every rate here divides by "the mini-games this metric was actually recorded
// in", not by every mini-game played. The difference is not academic: measured
// in production, clean sheets are recorded for 78% of the big club's
// player-rounds, and using the wrong denominator costs the top players a tenth
// of the scale.

import {
  toEfficiencyRow,
  formatPct,
  formatPerGame,
  sortEfficiency,
  type EfficiencyRow,
} from '@/utils/efficiencyStats';
import type { ChampionshipRow } from '@/utils/championship';

const row = (over: Partial<ChampionshipRow> = {}): ChampionshipRow => ({
  uid: 'u', goals: 0, assists: 0, rounds: 0, wins: 0, ties: 0, losses: 0,
  games: 0, penTaken: 0, penScored: 0, penFaced: 0, penSaved: 0,
  ownGoals: 0, cleanSheets: 0, ...over,
});

describe('the coverage denominator', () => {
  it('uses csRounds for clean sheets, not rounds', () => {
    // The real shape: 81 mini-games played, clean sheets recorded in 63.
    const e = toEfficiencyRow(row({ rounds: 81, csRounds: 63, cleanSheets: 34 }));
    expect(Math.round(e.cleanSheetPct!)).toBe(54);   // 34/63
    expect(Math.round((34 / 81) * 100)).toBe(42);    // what rounds would say
  });

  it('reproduces the six real players the fix was measured on', () => {
    const real = [
      { rounds: 81, csRounds: 63, cleanSheets: 34, was: 42, now: 54 },
      { rounds: 79, csRounds: 64, cleanSheets: 37, was: 47, now: 58 },
      { rounds: 72, csRounds: 63, cleanSheets: 32, was: 44, now: 51 },
      { rounds: 70, csRounds: 55, cleanSheets: 25, was: 36, now: 45 },
      { rounds: 70, csRounds: 55, cleanSheets: 30, was: 43, now: 55 },
      { rounds: 63, csRounds: 48, cleanSheets: 25, was: 40, now: 52 },
    ];
    for (const r of real) {
      const e = toEfficiencyRow(row(r));
      expect(Math.round(e.cleanSheetPct!)).toBe(r.now);
      expect(Math.round((r.cleanSheets / r.rounds) * 100)).toBe(r.was);
    }
  });

  it('falls back to rounds when the counter is absent, never when it is zero', () => {
    // Absent = an old row the backfill has not reached. Fall back.
    const old = toEfficiencyRow(row({ rounds: 10, cleanSheets: 4 }));
    expect(Math.round(old.cleanSheetPct!)).toBe(40);

    // Zero = the metric was never measured for this player. Unknowable.
    const never = toEfficiencyRow(row({ rounds: 10, csRounds: 0, cleanSheets: 0 }));
    expect(never.cleanSheetPct).toBeNull();
  });

  it('flags a row whose window is shorter than its history', () => {
    expect(toEfficiencyRow(row({ rounds: 81, csRounds: 63 })).partial).toBe(true);
    expect(toEfficiencyRow(row({ rounds: 81, csRounds: 81, asRounds: 81 })).partial)
      .toBe(false);
  });
});

describe('goals and assists divide by different windows', () => {
  it('goals use every mini-game — they were always recorded', () => {
    const e = toEfficiencyRow(row({ rounds: 50, goals: 12, asRounds: 40 }));
    expect(e.goalsPerGame).toBeCloseTo(0.24, 5);
  });

  it('assists use the window assists were recorded in', () => {
    const e = toEfficiencyRow(row({ rounds: 50, assists: 8, asRounds: 40 }));
    expect(e.assistsPerGame).toBeCloseTo(0.2, 5);
  });

  it('goals+assists use the window where BOTH were recorded', () => {
    // Not `rounds`: that would credit the combined rate with goal-only
    // mini-games and overstate exactly the longest-standing players.
    const e = toEfficiencyRow(row({ rounds: 50, goals: 12, assists: 8, asRounds: 40 }));
    expect(e.gaPerGame).toBeCloseTo(0.5, 5);
  });
});

describe('a player who has not played', () => {
  it('has no rates at all, rather than zeroes', () => {
    const e = toEfficiencyRow(row({ rounds: 0 }));
    expect(e.winPct).toBeNull();
    expect(e.goalsPerGame).toBeNull();
    expect(e.assistsPerGame).toBeNull();
    expect(e.gaPerGame).toBeNull();
    expect(e.cleanSheetPct).toBeNull();
    expect(e.attendancePct).toBeNull();
    expect(e.rounds).toBe(0);
  });

  it('and is not marked partial — there is no window to be short of', () => {
    expect(toEfficiencyRow(row({ rounds: 0 })).partial).toBe(false);
  });
});

describe('win percentage', () => {
  it('22 of 40 is 55%', () => {
    expect(Math.round(toEfficiencyRow(row({ rounds: 40, wins: 22 })).winPct!)).toBe(55);
  });

  it('winning everything is 100, winning nothing is 0 — not null', () => {
    expect(toEfficiencyRow(row({ rounds: 5, wins: 5 })).winPct).toBe(100);
    expect(toEfficiencyRow(row({ rounds: 5, wins: 0 })).winPct).toBe(0);
  });
});

// The one rate here counted in EVENINGS (מחזורים), not mini-games — and the
// only one whose denominator comes from outside the row, which is exactly what
// makes it easy to get wrong.
describe('attendance rate', () => {
  it('9 evenings of the club\'s 12 is 75%', () => {
    expect(toEfficiencyRow(row({ games: 9 }), 12).attendancePct).toBe(75);
  });

  it('counts evenings, never mini-games', () => {
    // A club night is ~6 mini-games. Dividing the 54 mini-games this player
    // played by the club's 12 EVENINGS is the מחזור/משחקון mix-up, and it
    // would print 450%.
    const e = toEfficiencyRow(row({ games: 9, rounds: 54 }), 12);
    expect(e.attendancePct).toBe(75);
  });

  it('turning up to everything is 100%', () => {
    expect(toEfficiencyRow(row({ games: 12 }), 12).attendancePct).toBe(100);
  });

  it('is null with no club evening count — there is nothing to divide by', () => {
    expect(toEfficiencyRow(row({ games: 9 })).attendancePct).toBeNull();
    expect(toEfficiencyRow(row({ games: 9 }), 0).attendancePct).toBeNull();
  });

  it('is null, not 0%, for a member who has attended nothing', () => {
    // The club table lists every member from the day they join, and on the
    // morning a season starts that is the whole roster. A 0% there cannot tell
    // "was here all season and never came" from "joined last week", so it
    // claims something the data does not know.
    expect(toEfficiencyRow(row({ games: 0 }), 12).attendancePct).toBeNull();
  });

  it('never exceeds 100%, however the two counts drift', () => {
    // The numerator is a per-player scan and the denominator a club-wide one;
    // when they disagree, "117%" reads as a broken table.
    expect(toEfficiencyRow(row({ games: 14 }), 12).attendancePct).toBe(100);
  });

  it('sorts like every other column — best first, unknowable last', () => {
    const rows = [
      toEfficiencyRow(row({ uid: 'never', games: 0, rounds: 30 }), 20),
      toEfficiencyRow(row({ uid: 'half', games: 10, rounds: 60 }), 20),
      toEfficiencyRow(row({ uid: 'always', games: 20, rounds: 120 }), 20),
    ];
    expect(sortEfficiency(rows, 'attendancePct').map((r) => r.uid)).toEqual([
      'always', 'half', 'never',
    ]);
  });
});

describe('display', () => {
  it('percentages are whole numbers', () => {
    expect(formatPct(54.8)).toBe('55%');
    expect(formatPct(0)).toBe('0%');
  });

  it('averages keep two decimals', () => {
    expect(formatPerGame(0.2)).toBe('0.20');
    expect(formatPerGame(0.2449)).toBe('0.24');
    expect(formatPerGame(0)).toBe('0.00');
  });

  it('an unknown value is a dash, never a zero', () => {
    // A zero claims the player kept no clean sheets. A dash says we do not
    // know, which is the true statement.
    expect(formatPct(null)).toBe('—');
    expect(formatPerGame(null)).toBe('—');
  });
});

describe('sorting', () => {
  const mk = (uid: string, gaPerGame: number | null, rounds: number): EfficiencyRow => ({
    uid, winPct: 0, goalsPerGame: 0, assistsPerGame: 0, gaPerGame,
    cleanSheetPct: 0, attendancePct: null, rounds, partial: false,
  });

  it('ranks by the column, highest first', () => {
    const out = sortEfficiency([mk('a', 0.2, 10), mk('b', 0.9, 10), mk('c', 0.5, 10)], 'gaPerGame');
    expect(out.map((r) => r.uid)).toEqual(['b', 'c', 'a']);
  });

  it('breaks a tie on the bigger sample', () => {
    // Otherwise one appearance and one goal outranks a regular on the same
    // rate, which is the complaint this table exists to answer.
    const out = sortEfficiency([mk('few', 0.5, 2), mk('many', 0.5, 40)], 'gaPerGame');
    expect(out.map((r) => r.uid)).toEqual(['many', 'few']);
  });

  it('puts unknowable rows last, without calling them zero', () => {
    const out = sortEfficiency([mk('none', null, 3), mk('low', 0.1, 3)], 'gaPerGame');
    expect(out.map((r) => r.uid)).toEqual(['low', 'none']);
  });

  it('orders two unknowable rows by sample, not arbitrarily', () => {
    const out = sortEfficiency([mk('small', null, 1), mk('big', null, 9)], 'gaPerGame');
    expect(out.map((r) => r.uid)).toEqual(['big', 'small']);
  });

  it('does not mutate the input', () => {
    const input = [mk('a', 0.1, 1), mk('b', 0.9, 1)];
    sortEfficiency(input, 'gaPerGame');
    expect(input.map((r) => r.uid)).toEqual(['a', 'b']);
  });
});

// ── Entry bar for the efficiency ranking ────────────────────────────────────
//
// Owner's request: "שים אנשים רק עם 10 אחוז משחקים לפחות מתוך המועדון כדי לא
// להציג אנשים שבאו פעם אחת." The cumulative table stays a record of everyone;
// this one is a ranking, and a rate over three mini-games is a coincidence
// rather than a measurement.
import { minRoundsForRanking, eligibleForRanking } from '@/utils/efficiencyStats';

describe('efficiency entry bar', () => {
  it('asks for a tenth of the club, rounded up', () => {
    expect(minRoundsForRanking(120)).toBe(12);
    // Rounded UP, so a small club never ends up with a bar of zero that lets
    // everyone through by accident.
    expect(minRoundsForRanking(11)).toBe(2);
    expect(minRoundsForRanking(1)).toBe(1);
  });

  it('rates everyone when the club has no mini-games recorded', () => {
    expect(minRoundsForRanking(0)).toBe(0);
    expect(minRoundsForRanking(undefined)).toBe(0);
    const players = [{ uid: 'a', rounds: 1 }];
    expect(eligibleForRanking(players, 0)).toEqual(players);
    expect(eligibleForRanking(players, undefined)).toEqual(players);
  });

  it('drops the one-off visitor and keeps the regular', () => {
    // 20 evenings at ~6 mini-games. The visitor came once, the regular came
    // three times — the exact pair the bar exists to tell apart.
    const players = [
      { uid: 'visitor', rounds: 6 },
      { uid: 'regular', rounds: 18 },
      { uid: 'veteran', rounds: 110 },
    ];
    const out = eligibleForRanking(players, 120).map((p) => p.uid);
    expect(out).toEqual(['regular', 'veteran']);
  });

  it('keeps a player sitting exactly on the bar', () => {
    expect(eligibleForRanking([{ uid: 'a', rounds: 12 }], 120)).toHaveLength(1);
    expect(eligibleForRanking([{ uid: 'a', rounds: 11 }], 120)).toHaveLength(1);
    // …and 11 survived only because nothing else did — see the never-empty
    // rule below. With a qualifying player present it goes.
    const out = eligibleForRanking(
      [{ uid: 'a', rounds: 11 }, { uid: 'b', rounds: 12 }],
      120,
    ).map((p) => p.uid);
    expect(out).toEqual(['b']);
  });

  it('never empties the table', () => {
    // A young club: two evenings played, everyone has a small sample. The bar
    // must not blank the tab — that reads as broken rather than as strict.
    const players = [{ uid: 'a', rounds: 0 }, { uid: 'b', rounds: 0 }];
    expect(eligibleForRanking(players, 12)).toEqual(players);
  });

  it('treats a missing rounds count as no sample', () => {
    const out = eligibleForRanking(
      [{ uid: 'a' }, { uid: 'b', rounds: 40 }],
      120,
    ).map((p) => p.uid);
    expect(out).toEqual(['b']);
  });
});
