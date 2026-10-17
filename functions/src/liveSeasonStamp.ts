import { playEvidence, type PlayableEvening } from './eveningPlayed';

interface ClubPeriod {
  seasons?: {
    enabled?: boolean;
    currentId?: string;
    startedAt?: number;
    count?: number;
    disabledAt?: number;
    operation?: unknown;
    pendingClose?: unknown;
  };
}

/** A timerless live board needs a stamp too. Never reinterpret old evenings.
 * documentCreatedAt is Firestore's createTime, never the phone's createdAt. */
export function liveSeasonStamp(
  club: ClubPeriod | undefined,
  game: PlayableEvening & { seasonId?: unknown },
  documentCreatedAt: number | undefined,
): string | undefined {
  if (game.seasonId != null && game.seasonId !== '') return undefined;
  if (!['open', 'locked', 'active'].includes(game.status ?? '') || !playEvidence(game)) return undefined;
  const seasons = club?.seasons;
  if (!seasons || seasons.operation || seasons.pendingClose) return undefined;
  const boundary = seasons.enabled ? seasons.startedAt : seasons.disabledAt;
  if (typeof boundary !== 'number' || !Number.isFinite(boundary) || boundary <= 0 ||
      typeof documentCreatedAt !== 'number' || !Number.isFinite(documentCreatedAt) || documentCreatedAt < boundary) return undefined;
  if (seasons.enabled) return seasons.currentId || undefined;
  return (seasons.count ?? 0) > 0 ? `off_${seasons.count}_${seasons.disabledAt}` : undefined;
}
