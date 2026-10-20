import { todayIn } from './seasonDates';
import { playEvidence, type PlayableEvening } from './eveningPlayed';

interface ClubPeriod {
  seasons?: {
    policyVersion?: number;
    playedRounds?: number;
    cadence?: { type?: string; endsOn?: string };
    enabled?: boolean;
    currentId?: string;
    startedAt?: number;
    count?: number;
    disabledAt?: number;
    operation?: unknown;
    pendingClose?: { dueAt?: number; closeAt?: number };
  };
}

/** A timerless live board needs a stamp too. Never reinterpret old evenings.
 * documentCreatedAt is Firestore's createTime, never the phone's createdAt. */
export function liveSeasonStamp(
  club: ClubPeriod | undefined,
  game: PlayableEvening & { seasonId?: unknown; startsAt?: unknown },
  documentCreatedAt: number | undefined,
): string | undefined {
  if (game.seasonId != null && game.seasonId !== '') return undefined;
  const seasons = club?.seasons;
  if (seasons?.policyVersion === 2) {
    if (seasons.operation || game.status === 'scheduled' || game.status === 'cancelled') return undefined;
    if (typeof game.startsAt !== 'number' || !Number.isFinite(game.startsAt)) return undefined;
    const boundary = seasons.enabled ? seasons.startedAt : seasons.disabledAt;
    if (typeof boundary !== 'number' || todayIn(undefined, game.startsAt) < todayIn(undefined, boundary) ||
      todayIn(undefined, game.startsAt) > todayIn()) return undefined;
    if (seasons.pendingClose && game.startsAt > (seasons.pendingClose.dueAt ?? 0)) return undefined;
    if (seasons.cadence?.type === 'date' && seasons.cadence.endsOn && (seasons.playedRounds ?? 0) >= 5 &&
      todayIn(undefined, game.startsAt) > seasons.cadence.endsOn) return undefined;
    if (game.status !== 'finished' && !playEvidence(game)) return undefined;
    return seasons.enabled ? seasons.currentId : `off_${seasons.count ?? 0}_${seasons.disabledAt}`;
  }
  if (!['open', 'locked', 'active'].includes(game.status ?? '') || !playEvidence(game)) return undefined;
  if (!seasons || seasons.operation || seasons.pendingClose) return undefined;
  const boundary = seasons.enabled ? seasons.startedAt : seasons.disabledAt;
  if (typeof boundary !== 'number' || !Number.isFinite(boundary) || boundary <= 0 ||
      typeof documentCreatedAt !== 'number' || !Number.isFinite(documentCreatedAt) || documentCreatedAt < boundary) return undefined;
  if (seasons.enabled) return seasons.currentId || undefined;
  return (seasons.count ?? 0) > 0 ? `off_${seasons.count}_${seasons.disabledAt}` : undefined;
}
