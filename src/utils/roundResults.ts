// How a club's mini-games ended, split into three disjoint slices.
//
// Disjoint is a property of the WRITER, not an assumption made here:
// `commitRoundStats` increments `shootoutRounds` only when a `penalties[]`
// payload is present, and those commits carry a real `winnerSide` (the shootout
// winner) so they never also increment `tiedRounds`
// (functions/src/index.ts:14330-14337). "Decided in normal play" is therefore
// whatever is left over.

export interface RoundResultSplit {
  tie: number;
  shootout: number;
  regular: number;
}

/**
 * The three slices, clamped.
 *
 * The clamping is the part that can be wrong: the counters are three
 * independent Firestore increments and nothing guarantees they agree with
 * `totalRounds`. A stale total must shrink "regular" to zero, never produce a
 * negative slice — Svg renders a negative dash length as a FULL ring, so the
 * bug would read on screen as "100% decided in normal play".
 */
export function splitRoundResults(
  totalRounds: number,
  tiedRounds: number,
  shootoutRounds: number,
): RoundResultSplit {
  const total = Math.max(0, totalRounds);
  const tie = Math.max(0, Math.min(tiedRounds, total));
  const shootout = Math.max(0, Math.min(shootoutRounds, total - tie));
  const regular = Math.max(0, total - tie - shootout);
  return { tie, shootout, regular };
}
