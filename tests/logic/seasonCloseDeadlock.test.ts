// The deadlock a club actually stood in, 22.09.2026.
//
//   season 2 reached its target → 24-hour correction window opened
//   they opened next week's evening; SEVEN people registered for it
//   entering live and pressing start → "close the season first" (correct)
//   closing the season → "there is an open evening" (the deadlock)
//
// The only way out was to delete an evening people had joined, close the
// season, and rebuild it.
//
// The guard exists to stop a close SPLITTING an evening: mini-games commit one
// at a time, so rounds 1–3 would land in the old season and 4–6 in the new.
// That hazard needs an evening in PLAY. An evening that is scheduled, open or
// locked has committed nothing — and carries no `seasonId` at all, because the
// stamp is written when a game goes ACTIVE, not when it is created. It belongs
// to whichever season is open when someone presses start, which is exactly the
// next one.
//
// Read from production while the club was stuck: the blocking game was
// `status: 'open'`, `seasonId` ABSENT, timer never started, 7 players.

import { canCloseNow, isSeasonDue } from '@/utils/seasonLifecycle';
import type { SeasonState } from '@/utils/seasonLifecycle';

const atTarget = (over: Partial<SeasonState> = {}): SeasonState => ({
  cadence: { type: 'rounds', targetRounds: 5 },
  completedRounds: 5,
  hasOpenGame: false,
  hasUnsealedGame: false,
  ...over,
});

describe('a season that has met its target', () => {
  it('is due', () => {
    expect(isSeasonDue(atTarget(), Date.now())).toBe(true);
  });

  it('CLOSES while next week\'s evening sits open and unstarted', () => {
    // `hasOpenGame` now means "an evening is being played", and next week's is
    // not. This assertion is the deadlock, inverted.
    expect(canCloseNow(atTarget())).toEqual({ ok: true });
  });

  it('still refuses while an evening is actually in play', () => {
    // The real hazard, untouched: closing here puts half tonight's mini-games
    // in one season and half in the next.
    expect(canCloseNow(atTarget({ hasOpenGame: true }))).toEqual({
      ok: false,
      blocker: 'openGame',
    });
  });

  it('still refuses while an evening is finished but unsealed', () => {
    expect(canCloseNow(atTarget({ hasUnsealedGame: true }))).toEqual({
      ok: false,
      blocker: 'unsealedGame',
    });
  });

  it('reports the IN-PLAY blocker first when both are true', () => {
    // Order matters for the message the admin reads: "wait for the whistle" is
    // actionable, "wait for the stats to seal" is a few seconds they cannot
    // influence.
    expect(canCloseNow(atTarget({ hasOpenGame: true, hasUnsealedGame: true })))
      .toEqual({ ok: false, blocker: 'openGame' });
  });
});
