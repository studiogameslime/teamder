// Built-in group cover images — the curated gallery a user can pick from
// when creating/editing a community (parallel to avatars.ts for players).
//
// A group's cover is resolved in this priority order (see
// CommunityStadiumHero):
//   1. Group.coverPhotoUrl  — a device upload (Storage URL)
//   2. Group.coverImageId   — a pick from THIS built-in gallery
//   3. STADIUM_BG fallback  — when neither is set
//
// To add more covers: drop the image into src/assets/images/covers/ and
// add an entry here. Keep the `id` stable forever (it's persisted on the
// group doc). Images should be landscape (~16:9) for the hero.

import type { ImageSourcePropType } from 'react-native';

export interface CoverDef {
  /** Stable id persisted as Group.coverImageId — never change it. */
  id: string;
  /** Bundled image. */
  source: ImageSourcePropType;
}

export const COVER_IMAGES: CoverDef[] = [
  // Seed entry — the existing default stadium background. Replace / extend
  // with the curated set as images land in src/assets/images/covers/.
  { id: 'c01', source: require('../assets/images/stadium-bg.png') },
];

/** Resolve a cover id → its bundled image source, or null if unknown. */
export function getCoverSource(id: string | undefined): ImageSourcePropType | null {
  if (!id) return null;
  const def = COVER_IMAGES.find((c) => c.id === id);
  return def ? def.source : null;
}

/** Pick a random cover id from the gallery (used as a new group's default). */
export function pickRandomCoverId(): string {
  if (COVER_IMAGES.length === 0) return '';
  const i = Math.floor(Math.random() * COVER_IMAGES.length);
  return COVER_IMAGES[i].id;
}
