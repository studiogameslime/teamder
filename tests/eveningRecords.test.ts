import {
  bestEvening,
  eveningRecordsOf,
  type EveningStat,
} from '../src/utils/eveningRecords';

const ev = (o: Partial<EveningStat> & { gameId: string; at: number }): EveningStat => ({
  goals: 0,
  rounds: 0,
  shootouts: 0,
  hasRoundHistory: true,
  ...o,
});

describe('bestEvening', () => {
  it('finds the maximum and names the evening it happened in', () => {
    const r = bestEvening(
      [ev({ gameId: 'a', at: 1, goals: 12 }), ev({ gameId: 'b', at: 2, goals: 47 })],
      'goals',
    );
    expect(r).toEqual({ key: 'goals', value: 47, gameId: 'b', at: 2, holders: ['b'] });
  });

  it('breaks a tie on the OLDEST evening, and keeps every holder', () => {
    // The oldest is the only tie-break that does not move the card's target
    // when the record is equalled again later.
    const r = bestEvening(
      [
        ev({ gameId: 'new', at: 900, shootouts: 5 }),
        ev({ gameId: 'old', at: 100, shootouts: 5 }),
        ev({ gameId: 'mid', at: 500, shootouts: 5 }),
      ],
      'shootouts',
    )!;
    expect(r.value).toBe(5);
    expect(r.gameId).toBe('old');
    expect(r.holders).toEqual(['old', 'mid', 'new']);
  });

  it('is stable when two evenings share a timestamp', () => {
    const a = bestEvening(
      [ev({ gameId: 'zz', at: 5, rounds: 9 }), ev({ gameId: 'aa', at: 5, rounds: 9 })],
      'rounds',
    )!;
    const b = bestEvening(
      [ev({ gameId: 'aa', at: 5, rounds: 9 }), ev({ gameId: 'zz', at: 5, rounds: 9 })],
      'rounds',
    )!;
    expect(a.gameId).toBe(b.gameId);
  });

  it('excludes an evening replayed from before the summaries existed', () => {
    // It reports zeros for everything, which is not "nothing happened".
    expect(
      bestEvening([ev({ gameId: 'old', at: 1, goals: 0, hasRoundHistory: false })], 'goals'),
    ).toBeNull();
  });

  it('a zero is not a record', () => {
    expect(bestEvening([ev({ gameId: 'a', at: 1, shootouts: 0 })], 'shootouts')).toBeNull();
  });

  it('no evenings at all is null, not a crash', () => {
    expect(bestEvening([], 'goals')).toBeNull();
  });

  it('each metric picks its own evening', () => {
    const all = eveningRecordsOf([
      ev({ gameId: 'goalsNight', at: 1, goals: 47, rounds: 6, shootouts: 0 }),
      ev({ gameId: 'longNight', at: 2, goals: 10, rounds: 18, shootouts: 1 }),
      ev({ gameId: 'penNight', at: 3, goals: 8, rounds: 7, shootouts: 5 }),
    ]);
    expect(all.goals!.gameId).toBe('goalsNight');
    expect(all.rounds!.gameId).toBe('longNight');
    expect(all.shootouts!.gameId).toBe('penNight');
  });

  it('a season window is just a smaller set — the record is that season\'s', () => {
    const season = [ev({ gameId: 's1', at: 100, goals: 9 }), ev({ gameId: 's2', at: 200, goals: 14 })];
    expect(bestEvening(season, 'goals')!.value).toBe(14);
    expect(bestEvening(season, 'goals')!.gameId).toBe('s2');
  });
});
