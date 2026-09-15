// What counts as evidence that an evening was played.
//
// This gate decides whether a finished game is sealed into the club's history:
// its round summary, its contribution to the season, its titles. The seal
// happens once and is never recomputed, so a false negative is permanent — the
// night simply never happened as far as the club is concerned.
//
// It used to rest on one client write (`liveMatch.startedAt`) plus the phase
// values written by that SAME update — two checks that could only ever be
// present or absent together. These tests pin the evidence list that replaced
// it, and in particular the two cases the owner raised: goals entered with the
// clock sitting at 00:00, and starting the clock being a statistic of its own.
import { wasActuallyPlayed } from '../../functions/src/wasPlayed';

describe('wasActuallyPlayed', () => {
  it('credits the kickoff stamp', () => {
    expect(
      wasActuallyPlayed({ liveMatch: { startedAt: 1_700_000_000_000 } }),
    ).toBe(true);
  });

  it('credits the phases that stamp wrote, for games that predate the rest', () => {
    expect(wasActuallyPlayed({ liveMatch: { phase: 'roundRunning' } })).toBe(
      true,
    );
    expect(wasActuallyPlayed({ liveMatch: { phase: 'roundEnded' } })).toBe(
      true,
    );
    expect(wasActuallyPlayed({ liveMatch: { phase: 'live' } })).toBe(true);
  });

  it('credits an evening whose clock actually ran', () => {
    // Starting the clock is a statistic in its own right — these windows are
    // what the physical (Health Connect) read is scoped to.
    expect(
      wasActuallyPlayed({
        liveMatch: {
          activeIntervals: [{ s: 1_700_000_000_000, e: 1_700_000_600_000 }],
        },
      }),
    ).toBe(true);
  });

  it('credits a timer press even with no window closed behind it', () => {
    expect(
      wasActuallyPlayed({
        liveMatch: { timerEvents: [{ type: 'start', at: 1 }] },
      }),
    ).toBe(true);
    expect(wasActuallyPlayed({ liveMatch: { timerAccumulatedMs: 1 } })).toBe(
      true,
    );
    expect(wasActuallyPlayed({ liveMatch: { timerLastStartedAt: 1 } })).toBe(
      true,
    );
  });

  it('credits a committed rotation — goals with the clock never started', () => {
    // The owner's case: after the line-up picker the clock is reset to 00:00
    // and left PAUSED, and goals are entered from there. Nothing about the
    // timer is set, but a rotation exists and the scoreboard only opens once
    // it does.
    expect(
      wasActuallyPlayed({
        rotation: { round: 1, playing: [0, 1] },
        liveMatch: {
          timerRunning: false,
          timerAccumulatedMs: 0,
          timerEvents: [],
        },
      } as Parameters<typeof wasActuallyPlayed>[0]),
    ).toBe(true);
  });

  it('refuses a game that was created and forgotten', () => {
    expect(wasActuallyPlayed({})).toBe(false);
    expect(wasActuallyPlayed({ liveMatch: null })).toBe(false);
    expect(wasActuallyPlayed(null)).toBe(false);
    expect(wasActuallyPlayed(undefined)).toBe(false);
  });

  it('refuses an organising game whose live state exists but is untouched', () => {
    // A club that opened the live screen, built teams, and went home. Empty
    // arrays and zeroes are the absence of evidence, not evidence.
    expect(
      wasActuallyPlayed({
        liveMatch: {
          phase: 'organizing',
          activeIntervals: [],
          timerEvents: [],
          timerAccumulatedMs: 0,
          timerLastStartedAt: null,
          startedAt: null,
        },
      }),
    ).toBe(false);
  });

  it('is not fooled by a non-array in a field it counts', () => {
    expect(
      wasActuallyPlayed({
        liveMatch: { activeIntervals: 'yes', timerEvents: 3 } as never,
      }),
    ).toBe(false);
  });
});
