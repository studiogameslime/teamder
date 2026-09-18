import {
  heroSeasonId,
  heroWinner,
  seasonCardVariant,
} from '@/utils/seasonCardVariant';
import type { FinishedSeason } from '@/services/seasonHistoryService';

const DAY = 24 * 60 * 60 * 1000;

function season(p: Partial<FinishedSeason> = {}): FinishedSeason {
  return {
    seasonId: 's1',
    no: 1,
    startsAt: 1_750_000_000_000,
    endsAt: 1_750_000_000_000 + 30 * DAY,
    completedRounds: 19,
    totals: { rounds: 37, goals: 27, assists: 12 },
    players: 7,
    endedEarly: false,
    partialData: false,
    winners: [{ key: 'topScorer', names: ['הלן'], value: 10 }],
    ...p,
  };
}

describe('seasonCardVariant', () => {
  it('a real season with titles is full', () => {
    expect(seasonCardVariant(season())).toBe('full');
  });

  it('people played but nobody cleared the gate → a card, not a ribbon', () => {
    expect(seasonCardVariant(season({ winners: [], players: 5 }))).toBe(
      'noTitles',
    );
  });

  it('the seeding-bug season is void', () => {
    const start = 1_789_679_141_952;
    expect(
      seasonCardVariant(
        season({
          no: 2,
          players: 0,
          winners: [],
          totals: { rounds: 0, goals: 0, assists: 0 },
          startsAt: start,
          endsAt: start + 7 * 60 * 1000,
        }),
      ),
    ).toBe('void');
  });

  it('a timer-only club records 0 mini-games and is NOT void', () => {
    // The common case. Keying the void state on totals.rounds would erase
    // every season of every club that never turned advanced mode on.
    expect(
      seasonCardVariant(
        season({ totals: { rounds: 0, goals: 31, assists: 0 }, players: 9 }),
      ),
    ).toBe('full');
  });

  it('a long season reporting nothing is a data problem, not an empty one', () => {
    const start = 1_750_000_000_000;
    expect(
      seasonCardVariant(
        season({
          players: 0,
          winners: [],
          totals: { rounds: 0, goals: 0, assists: 0 },
          startsAt: start,
          endsAt: start + 60 * DAY,
        }),
      ),
    ).toBe('noTitles');
  });
});

describe('heroWinner', () => {
  const scorer = { key: 'topScorer' as const, names: ['הלן'], value: 10 };

  it('prefers שחקן העונה', () => {
    const mvp = { key: 'mvp' as const, names: ['מתן'], value: 8.1 };
    expect(heroWinner(season({ winners: [scorer, mvp] }))?.key).toBe('mvp');
  });

  it('a שחקן העונה shared by five is not a headline', () => {
    // Exactly שכחת שושי's season 1. Five names at 35pt is a footnote, so the
    // crown passes rather than the poster printing a list.
    const mvp = {
      key: 'mvp' as const,
      names: ['מתן', 'Lioz', 'Linoy', 'Nofar', 'Eliran'],
      value: 6,
    };
    expect(heroWinner(season({ winners: [mvp, scorer] }))?.key).toBe(
      'topScorer',
    );
  });

  it('a pair still counts as a headline', () => {
    const mvp = { key: 'mvp' as const, names: ['מתן', 'הלן'], value: 8 };
    expect(heroWinner(season({ winners: [mvp, scorer] }))?.key).toBe('mvp');
  });

  it('falls back to whatever the season did award', () => {
    const duo = { key: 'deadlyDuo' as const, names: ['א + ב'], value: 6 };
    expect(heroWinner(season({ winners: [duo] }))?.key).toBe('deadlyDuo');
  });

  it('is null when nothing was awarded', () => {
    expect(heroWinner(season({ winners: [] }))).toBeNull();
  });
});

describe('heroSeasonId', () => {
  it('skips a void season so the screen does not open on nothing', () => {
    const start = 1_789_679_141_952;
    const voidS = season({
      seasonId: 's2',
      no: 2,
      players: 0,
      winners: [],
      totals: { rounds: 0, goals: 0, assists: 0 },
      startsAt: start,
      endsAt: start + 60_000,
    });
    expect(heroSeasonId([voidS, season({ seasonId: 's1' })])).toBe('s1');
  });

  it('a season that was played but won nothing can still lead', () => {
    expect(
      heroSeasonId([season({ seasonId: 's4', winners: [], players: 4 })]),
    ).toBe('s4');
  });

  it('is null when every season is void', () => {
    const start = 1_789_679_141_952;
    expect(
      heroSeasonId([
        season({
          players: 0,
          winners: [],
          totals: { rounds: 0, goals: 0, assists: 0 },
          startsAt: start,
          endsAt: start + 60_000,
        }),
      ]),
    ).toBeNull();
  });
});
