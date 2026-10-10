/** undefined = still loading; null = resolved without a club cover. */
export type RoundCover = { coverPhotoUrl?: string; coverImageId?: string };
export interface RoundCoverCache {
  ownerId: string | null;
  covers: Record<string, RoundCover | null>;
}

export function resolveRoundCover(
  groupId: string | undefined,
  memberClubs: ReadonlyArray<RoundCover & { id: string }>,
  cache: RoundCoverCache,
  ownerId: string | null,
): RoundCover | null | undefined {
  if (!groupId) return null;
  const member = memberClubs.find(club => club.id === groupId);
  if (member) return member;
  return cache.ownerId === ownerId ? cache.covers[groupId] : undefined;
}

export function mergeRoundCovers(
  previous: RoundCoverCache,
  ownerId: string,
  ids: readonly string[],
  results: readonly PromiseSettledResult<RoundCover | null>[],
): RoundCoverCache {
  const covers = previous.ownerId === ownerId ? { ...previous.covers } : {};
  results.forEach((result, i) => {
    if (result.status === 'fulfilled') covers[ids[i]] = result.value;
    // A temporary fetch failure must not replace an already known cover.
    else if (!(ids[i] in covers)) covers[ids[i]] = null;
  });
  return { ownerId, covers };
}
