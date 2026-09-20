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
  // Evenings attended. This is the eligibility numerator and the loyalty
  // title; `rounds` (mini-games) is neither, and mixing the two made the gate
  // roughly six times too loose.
  games: 10,
  rounds: 60,
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
    expect(isEligible(player('late', { games: 6 }), 13)).toBe(false);
    expect(isEligible(player('late', { games: 7 }), 13)).toBe(true);
  });

  it('counts EVENINGS, not mini-games — the unit that once broke the gate', () => {
    // A club plays roughly six mini-games an evening. Someone who turned up
    // twice all season has ~12 mini-games, which cleared a gate meant to
    // demand half a season of attendance. Both sides are evenings now.
    const visitor = player('visitor', { games: 2, rounds: 12 });
    expect(isEligible(visitor, 13)).toBe(false);
    const regular = player('regular', { games: 9, rounds: 9 });
    expect(isEligible(regular, 13)).toBe(true);
  });

  it('the loyalty title is turning up, not playing long rotations', () => {
    const a = computeSeasonAwards(
      [
        // Fewer evenings, but far more mini-games inside them.
        player('marathon', { games: 7, rounds: 70 }),
        player('everyWeek', { games: 12, rounds: 40 }),
      ],
      [],
      13,
    );
    expect(a.mostLoyal?.winners).toEqual(['everyWeek']);
    expect(a.mostLoyal?.value).toBe(12);
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

  // ⚠️ RULE CHANGE, 20.09.2026. These two titles were decided on RATE with a
  // minimum-attempts gate; they are decided on COUNT with no gate at all.
  //
  // The old pair of cases below this one is what the rate rule produced, and
  // it is worth keeping in view because it is what every archive written
  // before the change contains: a player who took four penalties and scored
  // four of them beat a player who took twenty and scored fifteen, because
  // 100% beats 75%. `minPenaltyAttempts` existed to stop that being decided
  // off a single kick, which is a prop a count does not need.
  it('the most penalties scored wins it, not the best percentage', () => {
    const a = computeSeasonAwards(
      [
        player('accurate', { games: 10, penTaken: 4, penScored: 4 }),
        player('busy', { games: 10, penTaken: 20, penScored: 15 }),
      ],
      [], 20,
    );
    expect(a.penaltyKing?.winners).toEqual(['busy']);
    expect(a.penaltyKing?.value).toBe(15);
  });

  it('one scored penalty takes it if nobody scored two', () => {
    // No minimum sample any more. The thing a minimum protected against — a
    // perfect rate off one attempt — cannot arise from a count.
    const a = computeSeasonAwards(
      [
        player('sniper', { games: 10, penTaken: 1, penScored: 1 }),
        player('misser', { games: 10, penTaken: 9, penScored: 0 }),
      ],
      [], 20,
    );
    expect(a.penaltyKing?.winners).toEqual(['sniper']);
    expect(a.penaltyKing?.value).toBe(1);
  });

  it('and nobody scoring one means no penalty king at all', () => {
    const a = computeSeasonAwards(
      [player('misser', { games: 10, penTaken: 9, penScored: 0 })],
      [], 20,
    );
    expect(a.penaltyKing).toBeNull();
  });

  it('the keeper title counts SAVES, on the same terms', () => {
    const a = computeSeasonAwards(
      [
        player('shotstopper', { games: 10, penFaced: 3, penSaved: 3 }),
        player('busy-keeper', { games: 10, penFaced: 30, penSaved: 8 }),
      ],
      [], 20,
    );
    expect(a.penaltyKeeper?.winners).toEqual(['busy-keeper']);
    expect(a.penaltyKeeper?.value).toBe(8);
  });

  it('and attendance is not a condition for either of them', () => {
    // Two evenings out of twenty, and the season's penalty record.
    const a = computeSeasonAwards(
      [
        player('visitor', { games: 2, penTaken: 6, penScored: 5 }),
        player('regular', { games: 18, penTaken: 6, penScored: 2 }),
      ],
      [], 20,
    );
    expect(a.penaltyKing?.winners).toEqual(['visitor']);
  });
});

describe('a title nobody deserves is not awarded', () => {
  // ⚠️ RULE CHANGE, 20.09.2026. Failing the attendance gate used to mean
  // winning nothing; it now means winning everything except שחקן העונה.
  it('a player below the attendance gate still wins what he leads', () => {
    const a = computeSeasonAwards(
      [player('ghost', { games: 2, goals: 9, mvpAvg: 9.5 })],
      [], 20,
    );
    expect(a.topScorer?.winners).toEqual(['ghost']);
    expect(a.topScorer?.value).toBe(9);
    expect(a.mostLoyal?.winners).toEqual(['ghost']);
    // …except the one title that is an average, where two evenings out of
    // twenty is not a season however good they were.
    expect(a.mvp).toBeNull();
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
    const a = computeSeasonAwards([player('nobody', { games: 0 })], [], 0);
    expect(a.mostLoyal).toBeNull();
  });
});

describe('two lucky evenings do not buy a crown', () => {
  // ⚠️ RULE CHANGE, 20.09.2026, and this is the case the change exists for.
  // Nine goals in two evenings used to lose מלך השערים to four goals in
  // twelve, because the fringe player was filtered out before any counting
  // happened. Leading a count now wins the count.
  it('the fringe scorer wins it — he scored more', () => {
    const a = computeSeasonAwards(
      [
        player('fringe', { games: 2, goals: 9 }),
        player('regular', { games: 12, goals: 4 }),
      ],
      [], 20,
    );
    expect(a.topScorer?.winners).toEqual(['fringe']);
    expect(a.topScorer?.value).toBe(9);
  });

  it('but שחקן העונה still goes to the one who turned up', () => {
    const a = computeSeasonAwards(
      [
        player('fringe', { games: 2, mvpAvg: 9.8 }),
        player('regular', { games: 12, mvpAvg: 7.1 }),
      ],
      [], 20,
    );
    expect(a.mvp?.winners).toEqual(['regular']);
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
      [player('departed', { games: 12, goals: 20 }), player('stayed', { games: 12, goals: 5 })],
      [], 20,
    );
    expect(a.topScorer?.winners).toEqual(['departed']);
  });
});

