// The season titles, and the arguments they are meant to prevent.
//
// Every case here is a scenario somebody would shout about in the WhatsApp
// group, written down as a rule. If one of these changes, the change is a
// product decision and not a refactor.

import {
  computeSeasonAwards,
  eligibilityThreshold,
  isEligible,
  minPenaltyAttempts,
  SEASON_TITLE_KEYS,
  type SeasonPlayerLine,
  type SeasonPairLine,
} from '@/utils/seasonAwards';

const player = (uid: string, over: Partial<SeasonPlayerLine> = {}): SeasonPlayerLine => ({
  uid,
  rounds: 10,
  goals: 0,
  assists: 0,
  wins: 0,
  cleanSheets: 0,
  mvpAvg: 0,
  penTaken: 0,
  penScored: 0,
  penFaced: 0,
  penSaved: 0,
  ...over,
});

const pair = (a: string, b: string, over: Partial<SeasonPairLine> = {}): SeasonPairLine => ({
  a, b, score: 0, together: 0, ...over,
});

describe('the eligibility gate', () => {
  it('is half the finished rounds, rounded up', () => {
    expect(eligibilityThreshold(13)).toBe(7);
    expect(eligibilityThreshold(24)).toBe(12);
    expect(eligibilityThreshold(1)).toBe(1);
    expect(eligibilityThreshold(0)).toBe(0);
  });

  it('matches the real club: 13 rounds, threshold 7', () => {
    // The actual attendance spread, measured in production. Bimodal — a core
    // on 9–12 and then a cliff to 5 — so half cuts through the gap.
    const attendance = [12, 12, 11, 11, 11, 10, 10, 10, 10, 9, 9, 9, 9,
                        5, 5, 4, 4, 3, 2, 2, 2, 2, 2, 2, 2, 1, 1, 1, 1];
    const qualified = attendance.filter((n) => n >= eligibilityThreshold(13));
    expect(qualified).toHaveLength(13);
  });

  it('applies the same to a player who joined late — no personal threshold', () => {
    expect(isEligible(player('late', { rounds: 6 }), 13)).toBe(false);
    expect(isEligible(player('late', { rounds: 7 }), 13)).toBe(true);
  });
});

describe('the penalty attempt gate', () => {
  it('scales with the season and then stops', () => {
    expect(minPenaltyAttempts(10)).toBe(2);
    expect(minPenaltyAttempts(24)).toBe(3);
    expect(minPenaltyAttempts(35)).toBe(4);
    expect(minPenaltyAttempts(50)).toBe(5);
    expect(minPenaltyAttempts(200)).toBe(5);
  });

  it('never drops below two, however short the season', () => {
    expect(minPenaltyAttempts(1)).toBe(2);
    expect(minPenaltyAttempts(0)).toBe(2);
  });

  it('a perfect record off one kick wins nothing', () => {
    const a = computeSeasonAwards(
      [player('sniper', { rounds: 10, penTaken: 1, penScored: 1 })],
      [], 20,
    );
    expect(a.penaltyKing).toBeNull();
  });

  it('but a real sample does win, on rate not volume', () => {
    const a = computeSeasonAwards(
      [
        player('accurate', { rounds: 10, penTaken: 4, penScored: 4 }),
        player('busy', { rounds: 10, penTaken: 20, penScored: 15 }),
      ],
      [], 20,
    );
    expect(a.penaltyKing?.winners).toEqual(['accurate']);
    expect(a.penaltyKing?.value).toBe(1);
  });
});

describe('a title nobody deserves is not awarded', () => {
  it('nobody eligible → every title null', () => {
    const a = computeSeasonAwards(
      [player('ghost', { rounds: 2, goals: 9 })],
      [], 20,
    );
    for (const key of SEASON_TITLE_KEYS) expect(a[key]).toBeNull();
  });

  it('everyone on zero → null, not a winner on zero', () => {
    const a = computeSeasonAwards(
      [player('a'), player('b'), player('c')],
      [], 10,
    );
    expect(a.topScorer).toBeNull();
    expect(a.topAssister).toBeNull();
    expect(a.cleanSheetKing).toBeNull();
  });

  it('an empty season awards nothing and does not throw', () => {
    const a = computeSeasonAwards([], [], 0);
    for (const key of SEASON_TITLE_KEYS) expect(a[key]).toBeNull();
  });

  it('mostLoyal still needs someone to have played', () => {
    const a = computeSeasonAwards([player('nobody', { rounds: 0 })], [], 0);
    expect(a.mostLoyal).toBeNull();
  });
});

