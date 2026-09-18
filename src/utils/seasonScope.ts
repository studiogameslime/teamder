// Which season an evening belongs to.
//
// A game with NO stamp belongs to season 1. The stamp is only written when a
// game goes active (onGameRosterChanged), so every evening a club played
// before it switched seasons on carries nothing — and those evenings ARE
// season 1, because "your history becomes season 1" is what enabling the
// feature promises. Nineteen of the one real club's twenty-two are like that.
//
// It lived as a closure inside `gameService.getCommunityStats`, which is a
// module no test can load (it pulls in react-native through the auth layer).
// So the rule was "covered" by a copy of itself re-declared inside
// tests/logic/seasonScopedStats.test.ts: deleting the real rule would have
// left the suite green while the stats screen went back to showing a season
// the club's entire lifetime — the owner's original bug.
//
// The server's copy of this rule is `eveningInSeason` in
// functions/src/seasonCounters.ts. The two disagreed by nineteen evenings in
// production — the client counted unstamped games into season 1 and the server
// did not — so tests/logic/seasonCounterReconciliation.test.ts now runs them
// side by side over the same fixture.

/** The running season, as the club document holds it. */
export interface SeasonScope {
  currentId: string;
  currentNo: number;
}

export function inSeason(
  game: { seasonId?: string },
  /** Absent for a club that runs no seasons: then everything is in scope. */
  season?: SeasonScope,
): boolean {
  if (!season) return true;
  const stamp = typeof game.seasonId === 'string' ? game.seasonId : '';
  return stamp ? stamp === season.currentId : season.currentNo === 1;
}
