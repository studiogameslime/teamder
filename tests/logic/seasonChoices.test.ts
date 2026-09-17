// Which season a summary is FOR. A running season has no titles, no final
// table and no closing date, so the club card must offer the last one that
// ended — or nothing at all.

import { seasonChoices, lastClosedSeason } from '@/utils/seasonChoices';
import type { GroupSeasons } from '@/types';

const s = (over: Partial<GroupSeasons>): GroupSeasons =>
  ({ enabled: true, currentId: 's1', currentNo: 1, count: 0, ...over }) as GroupSeasons;

describe('lastClosedSeason', () => {
  it('is nothing while a club is still in its first season', () => {
    expect(lastClosedSeason(s({}))).toBeNull();
  });

  it('is the one that just ended, not the one being played', () => {
    const found = lastClosedSeason(s({ currentId: 's5', currentNo: 5, count: 4 }));
    expect(found).toEqual({ no: 4, id: 's4', closed: true });
  });

  it('survives a club that turned seasons off and on again', () => {
    // Numbering keeps going, so currentNo can run ahead of count + 1. The
    // running season must never come back as the closed one.
    const found = lastClosedSeason(s({ currentId: 's9', currentNo: 9, count: 3 }));
    expect(found).toEqual({ no: 3, id: 's3', closed: true });
  });

  it('is nothing when the club has no seasons block at all', () => {
    expect(lastClosedSeason(undefined)).toBeNull();
  });

  // Seasons switched off does NOT erase what was archived — the summaries and
  // titles stay readable.
  it('still answers for a club that switched seasons off', () => {
    const found = lastClosedSeason(s({ enabled: false, currentId: 's3', currentNo: 3, count: 2 }));
    expect(found).toEqual({ no: 2, id: 's2', closed: true });
  });
});

describe('seasonChoices', () => {
  it('lists the running season first, then the closed ones newest down', () => {
    expect(seasonChoices(s({ currentId: 's3', currentNo: 3, count: 2 }))).toEqual([
      { no: 3, id: 's3', closed: false },
      { no: 2, id: 's2', closed: true },
      { no: 1, id: 's1', closed: true },
    ]);
  });

  it('never spins on a bad count', () => {
    expect(seasonChoices(s({ count: 1e9 })).length).toBeLessThanOrEqual(201);
  });
});