describe('two lucky evenings do not buy a crown', () => {
  it('the fringe scorer loses to the eligible one', () => {
    const a = computeSeasonAwards(
      [
        player('fringe', { rounds: 2, goals: 9 }),   // below the gate
        player('regular', { rounds: 12, goals: 4 }),
      ],
      [], 20,
    );
    expect(a.topScorer?.winners).toEqual(['regular']);
    expect(a.topScorer?.value).toBe(4);
  });
});

describe('ties are shared, never broken arbitrarily', () => {
  it('two on the same number both win', () => {
    const a = computeSeasonAwards(
      [player('aaa', { goals: 7 }), player('zzz', { goals: 7 })],
      [], 10,
    );
    expect(a.topScorer?.winners.sort()).toEqual(['aaa', 'zzz']);
  });

  it('three on the same number all win', () => {
    const a = computeSeasonAwards(
      [player('a', { wins: 5 }), player('b', { wins: 5 }), player('c', { wins: 5 })],
      [], 10,
    );
    expect(a.topWinner?.winners).toHaveLength(3);
  });

  it('the id never decides it', () => {
    // 'aaa' sorts first and 'zzz' last; neither may be preferred.
    const a = computeSeasonAwards(
      [player('zzz', { assists: 3 }), player('aaa', { assists: 3 })],
      [], 10,
    );
    expect(a.topAssister?.winners).toHaveLength(2);
  });

  it('the MVP is compared on the exact value, not the displayed one', () => {
    const a = computeSeasonAwards(
      [player('x', { mvpAvg: 8.3746 }), player('y', { mvpAvg: 8.3751 })],
      [], 10,
    );
    expect(a.mvp?.winners).toEqual(['y']);
  });
});

describe('a player who left the club still wins', () => {
  it('membership is not a condition — the title was earned on the pitch', () => {
    // Nothing in the input says whether they are still a member, by design.
    const a = computeSeasonAwards(
      [player('departed', { rounds: 12, goals: 20 }), player('stayed', { rounds: 12, goals: 5 })],
      [], 20,
    );
    expect(a.topScorer?.winners).toEqual(['departed']);
  });
});

describe('the deadly duo needs two eligible players', () => {
  it('a regular plus a drop-in does not take it', () => {
    const a = computeSeasonAwards(
      [player('regular', { rounds: 12 }), player('dropin', { rounds: 2 })],
      [pair('regular', 'dropin', { score: 9, together: 2 })],
      20,
    );
    expect(a.deadlyDuo).toBeNull();
  });

  it('two regulars do', () => {
    const a = computeSeasonAwards(
      [player('one', { rounds: 12 }), player('two', { rounds: 12 })],
      [pair('one', 'two', { score: 6, together: 10 })],
      20,
    );
    expect(a.deadlyDuo?.winners).toEqual(['one__two']);
  });
});

describe('one player can hold several titles', () => {
  it('top scorer and top assister at once', () => {
    const a = computeSeasonAwards(
      [
        player('star', { rounds: 12, goals: 20, assists: 15, mvpAvg: 9 }),
        player('other', { rounds: 12, goals: 3, assists: 2, mvpAvg: 7 }),
      ],
      [], 20,
    );
    expect(a.topScorer?.winners).toEqual(['star']);
    expect(a.topAssister?.winners).toEqual(['star']);
    expect(a.mvp?.winners).toEqual(['star']);
  });
});

describe('there is no own-goals title', () => {
  it('the key set is exactly the nine', () => {
    expect([...SEASON_TITLE_KEYS].sort()).toEqual([
      'cleanSheetKing', 'deadlyDuo', 'mostLoyal', 'mvp', 'penaltyKeeper',
      'penaltyKing', 'topAssister', 'topScorer', 'topWinner',
    ]);
    expect(SEASON_TITLE_KEYS).not.toContain('ownGoalKing');
  });
});
