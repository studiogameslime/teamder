// Built-in group cover images — the curated gallery a user can pick from
// when creating/editing a community (parallel to avatars.ts for players).
//
// A group's cover is resolved in this priority order (see
// CommunityStadiumHero):
//   1. Group.coverPhotoUrl  — a device upload (Storage URL)
//   2. Group.coverImageId   — a pick from THIS built-in gallery
//   3. STADIUM_BG fallback  — when neither is set
//
// To add more covers: drop the image into src/assets/images/groupImages/ and
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
  // The 10 curated covers in src/assets/images/groupImages/. c01 is the
  // original default stadium; c02–c10 are the new gallery images. Ids are
  // stable forever (persisted on the group doc).
  { id: 'c01', source: require('../assets/images/groupImages/default.png') },
  { id: 'c02', source: require('../assets/images/groupImages/1.png') },
  { id: 'c03', source: require('../assets/images/groupImages/2.png') },
  { id: 'c04', source: require('../assets/images/groupImages/3.png') },
  { id: 'c05', source: require('../assets/images/groupImages/4.png') },
  { id: 'c06', source: require('../assets/images/groupImages/5.png') },
  { id: 'c07', source: require('../assets/images/groupImages/6.png') },
  { id: 'c08', source: require('../assets/images/groupImages/7.png') },
  { id: 'c09', source: require('../assets/images/groupImages/8.png') },
  { id: 'c10', source: require('../assets/images/groupImages/9.png') },
  // Bright daytime covers; append new ids without replacing persisted choices.
  { id: 'c11', source: require('../assets/images/groupImages/daylight-pitch.jpg') },
  { id: 'c12', source: require('../assets/images/groupImages/daylight-ball.jpg') },
  { id: 'c13', source: require('../assets/images/groupImages/daylight-team.jpg') },
  { id: 'c14', source: require('../assets/images/groupImages/daylight-match.jpg') },
  { id: 'c15', source: require('../assets/images/groupImages/daylight-coast.jpg') },
  { id: 'c16', source: require('../assets/images/groupImages/daylight-friends.jpg') },
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
