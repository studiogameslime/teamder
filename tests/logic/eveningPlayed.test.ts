// "Did this evening take place?" — the whole decision table.
//
// This gate decides whether a מחזור is credited to the club's history: its
// attendance, its streaks, its player and club statistics, its round summary,
// and how far the season has moved. The crediting happens once and is never
// recomputed, so a wrong answer here is permanent in both directions — an
// invented evening inflates a club's record, and a missing one takes a night
// away from everyone who played it.
//
// The scenarios below are the specification, in the order it was written.
import {
  eveningPlayState,
  eveningPlayStateWithReason,
  didEveningHappen,
  needsPlayVerification,
  playEvidence,
  type PlayableEvening,
} from '@/utils/eveningPlayed';

/** A finished evening with nothing on it. Every case below adds to this. */
const closed = (over: Partial<PlayableEvening> = {}): PlayableEvening => ({
  status: 'finished',
  ...over,
});
/** The clock was started — the only evidence a REGULAR evening can produce. */
const timerRan = { liveMatch: { timerEvents: [{ type: 'start', at: 1 }] } };

describe('a regular evening', () => {
  it('1. timer started, admin ended it → happened', () => {
    expect(eveningPlayState(closed({ ...timerRan, endedBy: 'admin' }))).toBe(
      'happened',
    );
  });

  it('2. timer started, closed by the sweep → happened', () => {
    // The admin forgot to press end. The clock still ran, and that is the
    // evening: nobody has to remember a button for the night to have happened.
    expect(eveningPlayState(closed({ ...timerRan, endedBy: 'auto' }))).toBe(
      'happened',
    );
  });

  it('3. no timer, admin ended it → happened', () => {
    // The case that matters most for clubs who organise in the app and play
    // offline. Ending the evening is a statement, not a technical signal.
    const s = eveningPlayStateWithReason(closed({ endedBy: 'admin' }));
    expect(s.state).toBe('happened');
    expect(s.reason).toBe('manualCompletion');
  });

  it('4. no timer, closed by the sweep → unverified, not counted', () => {
    const g = closed({ endedBy: 'auto' });
    expect(eveningPlayState(g)).toBe('unverified');
    expect(didEveningHappen(g)).toBe(false);
    expect(needsPlayVerification(g)).toBe(true);
  });

  it('5. unverified → an admin confirms it happened', () => {
    const g = closed({ endedBy: 'auto', playVerified: true });
    expect(eveningPlayState(g)).toBe('happened');
    expect(eveningPlayStateWithReason(g).reason).toBe('adminVerified');
    expect(needsPlayVerification(g)).toBe(false);
  });

  it('6. unverified → an admin says it never happened', () => {
    const g = closed({ endedBy: 'auto', playVerified: false });
    expect(eveningPlayState(g)).toBe('notHappened');
    expect(didEveningHappen(g)).toBe(false);
    expect(needsPlayVerification(g)).toBe(false);
  });
});

describe('an advanced evening', () => {
  it('7. timer started, closed by the sweep → happened', () => {
    expect(
      eveningPlayState(
        closed({
          endedBy: 'auto',
          liveMatch: { startedAt: 1_700_000_000_000 },
        }),
      ),
    ).toBe('happened');
  });

  it('8. a goal with the clock never started, closed by the sweep → happened', () => {
    // The owner's case: after the line-up picker the clock resets to 00:00 and
    // stays paused, and goals are entered from there.
    const g = closed({
      endedBy: 'auto',
      liveMatch: { goals: [{ scorerId: 'u1' }], timerAccumulatedMs: 0 },
    });
    expect(eveningPlayState(g)).toBe('happened');
    expect(eveningPlayStateWithReason(g).reason).toBe('gameEvent');
  });

  it('9. a committed round with no timer, closed by the sweep → happened', () => {
    const g = closed({ endedBy: 'auto', committedRoundCount: 1 });
    expect(eveningPlayState(g)).toBe('happened');
    // Server-written, and the strongest signal there is.
    expect(eveningPlayStateWithReason(g).reason).toBe('result');
  });

  it('9b. a committed rotation with nothing else → happened', () => {
    expect(
      eveningPlayState(closed({ endedBy: 'auto', rotation: { round: 1 } })),
    ).toBe('happened');
  });

  it('10. no activity at all, admin ended it → happened', () => {
    expect(eveningPlayState(closed({ endedBy: 'admin' }))).toBe('happened');
  });

  it('11. no activity at all, closed by the sweep → unverified', () => {
    expect(eveningPlayState(closed({ endedBy: 'auto' }))).toBe('unverified');
  });

  it('12. several kinds of evidence at once still answer once', () => {
    const g = closed({
      endedBy: 'auto',
      liveMatch: {
        startedAt: 1,
        timerEvents: [{ type: 'start', at: 1 }],
        goals: [{ scorerId: 'u1' }],
      },
      rotation: { round: 2 },
      committedRoundCount: 3,
    });
    // One state, one reason — the answer is a verdict, not a tally, so nothing
    // downstream can count an evening twice for being well-documented.
    expect(eveningPlayState(g)).toBe('happened');
    expect(typeof eveningPlayStateWithReason(g).reason).toBe('string');
  });
});

