/**
 * The hourly sweep decides, unattended, to destroy a club's table.
 *
 * `runSeasonRollovers` runs every sixty minutes over every club with seasons
 * on. When it decides a season is due it wipes the club's counters, seals an
 * archive that cannot be rewritten, awards nine titles onto players' profiles
 * and pushes every participant. Nothing tested it — not the sweep, not
 * `clubIsQuiet`, not `performSeasonClose`, not `closeSeasonIfRoundsTargetMet`.
 * Their names appeared in this suite only inside comments.
 *
 * The scan itself needs Firestore. The DECISION does not, and it is where the
 * shipped bugs were: a rounds cadence read through a date branch, a season
 * with no finish line skipped in silence, and the seal and the sweep each
 * classifying the same cadence for themselves — which is how one path came to
 * close a season at a number the other had never heard of. So the finish line
 * and the due test are pure functions now (functions/src/seasonCounters.ts),
 * and both callers ask them rather than deciding for themselves.
 *
 * Still uncovered, and not pretendable without an emulator: the paging cursor,
 * the per-run close ceiling, the `dueBlockedSince` stamp, the identity re-read
 * inside performSeasonClose, and clubIsQuiet's blockers.
 */
import {
  isSeasonDue,
  seasonFinishLine,
  type SeasonFinishLine,
} from '../../functions/src/seasonCounters';
import { CLUB_SEASON_1 } from '../fixtures/realClub';

/** Any day; only the rounds branch is being asked. */
const TODAY = '2026-09-18';
const NOW = 1_789_500_000_000;

describe('what ends a season', () => {
  it('a rounds cadence is a rounds line', () => {
    expect(seasonFinishLine({ type: 'rounds', targetRounds: 24 })).toEqual({
      kind: 'rounds',
      target: 24,
    });
  });

  it('a rounds cadence is NEVER read through its leftover date fields', () => {
    // The seasons block is written with merge:true and a merge into a nested
    // map merges field by field, so a club that tried a date cadence and
    // switched back still carries `months` and a stale `endsAt`. Falling
    // through to them would close a rounds season on a date nobody chose.
    expect(
      seasonFinishLine({
        type: 'rounds',
        targetRounds: 24,
        endsAt: 1,
        endsOn: '2020-01-01',
      } as never),
    ).toEqual({ kind: 'rounds', target: 24 });
  });

  it('a date cadence prefers the calendar day over the epoch', () => {
    // The epoch stays for backward compatibility; the calendar date is what
    // makes the rollover land on the club's midnight rather than on UTC's.
    expect(
      seasonFinishLine({ type: 'date', endsOn: '2026-12-31', endsAt: 1 } as never),
    ).toEqual({ kind: 'date', endsOn: '2026-12-31' });
  });

  it('a season opened before calendar boundaries keeps its epoch', () => {
    expect(seasonFinishLine({ type: 'date', endsAt: NOW })).toEqual({
      kind: 'epoch',
      endsAt: NOW,
    });
  });

  it('a rounds cadence with no target has NO finish line', () => {
    // It cannot end, ever. The branch this replaces was a bare `continue` —
    // the only one in the sweep that produced no output at all, so a club
    // stuck in a season that would never close looked exactly like a club that
    // simply was not due yet.
    for (const target of [undefined, null, 0, -3]) {
      expect(seasonFinishLine({ type: 'rounds', targetRounds: target } as never)).toEqual(
        { kind: 'none', cadence: 'rounds' },
      );
    }
  });

  it('and neither does a cadence that is neither kind', () => {
    expect(seasonFinishLine({})).toEqual({ kind: 'none', cadence: '(none)' });
    expect(seasonFinishLine({ type: 'date' })).toEqual({
      kind: 'none',
      cadence: 'date',
    });
    expect(seasonFinishLine({ type: 'date', endsAt: 0 })).toEqual({
      kind: 'none',
      cadence: 'date',
    });
    // A string that is not a calendar date is not a date. Closing on
    // something nobody can parse is worse than reporting that the season
    // cannot close. The check is SHAPE only — yyyy-mm-dd, which '2026-13-40'
    // satisfies — so this pins the shape, not the calendar.
    for (const endsOn of ['2026-9-18', '18/09/2026', 'בקרוב', '', 20260918]) {
      expect(seasonFinishLine({ type: 'date', endsOn } as never)).toEqual({
        kind: 'none',
        cadence: 'date',
      });
    }
  });
});

describe('whether the sweep closes it', () => {
  const at = (over: Partial<{ played: number; now: number; today: string }> = {}) => ({
    played: 0,
    now: NOW,
    today: TODAY,
    ...over,
  });

  it('closes a rounds season on the evening that meets the target', () => {
    const line = seasonFinishLine({ type: 'rounds', targetRounds: 22 });
    expect(isSeasonDue(line, at({ played: 21 }))).toBe(false);
    expect(isSeasonDue(line, at({ played: 22 }))).toBe(true);
    // Past it too: a season that was blocked when it came due is still due.
    expect(isSeasonDue(line, at({ played: 40 }))).toBe(true);
  });

  it('measures it on the number the club is shown', () => {
    // The real club stood at 22 with a counter that had only ever seen 10.
    // Closing on `eveningsSealed - roundsAtStart` — which is 3 — is how a
    // 22-evening season came to be archived as three.
    const line = seasonFinishLine({ type: 'rounds', targetRounds: 22 });
    expect(isSeasonDue(line, at({ played: CLUB_SEASON_1.playedRounds }))).toBe(true);
    expect(isSeasonDue(line, at({ played: CLUB_SEASON_1.counterSubtraction }))).toBe(
      false,
    );
  });

  it('a date season runs through the END of its last day', () => {
    const line = seasonFinishLine({ type: 'date', endsOn: '2026-09-18' } as never);
    expect(isSeasonDue(line, at({ today: '2026-09-18' }))).toBe(false);
    expect(isSeasonDue(line, at({ today: '2026-09-19' }))).toBe(true);
    expect(isSeasonDue(line, at({ today: '2026-09-17' }))).toBe(false);
  });

  it('an epoch season closes on the instant it was given', () => {
    const line = seasonFinishLine({ type: 'date', endsAt: NOW });
    expect(isSeasonDue(line, at({ now: NOW - 1 }))).toBe(false);
    expect(isSeasonDue(line, at({ now: NOW }))).toBe(true);
  });

  it('a season with no finish line is never due', () => {
    // And the caller reports it rather than skipping: this is the state 24 of
    // 30 real clubs can end up in through a different door, and silence is
    // what made it survive.
    const none: SeasonFinishLine = { kind: 'none', cadence: 'rounds' };
    expect(isSeasonDue(none, at({ played: 9_999, now: NOW + 1e12 }))).toBe(false);
  });

  it('a date season is never decided on an evening count', () => {
    // The two are not interchangeable, and a date club that has played nothing
    // must not be held open — or closed — by a number nobody consulted. This
    // is also why the caller may pass played: 0 for a date line and pay for no
    // read at all.
    const line = seasonFinishLine({ type: 'date', endsOn: '2026-01-01' } as never);
    expect(isSeasonDue(line, at({ played: 0 }))).toBe(true);
    expect(isSeasonDue(line, at({ played: 500 }))).toBe(true);
  });
});
