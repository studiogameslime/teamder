// The adaptive matches tab: how full the screen is, and which availability
// slot the demand card offers to turn into a match.
//
// Both rules shipped in 1.0.90 and both had a real defect behind them — the
// slot ranking would happily offer a kickoff that had already passed, and the
// club section recommended one-person clubs. Pinned here.

import { GAMES_FEED_DEFAULTS, feedDensity } from '@/utils/feedDensity';
import { rankSlots, WINDOW_START_HOUR } from '@/utils/demandSlots';
import type { AvailabilityCounts } from '@/services/availabilityFeedService';

const HOUR = 60 * 60 * 1000;

/** Local midnight of the given day-offset, so "today" means today locally. */
function localMidnight(offsetDays = 0): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offsetDays);
  return d.getTime();
}

function counts(
  days: Array<{
    offset: number;
    morning?: number;
    noon?: number;
    evening?: number;
  }>,
): AvailabilityCounts {
  return {
    radiusKm: 25,
    hasLocation: true,
    viewerCity: 'תל אביב',
    days: days.map((d) => ({
      dateMs: localMidnight(d.offset),
      weekday: new Date(localMidnight(d.offset)).getDay() as never,
      isToday: d.offset === 0,
      windows: {
        morning: d.morning ?? 0,
        noon: d.noon ?? 0,
        evening: d.evening ?? 0,
      },
    })),
  };
}

describe('how full the matches tab is', () => {
  const { richMin } = GAMES_FEED_DEFAULTS;

  it('calls an empty screen empty', () => {
    expect(feedDensity(0, richMin)).toBe('none');
  });

  it('adds discovery only while the list is thin', () => {
    for (let n = 1; n < richMin; n++) {
      expect(feedDensity(n, richMin)).toBe('few');
    }
  });

  it('leaves a full tab alone', () => {
    expect(feedDensity(richMin, richMin)).toBe('many');
    expect(feedDensity(richMin + 10, richMin)).toBe('many');
  });

  it('never reports a negative count as anything but empty', () => {
    expect(feedDensity(-3, richMin)).toBe('none');
  });
});

describe('which availability slot the card offers', () => {
  it('ranks the busiest window first', () => {
    const ranked = rankSlots(
      counts([
        { offset: 1, morning: 2, evening: 9 },
        { offset: 2, evening: 4 },
      ]),
      localMidnight(0) + 9 * HOUR,
    );
    expect(ranked[0].count).toBe(9);
    expect(ranked[0].window).toBe('evening');
  });

  it('drops windows of TODAY that have already gone', () => {
    // The bug: the server counts the whole of today regardless of the clock,
    // so at 21:00 "12 free this morning" was still in the payload — and the
    // CTA would open the wizard on today 09:00, creating a match whose
    // kickoff is hours in the past.
    const at21 = localMidnight(0) + 21 * HOUR;
    const ranked = rankSlots(counts([{ offset: 0, morning: 12, evening: 3 }]), at21);
    expect(ranked.some((s) => s.isToday)).toBe(false);
  });

  it('cuts off at the hour the window PREFILLS, not when it ends', () => {
    // "evening" prefills 19:00 but runs to midnight. Filtering on the end of
    // the window left a 5-hour gap where the card offered to open a match at
    // 19:00 — already in the past.
    const at20 = localMidnight(0) + 20 * HOUR;
    const ranked = rankSlots(counts([{ offset: 0, evening: 9 }]), at20);
    expect(ranked.some((s) => s.isToday && s.window === 'evening')).toBe(false);

    // …and it's still on offer just before that hour.
    const at18 = localMidnight(0) + 18 * HOUR;
    const early = rankSlots(counts([{ offset: 0, evening: 9 }]), at18);
    expect(early.some((s) => s.isToday && s.window === 'evening')).toBe(true);
  });

  it('agrees with the hour the wizard will actually prefill', () => {
    // One shared constant; if the wizard's prefill and this cutoff ever drift
    // apart again, the card can offer a kickoff in the past.
    expect(WINDOW_START_HOUR).toEqual({ morning: 9, noon: 13, evening: 19 });
  });

  it('keeps today\'s window while it is still ahead', () => {
    // 08:00 — the 09:00 morning slot hasn't been reached yet, so it's a real
    // opportunity and must survive.
    const at8 = localMidnight(0) + 8 * HOUR;
    const ranked = rankSlots(counts([{ offset: 0, morning: 12 }]), at8);
    const morning = ranked.find((s) => s.isToday && s.window === 'morning');
    expect(morning?.count).toBe(12);
  });

  it('never filters a FUTURE day by the current hour', () => {
    // Only today's windows elapse. Tomorrow morning is still tomorrow morning
    // even when it's late tonight.
    const at23 = localMidnight(0) + 23 * HOUR;
    const ranked = rankSlots(counts([{ offset: 1, morning: 7 }]), at23);
    expect(ranked.find((s) => s.window === 'morning')?.count).toBe(7);
  });

  it('is stable — equal counts keep chronological order', () => {
    const ranked = rankSlots(
      counts([
        { offset: 3, evening: 5 },
        { offset: 1, evening: 5 },
      ]),
      localMidnight(0) + 9 * HOUR,
    );
    const evenings = ranked.filter((s) => s.window === 'evening' && s.count === 5);
    expect(evenings[0].dateMs).toBeLessThan(evenings[1].dateMs);
  });

  it('returns nothing to offer when every window of today has passed', () => {
    const at23 = localMidnight(0) + 23 * HOUR;
    expect(rankSlots(counts([{ offset: 0, morning: 9, noon: 9 }]), at23)).toEqual(
      [],
    );
  });
});
