/**
 * Club chemistry: what a pair did together, inside ONE club.
 *
 * The cases here concentrate on the two ways this can quietly lie. First,
 * direction: every counter is keyed by the sorted pair, so a head-to-head
 * record must read the same whichever way round the caller names the two
 * players — get that wrong and a rivalry shows reversed for half its viewers.
 * Second, sample size: without a floor, the "most balanced rivalry" is always
 * some pair who met once and finished 1–0, which looks like a perfect record
 * and means nothing.
 */
import {
  pairsFromRounds,
  mergePairs,
  pickChemistry,
  pairKey,
  titlesOf,
  CHEMISTRY_MIN,
  EMPTY_PAIR,
  type ChemistryRound,
  type PairTotals,
} from '@/utils/clubChemistry';

const R = (o: Partial<ChemistryRound> = {}): ChemistryRound => ({
  teamA: ['a', 'b'],
  teamB: ['x', 'y'],
  scoreA: 1,
  scoreB: 0,
  winnerSide: 'A',
  goals: [],
  ...o,
});

const P = (o: Partial<PairTotals> = {}): PairTotals => ({ ...EMPTY_PAIR, ...o });

// ─── together ─────────────────────────────────────────────────────────────

describe('pairs on the same team', () => {
  it('counts a mini-game together exactly once per pair', () => {
    const out = pairsFromRounds([R({ teamA: ['a', 'b', 'c'], teamB: ['x'] })]);
    expect(out[pairKey('a', 'b')].sameTeam).toBe(1);
    expect(out[pairKey('a', 'c')].sameTeam).toBe(1);
    expect(out[pairKey('b', 'c')].sameTeam).toBe(1);
  });

  it('credits the winning side together and the losing side together', () => {
    const out = pairsFromRounds([R({ winnerSide: 'A' })]);
    expect(out[pairKey('a', 'b')]).toMatchObject({ winsTogether: 1, lossesTogether: 0 });
    expect(out[pairKey('x', 'y')]).toMatchObject({ winsTogether: 0, lossesTogether: 1 });
  });

  it('gives a draw to neither side', () => {
    const out = pairsFromRounds([R({ winnerSide: 'tie', scoreA: 1, scoreB: 1 })]);
    expect(out[pairKey('a', 'b')]).toMatchObject({ sameTeam: 1, winsTogether: 0, lossesTogether: 0 });
  });

  it('adds up across mini-games instead of replacing', () => {
    const out = pairsFromRounds([R(), R(), R({ winnerSide: 'B' })]);
    expect(out[pairKey('a', 'b')]).toMatchObject({ sameTeam: 3, winsTogether: 2, lossesTogether: 1 });
  });
});

// ─── clean sheets ─────────────────────────────────────────────────────────

describe('clean sheets kept together', () => {
  it('credits the side that conceded nothing', () => {
    const out = pairsFromRounds([R({ scoreA: 2, scoreB: 0 })]);
    expect(out[pairKey('a', 'b')].cleanSheetsTogether).toBe(1);
    expect(out[pairKey('x', 'y')].cleanSheetsTogether).toBe(0);
  });

  it('credits both sides on a goalless mini-game', () => {
    const out = pairsFromRounds([R({ scoreA: 0, scoreB: 0, winnerSide: 'tie' })]);
    expect(out[pairKey('a', 'b')].cleanSheetsTogether).toBe(1);
    expect(out[pairKey('x', 'y')].cleanSheetsTogether).toBe(1);
  });

  it('does not let a shootout become a goal conceded', () => {
    // 0:0 decided on penalties: the kicks are not goals anywhere else in the
    // app, so both sides keep the clean sheet they earned in normal play.
    const out = pairsFromRounds([R({ scoreA: 0, scoreB: 0, winnerSide: 'A' })]);
    expect(out[pairKey('a', 'b')].cleanSheetsTogether).toBe(1);
    expect(out[pairKey('x', 'y')].cleanSheetsTogether).toBe(1);
  });

  it('credits nobody when both sides scored', () => {
    const out = pairsFromRounds([R({ scoreA: 2, scoreB: 1 })]);
    expect(out[pairKey('a', 'b')].cleanSheetsTogether).toBe(0);
    expect(out[pairKey('x', 'y')].cleanSheetsTogether).toBe(0);
  });
});

// ─── against ──────────────────────────────────────────────────────────────

describe('pairs on opposite teams', () => {
  it('records a meeting for every cross pair', () => {
    const out = pairsFromRounds([R({ teamA: ['a'], teamB: ['x', 'y'] })]);
    expect(out[pairKey('a', 'x')].against).toBe(1);
    expect(out[pairKey('a', 'y')].against).toBe(1);
  });

  it('credits the head-to-head win to the player who actually won', () => {
    // 'a' sorts before 'x', so winsA is a's column.
    const out = pairsFromRounds([R({ teamA: ['a'], teamB: ['x'], winnerSide: 'A' })]);
    expect(out[pairKey('a', 'x')]).toMatchObject({ against: 1, winsA: 1, winsB: 0 });
  });

  it('reads the same however the caller names the two', () => {
    const left = pairsFromRounds([R({ teamA: ['zed'], teamB: ['abe'], winnerSide: 'A' })]);
    const right = pairsFromRounds([R({ teamA: ['abe'], teamB: ['zed'], winnerSide: 'B' })]);
    // Same event twice, sides swapped: zed beat abe both times.
    expect(left[pairKey('zed', 'abe')]).toEqual(right[pairKey('abe', 'zed')]);
    // and the win belongs to zed, who sorts second
    expect(left[pairKey('zed', 'abe')].winsB).toBe(1);
  });

  it('counts a drawn meeting as a meeting and nobody’s win', () => {
    const out = pairsFromRounds([R({ teamA: ['a'], teamB: ['x'], winnerSide: 'tie' })]);
    expect(out[pairKey('a', 'x')]).toMatchObject({ against: 1, winsA: 0, winsB: 0 });
  });
});

