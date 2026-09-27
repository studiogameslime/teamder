// Club records that belong to a single EVENING — the most goals, the most
// shootout-decided mini-games, the longest night.
//
// Each one names the evening it was set in, because that is what makes it a
// record rather than a statistic: "47 goals" is a number, "47 goals, evening
// 28" is a record you can go and look at.
//
// ── Where the numbers come from ───────────────────────────────────────────
//
// `roundSummaries/{gameId}` — one document per sealed evening, carrying
// `stats: { goals, rounds, shootouts, assists }`, the club id and the
// evening's timestamp. It is readable by club members
// (`allow read: if isGroupMember(resource.data.groupId)`), which is why these
// records need no new collection, no rules change and no backfill: the
// documents that already exist ARE the history.
//
// ── What `shootouts` actually counts ──────────────────────────────────────
//
// Mini-games DECIDED by a shootout — `input.rounds.filter(r => r.shootout)`.
// Not penalty kicks, not penalties scored. Those live per-player and
// cumulatively in `communityPlayerStats.penTaken/penScored` and cannot be
// split back to an evening, so a "most penalties in an evening" record is not
// available and must not be implied by the copy.
//
// ── Coverage ──────────────────────────────────────────────────────────────
//
// The summary layer began partway through the product's life: on production
// today there are 25 summaries against 100 finished evenings. These are
// therefore the best of the MEASURED period, never "of all time", and the
// section says so once above the cards.

/** One evening's summary, reduced to what a record needs. */
export interface EveningStat {
  gameId: string;
  /** When the evening was played — the season filter works on this. */
  at: number;
  goals: number;
  rounds: number;
  shootouts: number;
  /**
   * False for an evening replayed from before the summary feature existed.
   * Such a document reports zeros for everything, which is not the same as an
   * evening where nothing happened, so it is excluded rather than counted.
   */
  hasRoundHistory: boolean;
}

export type EveningRecordKey = 'goals' | 'shootouts' | 'rounds';

export interface EveningRecord {
  key: EveningRecordKey;
  value: number;
  /**
   * The evening the card names and navigates to. On a tie this is the FIRST
   * evening that reached the value, chronologically — see `holders`.
   */
  gameId: string;
  at: number;
  /**
   * Every evening tied at the top, oldest first. Mirrors the convention
   * `nextRecordBaseline` already uses for player records, where a tie keeps
   * all holders rather than picking one; the card shows the first and the
   * count, and the tap follows the evening the card names.
   */
  holders: string[];
}

const METRIC: Record<EveningRecordKey, (e: EveningStat) => number> = {
  goals: (e) => e.goals,
  shootouts: (e) => e.shootouts,
  rounds: (e) => e.rounds,
};

/**
 * The best evening for one metric, or null when nothing qualifies.
 *
 * Deterministic in every respect: the maximum is exact, and a tie resolves to
 * the OLDEST evening — the one that set the record first, which is the only
 * tie-break that does not change as new evenings arrive. Picking the newest
 * would move the card's target every time the record was equalled.
 */
export function bestEvening(
  evenings: EveningStat[],
  key: EveningRecordKey,
): EveningRecord | null {
  const usable = evenings.filter((e) => e.hasRoundHistory && METRIC[key](e) > 0);
  if (!usable.length) return null;
  const top = usable.reduce((m, e) => Math.max(m, METRIC[key](e)), 0);
  const tied = usable
    .filter((e) => METRIC[key](e) === top)
    // Oldest first, then by id so two evenings stamped the same millisecond
    // still order the same way on every device.
    .sort((a, b) => a.at - b.at || a.gameId.localeCompare(b.gameId));
  return {
    key,
    value: top,
    gameId: tied[0].gameId,
    at: tied[0].at,
    holders: tied.map((e) => e.gameId),
  };
}

/**
 * All three evening records for a set of evenings.
 *
 * The caller decides the set: every summary the club has for "כל הזמנים", or
 * only those inside a season's window for a season. Nothing here knows about
 * seasons, which is what keeps the season-scoped record honest — it is the
 * best of that season, computed from that season's evenings and nothing else.
 */
export function eveningRecordsOf(
  evenings: EveningStat[],
): Record<EveningRecordKey, EveningRecord | null> {
  return {
    goals: bestEvening(evenings, 'goals'),
    shootouts: bestEvening(evenings, 'shootouts'),
    rounds: bestEvening(evenings, 'rounds'),
  };
}
