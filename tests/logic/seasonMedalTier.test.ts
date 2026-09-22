import { medalTier, titleStreak, TIER_METAL, TIER_NAME } from '@/utils/seasonMedalTier';
import { SEASON_TITLE_KEYS, type SeasonTitleKey } from '@/utils/seasonAwards';

const TIERS = ['bronze', 'silver', 'gold', 'platinum'] as const;

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

  it('שחקן העונה reads on the scale the evening score actually has', () => {
    // 6 to 10, not 1 to 10: eveningScore ends on `Math.max(6, Math.min(10, x))`.
    // The steps were written as [6.5, 7.5, 8.5] against the assumed 1-10 range;
    // the first correction moved them to [7, 8, 9], which WIDENED bronze and
    // made the headline title harder to lift off the floor — the opposite of
    // the fix. These are quarters of the range the number can actually hold.
    expect(medalTier('mvp', 6.0, 19)).toBe('bronze');
    expect(medalTier('mvp', 6.93, 19)).toBe('silver');
    expect(medalTier('mvp', 8.0, 19)).toBe('gold');
    expect(medalTier('mvp', 9.0, 19)).toBe('platinum');
    // The floor of the scale is the value that means "nothing was recorded",
    // and it stays the weakest metal.
    expect(medalTier('mvp', 6, 22)).toBe('bronze');
  });
});

// ── Every title, not the four that happened to be interesting ──────────────
//
// Four of the nine keys were tested and five were not, and the one failure
// this file exists to catch is silent: a title wired to a scale that cannot
// move wears bronze for ever, in production, and reads as a real result. The
// SCALE record is total now — a tenth key is a compile error — but a key
// pointing at a dead scale still compiles.
//
// So every key is graded across its own range and has to reach all four
// metals, and the thresholds themselves are pinned rather than described.
describe('all nine titles are actually gradable', () => {
  /** Counts, rates and averages in one list; each title reads the part of it
   *  that means anything for its own unit. */
  const PROBES = [
    ...Array.from({ length: 101 }, (_, i) => i / 100),
    ...Array.from({ length: 61 }, (_, i) => i),
  ].sort((a, b) => a - b);

  it.each(SEASON_TITLE_KEYS)('%s reaches every metal', (key) => {
    const reached = new Set(PROBES.map((v) => medalTier(key, v, 20)));
    expect([...reached].sort()).toEqual([...TIERS].sort());
  });

  it.each(SEASON_TITLE_KEYS)('%s starts at bronze on nothing', (key) => {
    expect(medalTier(key, 0, 20)).toBe('bronze');
  });

  it('and the list is the nine the season awards', () => {
    // If a title is added to SEASON_TITLE_KEYS, the two tables above grade it
    // from the same list — there is no second list here to forget.
    expect(SEASON_TITLE_KEYS).toHaveLength(9);
  });
});

describe('the cut-offs, pinned', () => {
  /** The lowest value that earns `tier`, to the hundredth. */
  const firstAt = (
    key: SeasonTitleKey,
    tier: (typeof TIERS)[number],
    completedRounds: number,
  ): number | undefined =>
    Array.from({ length: 6001 }, (_, i) => i / 100).find(
      (v) => medalTier(key, v, completedRounds) === tier,
    );

  // Counts are on their own per-title scale, because 40 goals, 19 evenings and
  // a 6.5 average are three different things.
  it.each([
    ['topScorer', 8, 16, 28],
    ['topAssister', 6, 12, 22],
    ['topWinner', 10, 20, 34],
    ['cleanSheetKing', 5, 11, 20],
    ['deadlyDuo', 5, 11, 20],
  ] as const)('%s steps at %i / %i / %i', (key, silver, gold, platinum) => {
    expect(firstAt(key, 'silver', 20)).toBe(silver);
    expect(firstAt(key, 'gold', 20)).toBe(gold);
    expect(firstAt(key, 'platinum', 20)).toBe(platinum);
    // The value just under a cut-off wears the metal below it.
    expect(medalTier(key, silver - 0.01, 20)).toBe('bronze');
    expect(medalTier(key, gold - 0.01, 20)).toBe('silver');
    expect(medalTier(key, platinum - 0.01, 20)).toBe('gold');
  });

  it.each(['penaltyKing', 'penaltyKeeper'] as const)(
    '%s steps at 70%% / 85%% / 100%%',
    (key) => {
      expect(firstAt(key, 'silver', 20)).toBe(0.7);
      expect(firstAt(key, 'gold', 20)).toBe(0.85);
      expect(firstAt(key, 'platinum', 20)).toBe(1);
      // A perfect record is platinum and nothing short of it is.
      expect(medalTier(key, 0.99, 20)).toBe('gold');
    },
  );

  it('מלך ההתמדה steps at 60% / 80% / 100% OF THE SEASON', () => {
    // The one title whose scale IS the season, so the cut-offs move with it.
    expect(firstAt('mostLoyal', 'silver', 20)).toBe(12);
    expect(firstAt('mostLoyal', 'gold', 20)).toBe(16);
    expect(firstAt('mostLoyal', 'platinum', 20)).toBe(20);
    expect(firstAt('mostLoyal', 'platinum', 22)).toBe(22);
    // Perfect attendance on the real club's own season: 22 of 22.
    expect(medalTier('mostLoyal', 22, 22)).toBe('platinum');
    // And 22 of a season the archive recorded as 19 is still platinum rather
    // than an overflow into something else — it is capped by the top step.
    expect(medalTier('mostLoyal', 22, 19)).toBe('platinum');
  });

  it('מלך העונה steps in quarters of the 6-10 range it really has', () => {
    expect(firstAt('mvp', 'silver', 20)).toBe(6.6);
    expect(firstAt('mvp', 'gold', 20)).toBe(7.6);
    expect(firstAt('mvp', 'platinum', 20)).toBe(8.8);
  });

  it('a season with no length cannot award perfect attendance to anybody', () => {
    // No length, no share to grade — only the fact of the title. Guarding the
    // division is not optional: the alternative is Infinity, which steps
    // straight to platinum.
    for (const rounds of [0, -1]) {
      expect(medalTier('mostLoyal', 19, rounds)).toBe('bronze');
    }
  });

  it('and every metal it can return has a ring and a name', () => {
    // The tier is rendered as a colour and read out as a word; a metal with
    // only one of the two is a medal somebody cannot see or cannot hear.
    for (const tier of TIERS) {
      expect(TIER_METAL[tier]).toHaveLength(3);
      expect(TIER_NAME[tier]).toBeTruthy();
    }
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
