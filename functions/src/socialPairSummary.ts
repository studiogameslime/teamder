/** Global lifetime totals, oriented to the viewer. Sparse increments mean zero;
 * missing pair data after shared play means unrecorded, rather than zero. */
export function socialPairSummary(viewer: string, other: string, pair: Record<string, unknown> | undefined, dates: number[]) {
  const read = (key: string): number | null => {
    const value = pair?.[key] ?? 0;
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
  };
  const results = (totalKey: string, winKey: string, lossKey: string) => {
    if (!pair && dates.length) return null;
    const games = read(totalKey), wins = read(winKey), losses = read(lossKey);
    return games !== null && wins !== null && losses !== null && wins + losses <= games
      ? { games, wins, losses, ties: games - wins - losses } : null;
  };
  const first = viewer < other;
  const to = read(first ? 'assistsAToB' : 'assistsBToA'), from = read(first ? 'assistsBToA' : 'assistsAToB');
  return { sharedRounds: dates.length, sameTeam: results('sameTeam', 'winsTogether', 'lossesTogether'),
    against: results('against', first ? 'winsA' : 'winsB', first ? 'winsB' : 'winsA'),
    assists: (!pair && dates.length) || to === null || from === null ? null : { toOther: to, fromOther: from },
    lastSharedRoundAt: dates.length ? Math.max(...dates) : null };
}
