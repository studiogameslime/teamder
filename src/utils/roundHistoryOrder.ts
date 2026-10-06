// The order mini-games are shown in — one rule, in one place.
//
// "משחק 1, משחק 2, משחק 3" is the order they were played in, and it is the
// same on the finished-evening recap and on the list opened mid-evening from
// the live screen. Newest-first would renumber the whole list every time a
// round ends, which is exactly the moment someone is looking at it.
//
// Extracted from `gameService.getRoundHistory` so the rule can be tested
// without Firestore. The service imports it; nothing else decides this.

export interface OrderableRound {
  /** Commit time. 0 / missing on legacy docs. */
  at: number;
  /** The round's own number, as a string on the document. */
  roundId: string;
}

/**
 * Chronological: mini-game 1 → N.
 *
 * `at` is the commit timestamp and is the primary key. Two rounds committed
 * in the same millisecond — or a legacy document with no timestamp at all —
 * fall back to the numeric round id, which is the only other thing that
 * carries the order. A non-numeric id compares as NaN and leaves the pair in
 * their existing relative order rather than throwing them to one end.
 */
export function compareRounds(a: OrderableRound, b: OrderableRound): number {
  const byTime = (a.at ?? 0) - (b.at ?? 0);
  if (byTime !== 0) return byTime;
  const na = Number(a.roundId);
  const nb = Number(b.roundId);
  if (Number.isNaN(na) || Number.isNaN(nb)) return 0;
  return na - nb;
}

/** `compareRounds`, applied. Returns a new array; never mutates the input. */
export function sortRounds<T extends OrderableRound>(rounds: readonly T[]): T[] {
  return [...rounds].sort(compareRounds);
}
