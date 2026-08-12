// demandSlots — ranking the "who's free near you" grid into an actionable slot.
//
// Pulled out of AreaDemandCard so the elapsed-window rule (the one that stopped
// the card offering to open a match whose kickoff had already passed) is unit
// tested rather than trusted.

import type { TimeBucket } from '@/types';
import type { AvailabilityCounts } from '@/services/availabilityFeedService';

/** One (day, window) cell with its available-player count. */
export interface DemandSlot {
  dateMs: number;
  weekday: number;
  isToday: boolean;
  window: TimeBucket;
  count: number;
}

/** Time windows, in the same order the availability feed reports them. */
const TIME_WINDOWS: TimeBucket[] = ['morning', 'noon', 'evening'];

/**
 * The kickoff hour each window prefills in the create-match wizard.
 *
 * SINGLE SOURCE OF TRUTH — GameCreateScreen imports this. It used to keep its
 * own copy while the card filtered on the window's END hour instead, so
 * between 19:00 and midnight the card still offered "open a match this
 * evening" and the wizard dutifully prefilled 19:00, in the past.
 */
export const WINDOW_START_HOUR: Record<TimeBucket, number> = {
  morning: 9,
  noon: 13,
  evening: 19,
};

/**
 * Flatten the week into slots, hottest first. Stable: equal counts keep
 * chronological order, so the card doesn't reshuffle between renders.
 *
 * TODAY'S ELAPSED WINDOWS ARE DROPPED. The server counts availability for the
 * whole of today regardless of the clock, so at 21:00 "12 free this morning"
 * is still in the payload — and the CTA would have opened the match wizard on
 * today 09:00, creating a match whose kickoff is hours in the past (the wizard
 * has no future-kickoff guard). A window you can no longer play in isn't an
 * opportunity.
 */
export function rankSlots(data: AvailabilityCounts, now: number): DemandSlot[] {
  const nowHour = new Date(now).getHours();
  const slots: DemandSlot[] = [];
  data.days.forEach((day) => {
    TIME_WINDOWS.forEach((window) => {
      if (day.isToday && nowHour >= WINDOW_START_HOUR[window]) return;
      slots.push({
        dateMs: day.dateMs,
        weekday: day.weekday,
        isToday: day.isToday,
        window,
        count: day.windows[window] ?? 0,
      });
    });
  });
  return slots.sort((a, b) => b.count - a.count || a.dateMs - b.dateMs);
}

