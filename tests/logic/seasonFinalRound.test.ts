// "Last evening of the season" and "how long until it closes" — the two
// questions three surfaces ask (the club card, the game screen, the
// countdown), answered in one place so they cannot disagree.

import {
  roundsLeftInSeason,
  isFinalRoundOfSeason,
  msUntilSeasonCloses,
  formatCloseCountdown,
} from '@/utils/seasonFinalRound';
import type { GroupSeasons } from '@/types';

const rounds = (target: number, played: number, extra: Partial<GroupSeasons> = {}) =>
  ({
    enabled: true,
    currentNo: 2,
    currentId: 's2',
    startedAt: 1,
    playedRounds: played,
    cadence: { type: 'rounds', targetRounds: target },
    ...extra,
  }) as GroupSeasons;

describe('how many evenings are left', () => {
  it('counts down to the target', () => {
    expect(roundsLeftInSeason(rounds(5, 0))).toBe(5);
    expect(roundsLeftInSeason(rounds(5, 4))).toBe(1);
    expect(roundsLeftInSeason(rounds(5, 5))).toBe(0);
  });

  it('never goes negative — a season can overshoot its target', () => {
    expect(roundsLeftInSeason(rounds(5, 9))).toBe(0);
  });

  it('is null for a season measured in TIME, not evenings', () => {
    const byDate = { ...rounds(5, 1), cadence: { type: 'date', endsAt: 1 } } as GroupSeasons;
    expect(roundsLeftInSeason(byDate)).toBeNull();
    // Null and not 0: 0 means "this is the last one", and a date season has
    // no evening count to be last of.
    expect(isFinalRoundOfSeason(byDate)).toBe(false);
  });

  it('is null when seasons are off, or absent', () => {
    expect(roundsLeftInSeason(undefined)).toBeNull();
    expect(roundsLeftInSeason(rounds(5, 4, { enabled: false }))).toBeNull();
  });
});

describe('the final round is exactly one left', () => {
  it('fires on one, and on nothing else', () => {
    expect(isFinalRoundOfSeason(rounds(5, 4))).toBe(true);
    expect(isFinalRoundOfSeason(rounds(5, 3))).toBe(false);
  });

  it('does NOT fire at zero — that season is already in the window', () => {
    // At zero the right message is the countdown, not "give it everything".
    expect(isFinalRoundOfSeason(rounds(5, 5))).toBe(false);
  });
});

describe('the closing countdown', () => {
  const NOW = 1_000_000;
  const withWindow = (closeAt: number, seasonId = 's2') =>
    rounds(5, 5, { pendingClose: { seasonId, closeAt } });

  it('is null when the season is not in a correction window', () => {
    expect(msUntilSeasonCloses(rounds(5, 5), NOW)).toBeNull();
  });

  it('counts the time left', () => {
    expect(msUntilSeasonCloses(withWindow(NOW + 3_600_000), NOW)).toBe(3_600_000);
  });

  it('clamps at zero rather than going negative', () => {
    // The window can expire minutes before the sweep that acts on it runs.
    expect(msUntilSeasonCloses(withWindow(NOW - 60_000), NOW)).toBe(0);
  });

  it('ignores a window left behind by a season that has since been replaced', () => {
    expect(msUntilSeasonCloses(withWindow(NOW + 5_000, 's1'), NOW)).toBeNull();
  });

  it('formats as h:mm:ss, hours uncapped', () => {
    expect(formatCloseCountdown(0)).toBe('0:00:00');
    expect(formatCloseCountdown(59_000)).toBe('0:00:59');
    expect(formatCloseCountdown(3_600_000)).toBe('1:00:00');
    expect(formatCloseCountdown(24 * 3_600_000 - 1000)).toBe('23:59:59');
    expect(formatCloseCountdown(-5)).toBe('0:00:00');
  });
});
