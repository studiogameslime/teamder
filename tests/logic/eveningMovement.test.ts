import { computeMovement } from '../../functions/src/eveningMovement';

// Values are (cumulative-now, scored-tonight); "before" = now - tonight.
const table = (rows: Record<string, [number, number]>) => {
  // Current ranking: by value desc, uid asc — the same tiebreak the summary
  // pipeline uses, and the thing that made positions untrustworthy.
  const order = Object.keys(rows).sort(
    (a, b) => rows[b][0] - rows[a][0] || a.localeCompare(b),
  );
  return {
    order,
    valueOf: (id: string) => ({ now: rows[id][0], tonight: rows[id][1] }),
  };
};

describe('computeMovement', () => {
  // The production report: Eliran 17 -> 18, Itai 16 -> 18. Itai CAUGHT UP.
  // 'a-itai' sorts before 'b-eliran', so on a tie the ranking puts Itai above —
  // which is exactly what a position-based rule mistook for an overtake.
  it('does not call a tie an overtake', () => {
    const { order, valueOf } = table({ 'a-itai': [18, 2], 'b-eliran': [18, 1] });
    expect(order[0]).toBe('a-itai'); // Itai really is listed above now
    expect(computeMovement('b-eliran', order, valueOf).passedBy).toEqual([]);
    expect(computeMovement('a-itai', order, valueOf).passed).toEqual([]);
  });

  it('reports a real overtake — strictly behind, then strictly ahead', () => {
    const { order, valueOf } = table({ itai: [19, 3], eliran: [18, 1] });
    expect(computeMovement('eliran', order, valueOf).passedBy).toEqual(['itai']);
    expect(computeMovement('itai', order, valueOf).passed).toEqual(['eliran']);
  });

  it('does not treat breaking away from a tie as an overtake of the tied player', () => {
    // Both were on 17; Itai scored, so he was never BEHIND — no crossing.
    const { order, valueOf } = table({ itai: [19, 2], eliran: [17, 0] });
    expect(computeMovement('eliran', order, valueOf).passedBy).toEqual([]);
  });

  it('is symmetric: one side passed, the other passedBy', () => {
    const { order, valueOf } = table({ x: [10, 5], y: [8, 0] });
    expect(computeMovement('x', order, valueOf).passed).toEqual(['y']);
    expect(computeMovement('y', order, valueOf).passedBy).toEqual(['x']);
  });

  it('handles several players crossing in one evening', () => {
    const { order, valueOf } = table({ me: [10, 5], a: [9, 0], b: [8, 0], c: [12, 0] });
    const mv = computeMovement('me', order, valueOf);
    expect(mv.passed.sort()).toEqual(['a', 'b']);
    expect(mv.passedBy).toEqual([]);
  });

  it('names come back in leaderboard order', () => {
    const { order, valueOf } = table({ me: [5, 0], hi: [9, 5], lo: [7, 5] });
    expect(computeMovement('me', order, valueOf).passedBy).toEqual(['hi', 'lo']);
  });

  it('nobody moves when nobody scored', () => {
    const { order, valueOf } = table({ a: [5, 0], b: [3, 0] });
    expect(computeMovement('a', order, valueOf)).toEqual({ passed: [], passedBy: [] });
  });
});
