import type { ImageSourcePropType } from 'react-native';
import type { Game } from '@/types';
import { getCoverSource } from './coverImages';
import { roundSurfaceCover } from './roundSurfaceCovers';
import { clubDefaultCoverId } from '@/utils/clubDefaultCoverId';

const DEFAULT_COVER: ImageSourcePropType = require('../assets/images/groupImages/park-aerial.jpg');
export type RoundCoverClub = { coverPhotoUrl?: string; coverImageId?: string };

/** Shared by the list and details: identical precedence, stable round seed and fallback. */
export function resolveRoundCover(
  game: Pick<Game, 'id' | 'fieldType' | 'isOrphanContext'> & { groupId?: string; startsAt?: number },
  cover?: RoundCoverClub | null,
  loading = false,
  failedPhotoUrl?: string | null,
): ImageSourcePropType | undefined {
  const groupId = game.isOrphanContext ? undefined : game.groupId;
  if (groupId && loading) return undefined;
  const club = game.isOrphanContext ? undefined : cover;
  if (club?.coverPhotoUrl && club.coverPhotoUrl !== failedPhotoUrl) return { uri: club.coverPhotoUrl };
  return roundSurfaceCover(game.fieldType, game.id, game.startsAt) ?? getCoverSource(club?.coverImageId) ??
    (groupId ? getCoverSource(clubDefaultCoverId(groupId)) : undefined) ?? DEFAULT_COVER;
}
