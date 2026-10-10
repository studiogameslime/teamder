/** Exact live-board identity, independent of mutable rotation timestamps. */
export function liveRoundKey(rotation: { round?: number; roundInstanceId?: string; updatedAt?: number }): string {
  return rotation.roundInstanceId ?? `${rotation.round ?? 'r'}:${rotation.updatedAt ?? 0}`;
}

/** New clients supply goal ids. Legacy callers retain the historical protocol. */
export function matchesLiveRound(
  game: { rotation?: Parameters<typeof liveRoundKey>[0]; liveMatch?: {
    goals?: { id?: string }[];
    shootout?: { kicks?: { kickerId?: string | null; keeperId?: string | null; scored?: boolean }[] };
  } },
  roundId: string | number | null | undefined,
  goalIds: unknown,
  snapshot?: { rotationUpdatedAt?: number | null; penalties?: unknown },
): boolean {
  if (!Array.isArray(goalIds)) return false;
  if (!game.rotation || String(roundId) !== liveRoundKey(game.rotation)) return false;
  const stored = (game.liveMatch?.goals ?? []).map(goal => goal.id);
  if (stored.length !== goalIds.length || !stored.every((id, index) => id === goalIds[index])) return false;
  if (snapshot) {
    if ((game.rotation.updatedAt ?? null) !== snapshot.rotationUpdatedAt) return false;
    const normalize = (kicks: { kickerId?: string | null; keeperId?: string | null; scored?: boolean }[]) =>
      kicks.map(kick => ({ kickerId: kick.kickerId || null, keeperId: kick.keeperId || null, scored: !!kick.scored }));
    if (!Array.isArray(snapshot.penalties) || JSON.stringify(normalize(game.liveMatch?.shootout?.kicks ?? [])) !==
        JSON.stringify(normalize(snapshot.penalties))) return false;
  }
  return true;
}
