/** Exact live-board identity, independent of mutable rotation timestamps. */
export function liveRoundKey(rotation: { round?: number; roundInstanceId?: string; updatedAt?: number }): string {
  return rotation.roundInstanceId ?? `${rotation.round ?? 'r'}:${rotation.updatedAt ?? 0}`;
}

/** Narrow roster identity, also computed by new clients before committing.
 * Some legacy roster edits do not advance rotation.updatedAt. This detects
 * their changed attribution without persisting another version field. */
export function liveLineupFingerprint(game: {
  rotation?: { playing?: readonly number[]; loans?: { playerId: string; homeTeam: number; filledTeam: number; swapId?: string }[] };
  draftTeams?: { teams?: { index: number; playerIds?: readonly string[]; colorKey?: string }[]; leftHome?: { playerId: string }[] };
}): string {
  return JSON.stringify({
    playing: game.rotation?.playing ?? [],
    teams: (game.draftTeams?.teams ?? []).map(team => [team.index, team.playerIds ?? [], team.colorKey ?? null]),
    leftHome: (game.draftTeams?.leftHome ?? []).map(entry => entry.playerId).sort(),
    loans: (game.rotation?.loans ?? []).map(loan => [loan.playerId, loan.homeTeam, loan.filledTeam, loan.swapId ?? null]),
  });
}

/** New clients supply goal ids. Legacy callers retain the historical protocol. */
export function matchesLiveRound(
  game: Parameters<typeof liveLineupFingerprint>[0] & { rotation?: Parameters<typeof liveRoundKey>[0]; liveMatch?: {
    goals?: { id?: string }[];
    shootout?: { kicks?: { kickerId?: string | null; keeperId?: string | null; scored?: boolean; outcome?: string }[] };
  } },
  roundId: string | number | null | undefined,
  goalIds: unknown,
  snapshot?: { rotationUpdatedAt?: number | null; penalties?: unknown; lineupFingerprint?: unknown },
): boolean {
  if (!Array.isArray(goalIds)) return false;
  if (!game.rotation || String(roundId) !== liveRoundKey(game.rotation)) return false;
  const stored = (game.liveMatch?.goals ?? []).map(goal => goal.id);
  if (stored.length !== goalIds.length || !stored.every((id, index) => id === goalIds[index])) return false;
  if (snapshot) {
    if ((game.rotation.updatedAt ?? null) !== snapshot.rotationUpdatedAt) return false;
    if (snapshot.lineupFingerprint !== undefined && snapshot.lineupFingerprint !== liveLineupFingerprint(game)) return false;
    const normalize = (kicks: { kickerId?: string | null; keeperId?: string | null; scored?: boolean; outcome?: string }[]) =>
      kicks.map(kick => ({ kickerId: kick.kickerId || null, keeperId: kick.keeperId || null, scored: !!kick.scored,
        ...(kick.outcome === 'goal' || kick.outcome === 'save' || kick.outcome === 'miss' ? { outcome: kick.outcome } : {}) }));
    if (!Array.isArray(snapshot.penalties) || JSON.stringify(normalize(game.liveMatch?.shootout?.kicks ?? [])) !==
        JSON.stringify(normalize(snapshot.penalties))) return false;
  }
  return true;
}
