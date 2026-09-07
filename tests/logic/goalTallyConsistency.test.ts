// One evening, two goal records, and the rule that keeps them honest (P1-7).
//
// `liveMatch.goals` is the CURRENT mini-game's log; `liveMatch.goalTally` is the
// per-player total for the whole evening. Different scopes, so they may hold
// different numbers — but only for the right reason. These tests pin the two
// places where they used to diverge for the wrong one.

import {
  tallyCreditFor,
  tallyDelta,
  tallyWithout,
  type TallyableGoal,
} from '@/utils/goalTally';

const goal = (scorerId: string | null, ownGoal = false): TallyableGoal => ({
  scorerId,
  ownGoal,
});

describe('who a goal credits on the badge', () => {
  it('credits a real scorer', () => {
    expect(tallyCreditFor(goal('u1'))).toBe('u1');
  });

  it('credits a GUEST scorer — a guest is a full player in the cycle', () => {
    expect(tallyCreditFor(goal('guest:7'))).toBe('guest:7');
  });

  it('credits nobody for an own goal', () => {
    expect(tallyCreditFor(goal('u1', true))).toBeNull();
  });

  it('credits nobody when the scorer was not recorded', () => {
    expect(tallyCreditFor(goal(null))).toBeNull();
    expect(tallyCreditFor(goal(undefined as unknown as string))).toBeNull();
  });
});

describe('tallyDelta counts a set of goals the same way recordGoal does', () => {
  it('sums per player and skips own / unattributed goals', () => {
    expect(
      tallyDelta([goal('u1'), goal('u2'), goal('u1'), goal('u3', true), goal(null)]),
    ).toEqual({ u1: 2, u2: 1 });
  });

  it('an empty or missing log has no delta', () => {
    expect(tallyDelta([])).toEqual({});
    expect(tallyDelta(undefined)).toEqual({});
  });
});

describe('a round RESET discards its goals — the badge has to lose them too', () => {
  // The bug: reset wiped goals[] and the score but left goalTally untouched.
  // Those goals were never committed to stats, so the badge over-counted
  // against both the round table and the club table for the rest of the night.
  it('subtracts exactly the discarded round from the evening tally', () => {
    const evening = { u1: 5, u2: 3, u3: 1 };
    const discardedRound = [goal('u1'), goal('u1'), goal('u2')];
    expect(tallyWithout(evening, discardedRound)).toEqual({ u1: 3, u2: 2, u3: 1 });
  });

  it('drops a player who had only the discarded goals, instead of leaving a 0', () => {
    expect(tallyWithout({ u1: 1 }, [goal('u1')])).toEqual({});
  });

  it('never goes negative, even if the tally and the log disagree', () => {
    expect(tallyWithout({ u1: 1 }, [goal('u1'), goal('u1'), goal('u1')])).toEqual({});
  });

  it('leaves own goals and unattributed goals alone', () => {
    expect(tallyWithout({ u1: 2 }, [goal('u1', true), goal(null)])).toEqual({ u1: 2 });
  });

  it('is a no-op when there is nothing to discard', () => {
    expect(tallyWithout({ u1: 2 }, [])).toEqual({ u1: 2 });
    expect(tallyWithout(undefined, [goal('u1')])).toEqual({});
  });

  // The property that matters: reset then re-score the same goals, and you are
  // back exactly where you started. No drift across repeated resets.
  it('reset + re-record round-trips to the original tally', () => {
    const evening = { u1: 4, u2: 2 };
    const round = [goal('u1'), goal('u2'), goal('u1')];
    const afterReset = tallyWithout(evening, round);
    const rescored = { ...afterReset };
    for (const [id, n] of Object.entries(tallyDelta(round))) {
      rescored[id] = (rescored[id] ?? 0) + n;
    }
    expect(rescored).toEqual(evening);
  });
});

describe('stopRotation clears BOTH sources, so nothing can resurrect', () => {
  // The bug: stopRotation zeroed goalTally but left goals[] behind, and the
  // live screen's "no tally → derive from the log" fallback rebuilt the badge
  // from the stale round. Modelled here as the screen's own derivation.
  const badgeFor = (live: {
    goalTally?: Record<string, number>;
    goals?: TallyableGoal[];
  }) => {
    if (live.goalTally) return live.goalTally;
    const acc: Record<string, number> = {};
    for (const g of live.goals ?? []) {
      const id = tallyCreditFor(g);
      if (id) acc[id] = (acc[id] ?? 0) + 1;
    }
    return acc;
  };

  it('OLD shape: tally cleared but log kept → the badge comes back', () => {
    // Reproduces the reported behaviour, and the reason the fix needs both
    // halves: an EMPTY tally that the reader collapsed to undefined, plus a
    // stale log to derive from.
    expect(badgeFor({ goalTally: undefined, goals: [goal('u1'), goal('u1')] }))
      .toEqual({ u1: 2 });
  });

  it('NEW shape: both cleared → the badge stays empty', () => {
    expect(badgeFor({ goalTally: {}, goals: [] })).toEqual({});
  });

  it('an explicitly EMPTY tally wins over any log, and is not re-derived', () => {
    // The reader now preserves {} instead of collapsing it to undefined, so a
    // deliberate clear is distinguishable from a legacy live state.
    expect(badgeFor({ goalTally: {}, goals: [goal('u1')] })).toEqual({});
  });

  it('a LEGACY live state with no tally field still derives from the log', () => {
    expect(badgeFor({ goals: [goal('u1'), goal('guest:2')] }))
      .toEqual({ u1: 1, 'guest:2': 1 });
  });
});
