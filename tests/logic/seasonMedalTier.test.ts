import { medalTier, titleStreak } from '@/utils/seasonMedalTier';

describe('medalTier', () => {
  it('counting titles step through the metals', () => {
    expect(medalTier('topScorer', 3, 19)).toBe('bronze');
    expect(medalTier('topScorer', 10, 19)).toBe('silver');
    expect(medalTier('topScorer', 18, 19)).toBe('gold');
    expect(medalTier('topScorer', 41, 19)).toBe('platinum');
  });

  it('מלך ההתמדה is measured against the season, not against a constant', () => {
    // The whole point of the second axis: 19 of 19 is perfect and 19 of 40 is
    // not, and the same raw number must not produce the same medal.
    expect(medalTier('mostLoyal', 19, 19)).toBe('platinum');
    expect(medalTier('mostLoyal', 19, 40)).toBe('bronze');
    expect(medalTier('mostLoyal', 16, 19)).toBe('gold');
  });

  it('a season with no rounds cannot award perfect attendance', () => {
    expect(medalTier('mostLoyal', 5, 0)).toBe('bronze');
  });

  it('the two rate titles read as rates', () => {
    expect(medalTier('penaltyKing', 1, 19)).toBe('platinum');
    expect(medalTier('penaltyKeeper', 0.72, 19)).toBe('silver');
    expect(medalTier('penaltyKing', 0.4, 19)).toBe('bronze');
  });

  it('שחקן העונה reads on the 1-10 scale', () => {
    expect(medalTier('mvp', 6.0, 19)).toBe('bronze');
    expect(medalTier('mvp', 7.0, 19)).toBe('silver');
    expect(medalTier('mvp', 8.8, 19)).toBe('platinum');
  });
});

describe('titleStreak', () => {
  const S = (no: number, key: string, names: string[]) => ({
    no,
    winners: [{ key, names }],
  });

  it('counts the same holder back through consecutive seasons', () => {
    const list = [
      S(3, 'topScorer', ['הלן']),
      S(2, 'topScorer', ['הלן']),
      S(1, 'topScorer', ['הלן']),
    ];
    expect(titleStreak(list, 0, 'topScorer')).toBe(3);
  });

  it('stops at a different holder', () => {
    const list = [
      S(3, 'topScorer', ['הלן']),
      S(2, 'topScorer', ['מתן']),
      S(1, 'topScorer', ['הלן']),
    ];
    expect(titleStreak(list, 0, 'topScorer')).toBe(1);
  });

  it('a shared title continues only for the identical set, in any order', () => {
    const list = [
      S(2, 'mvp', ['מתן', 'הלן']),
      S(1, 'mvp', ['הלן', 'מתן']),
    ];
    expect(titleStreak(list, 0, 'mvp')).toBe(2);
    const changed = [S(2, 'mvp', ['מתן', 'הלן']), S(1, 'mvp', ['מתן'])];
    expect(titleStreak(changed, 0, 'mvp')).toBe(1);
  });

  it('does not run across a gap in the numbering', () => {
    // A gap means the club switched seasons off for a while. Whatever happened
    // in between, it is not "three in a row".
    const list = [
      S(5, 'topWinner', ['הלן']),
      S(2, 'topWinner', ['הלן']),
      S(1, 'topWinner', ['הלן']),
    ];
    expect(titleStreak(list, 0, 'topWinner')).toBe(1);
  });

  it('is 0 for a title this season did not award', () => {
    expect(titleStreak([S(1, 'mvp', ['הלן'])], 0, 'topScorer')).toBe(0);
  });
});
