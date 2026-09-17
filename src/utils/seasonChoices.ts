// Which seasons a club has, derived from the club document alone.
//
// Pure, and in utils rather than beside the reader that used it, because two
// surfaces need the same answer without paying for it twice: the summary
// screen's picker, and the club card deciding whether there is a FINISHED
// season to offer at all. A card that had to query for that would spend a read
// per club view to render one button.

import type { GroupSeasons } from '@/types';

export interface SeasonChoice {
  no: number;
  id: string;
  closed: boolean;
}

/** Guards the loop below. A picker nobody scrolls a dozen entries of is not
 *  worth a phone spinning on a bad `count`. */
const MAX_SEASON_CHOICES = 200;

/** Newest first: the running season, then every closed one down to 1. */
export function seasonChoices(seasons: GroupSeasons): SeasonChoice[] {
  const out: SeasonChoice[] = [
    { no: seasons.currentNo, id: seasons.currentId, closed: false },
  ];
  // Never size a loop from a number in a document. `count` is server-written
  // and the rules now stop a club being created with one, but the cost of
  // being wrong here is a frozen screen.
  const closed = Math.max(0, Math.min(MAX_SEASON_CHOICES, seasons.count ?? 0));
  for (let no = closed; no >= 1; no -= 1) {
    // A club that enabled, disabled and re-enabled keeps numbering, so the
    // current season's number can be higher than count + 1. Skip anything that
    // would duplicate the running one.
    if (no === seasons.currentNo) continue;
    out.push({ no, id: `s${no}`, closed: true });
  }
  return out;
}

/**
 * The most recent season that actually ENDED, or null while a club is still in
 * its first.
 *
 * This is the one a summary is for. A season still being played has no titles,
 * no final table and no closing date — offering "my season summary" for it
 * shows a half-written page and teaches people the summary is unreliable.
 */
export function lastClosedSeason(seasons?: GroupSeasons): SeasonChoice | null {
  if (!seasons?.enabled && !(seasons?.count ?? 0)) return null;
  if (!seasons) return null;
  return seasonChoices(seasons).find((c) => c.closed) ?? null;
}
