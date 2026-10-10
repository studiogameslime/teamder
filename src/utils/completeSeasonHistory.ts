/** Refuse an all-time total when any closed season is absent from the input. */
export function completeSeasonHistory<T>(expected: number, listed: number, archives: Array<T | null>): archives is T[] {
  return listed >= expected && archives.length === listed && archives.every((a) => a != null);
}
