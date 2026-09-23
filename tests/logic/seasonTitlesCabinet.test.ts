// The cabinet that moved.
//
// "עונות קודמות ותארים" and its screen were removed on 23.09 and the medal
// grid inside it became the champions section of the personal season summary,
// replacing nine plain text rows. This pins what the grid is made of, on
// שכחת שושי's real archived season, so the move cannot quietly lose a title,
// a tier or an empty socket.

import { SEASON_TITLE_KEYS } from '@/utils/seasonAwards';
import { medalTier, titleStreak, TIER_NAME } from '@/utils/seasonMedalTier';

// Season 1 as it stands in production after the migration, read 23.09.
const WINNERS = [
  { key: 'topScorer', names: ['הלן צברי'], value: 10 },
  { key: 'topAssister', names: ['Nofar Tzabari'], value: 5 },
  { key: 'mvp', names: ['הלן צברי'], value: 7.655555555555556,
    coverage: { rated: 9, of: 22 } },
  { key: 'topWinner', names: ['Lioz Madar'], value: 13 },
  { key: 'mostLoyal', names: ['מתן לוי'], value: 19 },
  { key: 'cleanSheetKing', names: ['הלן צברי'], value: 13 },
  { key: 'penaltyKing', names: ['Nofar Tzabari', 'הלן צברי'], value: 2 },
  { key: 'penaltyKeeper', names: ['הלן צברי'], value: 3 },
] as const;
const COMPLETED_ROUNDS = 22;

describe('the grid the summary now draws', () => {
  it('has nine fixed slots, in one canonical order', () => {
    // Nine EVERY season is the point: the same title in the same spot makes a
    // column of seasons scannable, and it is why an un-awarded title is an
    // empty socket rather than a closed gap.
    expect(SEASON_TITLE_KEYS).toHaveLength(9);
  });

  it('draws an empty socket for the title nobody won', () => {
    const awarded = new Set(WINNERS.map((w) => w.key));
    const empty = SEASON_TITLE_KEYS.filter((k) => !awarded.has(k as never));
    // deadlyDuo: this season's best pair exchanged two assists and the title
    // needs three.
    expect(empty).toEqual(['deadlyDuo']);
  });

  it('gives every awarded title a tier the season can justify', () => {
    for (const w of WINNERS) {
      const t = medalTier(w.key, w.value, COMPLETED_ROUNDS);
      expect(TIER_NAME[t]).toBeTruthy();
    }
  });

  it('מלך ההתמדה on 19 of 22 evenings is gold, not platinum', () => {
    // The denominator is the SEASON's length. It was briefly the loyalty
    // winner's own value — a number divided by itself — which crowned perfect
    // attendance every season and made silver and gold unreachable.
    expect(medalTier('mostLoyal', 19, 22)).toBe('gold');
  });

  it('carries the coverage note on the rating, and only there', () => {
    const withCoverage = WINNERS.filter((w) => 'coverage' in w);
    expect(withCoverage.map((w) => w.key)).toEqual(['mvp']);
  });

  it('titleStreak returns 0 for a season that is not there — hence the guard', () => {
    // NOT 1. `holders(index)` finds no season, returns null, and the function
    // answers 0 — which as a `streak` prop would render a "×0" badge.
    //
    // This is exactly why the component takes `history` as optional and skips
    // the call when it is absent, rather than passing an empty array and
    // trusting the result. The summary shows ONE season and has no history to
    // compare against; a badge there would be a number the reader cannot
    // check even if it said 1.
    expect(titleStreak([], -1, 'topScorer')).toBe(0);
    expect(titleStreak([], 0, 'topScorer')).toBe(0);
  });

  it('a shared title continues a streak only for the identical set', () => {
    const seasons = [
      { no: 2, winners: [{ key: 'penaltyKing', names: ['א', 'ב'] }] },
      { no: 1, winners: [{ key: 'penaltyKing', names: ['ב', 'א'] }] },
    ];
    // Same two people, written in the other order — still the same holders.
    expect(titleStreak(seasons, 0, 'penaltyKing')).toBe(2);
    const different = [
      { no: 2, winners: [{ key: 'penaltyKing', names: ['א', 'ב'] }] },
      { no: 1, winners: [{ key: 'penaltyKing', names: ['א'] }] },
    ];
    expect(titleStreak(different, 0, 'penaltyKing')).toBe(1);
  });
});