describe('the states around it', () => {
  it('a cancelled evening never happened, whatever else is on it', () => {
    // An admin called it off. Evidence from a warm-up cannot undo that.
    expect(
      eveningPlayState({ status: 'cancelled', ...timerRan, endedBy: 'admin' }),
    ).toBe('notHappened');
  });

  it('an evening still to come, or under way, is pending', () => {
    expect(eveningPlayState({ status: 'open' })).toBe('pending');
    expect(eveningPlayState({ status: 'active', ...timerRan })).toBe('pending');
    expect(eveningPlayState({ status: 'scheduled' })).toBe('pending');
    // Pending is NOT "happened" — a live evening must not be credited early.
    expect(didEveningHappen({ status: 'active', ...timerRan })).toBe(false);
  });

  it('nothing at all is pending, not a crash', () => {
    expect(eveningPlayState(null)).toBe('pending');
    expect(eveningPlayState(undefined)).toBe('pending');
    expect(playEvidence(null)).toBeNull();
  });
});

describe('backward compatibility', () => {
  it('18. an evening closed before this existed still counts', () => {
    // No `endedBy` at all: closed by an older build. It counted yesterday and
    // it counts today — this is the whole reason no backfill is needed.
    const legacy = closed({});
    expect(eveningPlayState(legacy)).toBe('happened');
    expect(eveningPlayStateWithReason(legacy).reason).toBe('legacy');
  });

  it('a legacy evening WITH evidence reports the evidence, not the fallback', () => {
    expect(eveningPlayStateWithReason(closed(timerRan)).reason).toBe('timer');
  });

  it('a legacy cancelled evening is still not an evening', () => {
    expect(eveningPlayState({ status: 'cancelled' })).toBe('notHappened');
  });
});

describe('what does NOT count as evidence', () => {
  it('an empty live state is the absence of evidence, not evidence', () => {
    // A club that opened the live screen, built teams and went home.
    expect(
      eveningPlayState(
        closed({
          endedBy: 'auto',
          liveMatch: {
            phase: 'organizing',
            activeIntervals: [],
            timerEvents: [],
            timerAccumulatedMs: 0,
            timerLastStartedAt: null,
            startedAt: null,
            goals: [],
            scoreA: 0,
            scoreB: 0,
          },
          committedRoundCount: 0,
        }),
      ),
    ).toBe('unverified');
  });

  it('a non-array in a field it counts does not fool it', () => {
    expect(
      playEvidence(
        closed({
          liveMatch: {
            activeIntervals: 'yes',
            timerEvents: 3,
            goals: {},
          } as never,
        }),
      ),
    ).toBeNull();
  });

  it('there is no minimum duration — one press is enough', () => {
    // Product decision: no threshold, no debounce. A night that ran four
    // minutes is still a night.
    expect(
      eveningPlayState(
        closed({ endedBy: 'auto', liveMatch: { timerAccumulatedMs: 1 } }),
      ),
    ).toBe('happened');
  });
});

describe('concurrency and repetition', () => {
  it('13. a manual end racing the sweep keeps the admin’s answer', () => {
    // Both write `endedBy`. Whichever order they land in, an evening carrying
    // 'admin' is a statement and outranks the sweep's silence — and the sweep
    // re-reads the status inside a transaction so it cannot land second.
    expect(eveningPlayState(closed({ endedBy: 'admin' }))).toBe('happened');
    // And the reverse: a sweep-closed evening an admin later confirms.
    expect(
      eveningPlayState(closed({ endedBy: 'auto', playVerified: true })),
    ).toBe('happened');
  });

  it('14. asking twice gives the same answer', () => {
    // The function is pure, so repetition is free and idempotent by
    // construction. The crediting latch lives at the call site; this pins that
    // the ANSWER never drifts under a repeated read.
    const g = closed({ endedBy: 'auto', committedRoundCount: 2 });
    const first = eveningPlayState(g);
    expect(eveningPlayState(g)).toBe(first);
    expect(eveningPlayState({ ...g })).toBe(first);
  });

  it('15. an unverified evening is not counted as one that happened', () => {
    const g = closed({ endedBy: 'auto' });
    expect(didEveningHappen(g)).toBe(false);
    expect(eveningPlayState(g)).not.toBe('happened');
  });

  it('16. a late confirmation flips the same answer every consumer reads', () => {
    // There is only one answer, so confirming an evening cannot update some
    // surfaces and miss others — which is precisely what used to happen when
    // the client and the server each had their own rule.
    const before = closed({ endedBy: 'auto' });
    const after = { ...before, playVerified: true };
    expect(didEveningHappen(before)).toBe(false);
    expect(didEveningHappen(after)).toBe(true);
  });

  it('17. "did not happen" produces no evidence and no attendance', () => {
    const g = closed({ endedBy: 'auto', playVerified: false, ...timerRan });
    // Even with a timer trace, the admin's "no" wins: they were there.
    expect(eveningPlayState(g)).toBe('notHappened');
    expect(didEveningHappen(g)).toBe(false);
  });
});