// ─── assists ──────────────────────────────────────────────────────────────

describe('assists between two players', () => {
  const withGoals = (goals: ChemistryRound['goals']) => pairsFromRounds([R({ goals })]);

  it('records the direction it was played in', () => {
    const out = withGoals([{ scorerId: 'b', assisterId: 'a', ownGoal: false }]);
    expect(out[pairKey('a', 'b')]).toMatchObject({ assistsAToB: 1, assistsBToA: 0 });
  });

  it('records the reverse direction separately', () => {
    const out = withGoals([{ scorerId: 'a', assisterId: 'b', ownGoal: false }]);
    expect(out[pairKey('a', 'b')]).toMatchObject({ assistsAToB: 0, assistsBToA: 1 });
  });

  it('ignores a goal with no assist, and an own goal', () => {
    const out = withGoals([
      { scorerId: 'a', assisterId: null, ownGoal: false },
      { scorerId: null, assisterId: null, ownGoal: true },
    ]);
    expect(out[pairKey('a', 'b')]?.assistsAToB ?? 0).toBe(0);
  });

  it('ignores a player credited with assisting themselves', () => {
    const out = withGoals([{ scorerId: 'a', assisterId: 'a', ownGoal: false }]);
    expect(Object.keys(out).some((k) => k === pairKey('a', 'a'))).toBe(false);
  });
});

// ─── merge ────────────────────────────────────────────────────────────────

it('folds one evening onto another without losing either', () => {
  const first = pairsFromRounds([R()]);
  const second = pairsFromRounds([R({ winnerSide: 'B' })]);
  const both = mergePairs(first, second);
  expect(both[pairKey('a', 'b')]).toMatchObject({ sameTeam: 2, winsTogether: 1, lossesTogether: 1 });
});

// ─── picking the six ──────────────────────────────────────────────────────

describe('choosing the six', () => {
  const club = (over: Record<string, Partial<PairTotals>>) =>
    Object.fromEntries(Object.entries(over).map(([k, v]) => [k, P(v)]));

  it('says nothing at all about a club with barely any history', () => {
    const picks = pickChemistry(club({ 'a__b': { sameTeam: 1, winsTogether: 1, against: 1 } }));
    expect(picks).toHaveLength(0);
  });

  it('finds each category’s leader once there is enough behind it', () => {
    const picks = pickChemistry(
      club({
        'a__b': { winsTogether: 14, sameTeam: 27, assistsAToB: 6, assistsBToA: 3, cleanSheetsTogether: 4 },
        'c__d': { cleanSheetsTogether: 12, sameTeam: 20 },
        'e__f': { against: 26, winsA: 20, winsB: 6 },
      }),
    );
    const by = Object.fromEntries(picks.map((p) => [p.kind, p]));
    expect(by.winningDuo).toMatchObject({ pairs: ['a__b'], value: 14 });
    expect(by.regulars).toMatchObject({ pairs: ['a__b'], value: 27 });
    expect(by.deadlyDuo).toMatchObject({ pairs: ['a__b'], value: 9 });
    expect(by.wall).toMatchObject({ pairs: ['c__d'], value: 12 });
    expect(by.rivalry).toMatchObject({ pairs: ['e__f'], value: 26 });
  });

  it('names every pair tied at the top instead of picking one', () => {
    const picks = pickChemistry(
      club({ 'a__b': { cleanSheetsTogether: 12 }, 'c__d': { cleanSheetsTogether: 12 } }),
    );
    const wall = picks.find((p) => p.kind === 'wall');
    expect(wall).toMatchObject({ pairs: ['a__b', 'c__d'], tied: true });
  });

  it('will not call a single meeting the most balanced rivalry', () => {
    const picks = pickChemistry(
      club({
        // A perfect-looking 1–0 over one meeting.
        'a__b': { against: 1, winsA: 1, winsB: 0 },
        // A real record, less perfectly split.
        'c__d': { against: 20, winsA: 11, winsB: 9 },
      }),
    );
    const bal = picks.find((p) => p.kind === 'balancedRivalry');
    expect(bal).toMatchObject({ pairs: ['c__d'] });
  });

  it('prefers the record tested more often when two are equally close', () => {
    const picks = pickChemistry(
      club({
        'a__b': { against: 12, winsA: 6, winsB: 6 },
        'c__d': { against: 26, winsA: 13, winsB: 13 },
      }),
    );
    const bal = picks.find((p) => p.kind === 'balancedRivalry');
    expect(bal).toMatchObject({ pairs: ['c__d'], value: 26 });
    expect(bal?.balance).toEqual({ winsA: 13, winsB: 13, against: 26 });
  });

  it('drops the balanced rivalry entirely when nothing clears the sample floor', () => {
    const picks = pickChemistry(club({ 'a__b': { against: CHEMISTRY_MIN.balancedRivalry - 1, winsA: 2, winsB: 2 } }));
    expect(picks.some((p) => p.kind === 'balancedRivalry')).toBe(false);
  });

  it('lists every title a pair holds, for its card', () => {
    const picks = pickChemistry(
      club({ 'a__b': { winsTogether: 14, sameTeam: 27, assistsAToB: 9 } }),
    );
    expect(titlesOf(picks, 'a__b').sort()).toEqual(['deadlyDuo', 'regulars', 'winningDuo']);
    expect(titlesOf(picks, 'x__y')).toEqual([]);
  });
});