describe('the deadly duo needs two eligible players', () => {
  // ⚠️ RULE CHANGE, 20.09.2026. The pair gate is gone with every other
  // attendance gate; the THREE-goal floor stays, because the club's chemistry
  // card shows a הצמד הקטלני under the same name and the same threshold all
  // year and a season title naming a different pair would read as a mistake.
  it('a regular plus a drop-in takes it if they combined for the most', () => {
    const a = computeSeasonAwards(
      [player('regular', { games: 12 }), player('dropin', { games: 2 })],
      [pair('regular', 'dropin', { score: 9, together: 2 })],
      20,
    );
    expect(a.deadlyDuo?.winners).toEqual(['regular__dropin']);
    expect(a.deadlyDuo?.value).toBe(9);
  });

  it('and the three-goal floor still holds for them', () => {
    const a = computeSeasonAwards(
      [player('regular', { games: 12 }), player('dropin', { games: 2 })],
      [pair('regular', 'dropin', { score: 2, together: 2 })],
      20,
    );
    expect(a.deadlyDuo).toBeNull();
  });

  it('two regulars do', () => {
    const a = computeSeasonAwards(
      [player('one', { games: 12 }), player('two', { games: 12 })],
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
        player('star', { games: 12, goals: 20, assists: 15, mvpAvg: 9 }),
        player('other', { games: 12, goals: 3, assists: 2, mvpAvg: 7 }),
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

describe('the deadly duo is a partnership, not an accident', () => {
  // The club's chemistry card shows a "הצמד הקטלני" all year, computed from
  // directional assists with a floor of 3. A season title wearing the same
  // Hebrew name and crowning a different pair would simply look wrong.
  const eligible = (uid: string) => player(uid, { games: 12 });

  it('one assist between two regulars is not a duo', () => {
    const a = computeSeasonAwards(
      [eligible('x'), eligible('y')],
      [pair('x', 'y', { score: 1, together: 9 })],
      13,
    );
    expect(a.deadlyDuo).toBeNull();
  });

  it('two is still not', () => {
    const a = computeSeasonAwards(
      [eligible('x'), eligible('y')],
      [pair('x', 'y', { score: 2, together: 9 })],
      13,
    );
    expect(a.deadlyDuo).toBeNull();
  });

  it('three is', () => {
    const a = computeSeasonAwards(
      [eligible('x'), eligible('y')],
      [pair('x', 'y', { score: 3, together: 9 })],
      13,
    );
    expect(a.deadlyDuo?.winners).toEqual(['x__y']);
    expect(a.deadlyDuo?.value).toBe(3);
  });

  it('and the busier pair still wins when both clear the floor', () => {
    const a = computeSeasonAwards(
      [eligible('x'), eligible('y'), eligible('p'), eligible('q')],
      [
        pair('x', 'y', { score: 4, together: 9 }),
        pair('p', 'q', { score: 11, together: 9 }),
      ],
      13,
    );
    expect(a.deadlyDuo?.winners).toEqual(['p__q']);
  });
});

describe('a season with no finished evenings', () => {
  // eligibilityThreshold(0) is 0, so every gate opens. A club whose evenings
  // were never sealed would otherwise crown nine champions on a single goal,
  // and the archive would carry it forever.
  it('awards nothing at all', () => {
    const a = computeSeasonAwards(
      [player('lucky', { games: 0, rounds: 1, goals: 1, assists: 1, wins: 1 })],
      [pair('lucky', 'other', { score: 9, together: 1 })],
      0,
    );
    for (const k of SEASON_TITLE_KEYS) expect(a[k]).toBeNull();
  });

  it('but one finished evening is enough to decide one', () => {
    const a = computeSeasonAwards(
      [player('real', { games: 1, rounds: 6, goals: 3 })],
      [],
      1,
    );
    expect(a.topScorer?.winners).toEqual(['real']);
  });
});

describe('the MVP scale floor', () => {
  // The evening score is clamped to [6, 10] and returns exactly 6.0 for a
  // player who played no mini-games — which is every player of every
  // timer-only club. With the old floor of 0 that sentinel won.
  const flat = (uid: string) => player(uid, { games: 18, mvpAvg: 6 });

  it('nobody is player of the season on the bottom of the scale', () => {
    const rows = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(flat);
    expect(computeSeasonAwards(rows, [], 22).mvp).toBeNull();
  });

  it('and the whole club does not share it', () => {
    // The exact production shape: seven members, every mvpAvg 6.0, seven
    // title documents written to seven profiles.
    const rows = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(flat);
    expect(computeSeasonAwards(rows, [], 22).mvp?.winners ?? []).toHaveLength(0);
  });

  it('one player above the floor still takes it', () => {
    const rows = [flat('a'), flat('b'), player('c', { games: 18, mvpAvg: 6.4 })];
    const mvp = computeSeasonAwards(rows, [], 22).mvp;
    expect(mvp?.winners).toEqual(['c']);
    expect(mvp?.value).toBeCloseTo(6.4);
  });
});
