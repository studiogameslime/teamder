import { buildClubRecords, type ClubRecordsInput } from '../src/utils/clubRecords';
import { splitRoundResults } from '../src/utils/roundResults';

const NAMES: Record<string, string> = { u1: 'דני', u2: 'אלירן', u3: 'שוש' };
const nameOf = (uid: string) => NAMES[uid] ?? null;

const base: ClubRecordsInput = {
  longestStreak: 0,
  longestStreakUid: null,
  mostGoalsEvening: null,
  mostShootoutsEvening: null,
  longestEvening: null,
  totalFinished: 0,
  nameOf,
};

describe('buildClubRecords', () => {
  it('a club with no history has no records — not a wall of zeros', () => {
    expect(buildClubRecords(base)).toEqual([]);
  });

  it('a streak of 1 is not a streak', () => {
    const out = buildClubRecords({ ...base, longestStreak: 1, longestStreakUid: 'u1' });
    expect(out.find((r) => r.key === 'streak')).toBeUndefined();
  });

  it('drops a record whose holder has no name rather than printing a uid', () => {
    const out = buildClubRecords({
      ...base,
      longestStreak: 7,
      longestStreakUid: 'ghost',
    });
    expect(out.find((r) => r.key === 'streak')).toBeUndefined();
  });

  it('names the streak holder and never implies wins', () => {
    const out = buildClubRecords({
      ...base,
      longestStreak: 7,
      longestStreakUid: 'u1',
    });
    const streak = out.find((r) => r.key === 'streak')!;
    expect(streak.value).toBe('7');
    expect(streak.holderName).toBe('דני');
    expect(streak.hint).toContain('מחזורים');
    expect(streak.hint).not.toContain('ניצחון');
    expect(streak.hint).not.toContain('רצף ניצחונות');
  });











  it('is data, not UI — every record carries its own icon, tint and label', () => {
    const out = buildClubRecords({
      ...base,
      longestStreak: 4,
      longestStreakUid: 'u1',
      totalFinished: 2,
      mostGoalsEvening: { value: 47, gameId: 'g28', at: 100 },
      mostShootoutsEvening: { value: 5, gameId: 'g19', at: 90 },
      longestEvening: { value: 18, gameId: 'g23', at: 80 },
    });
    expect(out).toHaveLength(4);
    for (const r of out) {
      expect(r.key).toBeTruthy();
      expect(r.icon).toBeTruthy();
      expect(r.tint).toMatch(/^#/);
      expect(r.label).toBeTruthy();
      expect(r.value).toBeTruthy();
    }
  });

  it('only the evening records carry a gameId — the streak spans many', () => {
    // The card is tappable iff it has one, so a record with no single evening
    // behind it must not be made to look navigable.
    const out = buildClubRecords({
      ...base,
      longestStreak: 9,
      longestStreakUid: 'u1',
      mostGoalsEvening: { value: 47, gameId: 'g28', at: 100 },
    });
    expect(out.find((r) => r.key === 'streak')!.gameId).toBeUndefined();
    expect(out.find((r) => r.key === 'goalsEvening')!.gameId).toBe('g28');
  });

  it('an evening record of zero is not shown', () => {
    const out = buildClubRecords({
      ...base,
      mostShootoutsEvening: { value: 0, gameId: 'g1', at: 1 },
    });
    expect(out.find((r) => r.key === 'shootoutsEvening')).toBeUndefined();
  });

});

describe('splitRoundResults', () => {
  it('splits into three disjoint slices that sum to the total', () => {
    const { tie, shootout, regular } = splitRoundResults(100, 20, 10);
    expect({ tie, shootout, regular }).toEqual({ tie: 20, shootout: 10, regular: 70 });
    expect(tie + shootout + regular).toBe(100);
  });

  it('never returns a negative slice when the counters overshoot the total', () => {
    // Svg renders a negative dash length as a FULL ring — the failure mode is
    // a chart that claims 100% of something that never happened.
    const { tie, shootout, regular } = splitRoundResults(5, 9, 9);
    expect(tie).toBe(5);
    expect(shootout).toBe(0);
    expect(regular).toBe(0);
    expect(tie + shootout + regular).toBe(5);
  });

  it('an empty club splits into nothing', () => {
    expect(splitRoundResults(0, 0, 0)).toEqual({ tie: 0, shootout: 0, regular: 0 });
  });

  it('old data with uncounted shootouts still sums correctly', () => {
    // shootoutRounds only counts from the deploy that added it, so a historical
    // club reads 0 — the slice must vanish, not distort the other two.
    const { tie, shootout, regular } = splitRoundResults(40, 6, 0);
    expect(shootout).toBe(0);
    expect(regular).toBe(34);
    expect(tie + shootout + regular).toBe(40);
  });
});
