import type { FieldType } from '@/types';
import type { ImageSourcePropType } from 'react-native';
import { roundCoverPeriod } from './roundCoverPeriod';

/** Bundled pools. Keep ordering stable across releases. */
export const ROUND_SURFACE_COVERS: Record<FieldType, Record<'day' | 'night', readonly ImageSourcePropType[]>> = {
  grass: {
    day: [
      require('../assets/images/roundCovers/grass-day-01.jpg'),
      require('../assets/images/roundCovers/grass-day-02.jpg'),
      require('../assets/images/roundCovers/grass-day-03.jpg'),
      require('../assets/images/roundCovers/grass-day-04.jpg'),
      require('../assets/images/roundCovers/grass-day-05.jpg'),
      require('../assets/images/roundCovers/grass-day-06.jpg'),
      require('../assets/images/roundCovers/grass-day-07.jpg'),
      require('../assets/images/roundCovers/grass-day-08.jpg'),
      require('../assets/images/roundCovers/grass-day-09.jpg'),
      require('../assets/images/roundCovers/grass-day-10.jpg'),
    ],
    night: [
      require('../assets/images/roundCovers/grass-night-01.jpg'),
      require('../assets/images/roundCovers/grass-night-02.jpg'),
      require('../assets/images/roundCovers/grass-night-03.jpg'),
      require('../assets/images/roundCovers/grass-night-04.jpg'),
      require('../assets/images/roundCovers/grass-night-05.jpg'),
      require('../assets/images/roundCovers/grass-night-06.jpg'),
      require('../assets/images/roundCovers/grass-night-07.jpg'),
      require('../assets/images/roundCovers/grass-night-08.jpg'),
      require('../assets/images/roundCovers/grass-night-09.jpg'),
      require('../assets/images/roundCovers/grass-night-10.jpg'),
    ],
  },
  synthetic: {
    day: [
      require('../assets/images/roundCovers/synthetic-day-01.jpg'),
      require('../assets/images/roundCovers/synthetic-day-02.jpg'),
      require('../assets/images/roundCovers/synthetic-day-03.jpg'),
      require('../assets/images/roundCovers/synthetic-day-04.jpg'),
      require('../assets/images/roundCovers/synthetic-day-05.jpg'),
      require('../assets/images/roundCovers/synthetic-day-06.jpg'),
      require('../assets/images/roundCovers/synthetic-day-07.jpg'),
      require('../assets/images/roundCovers/synthetic-day-08.jpg'),
      require('../assets/images/roundCovers/synthetic-day-09.jpg'),
      require('../assets/images/roundCovers/synthetic-day-10.jpg'),
    ],
    night: [
      require('../assets/images/roundCovers/synthetic-night-01.jpg'),
      require('../assets/images/roundCovers/synthetic-night-02.jpg'),
      require('../assets/images/roundCovers/synthetic-night-03.jpg'),
      require('../assets/images/roundCovers/synthetic-night-04.jpg'),
      require('../assets/images/roundCovers/synthetic-night-05.jpg'),
      require('../assets/images/roundCovers/synthetic-night-06.jpg'),
      require('../assets/images/roundCovers/synthetic-night-07.jpg'),
      require('../assets/images/roundCovers/synthetic-night-08.jpg'),
      require('../assets/images/roundCovers/synthetic-night-09.jpg'),
      require('../assets/images/roundCovers/synthetic-night-10.jpg'),
    ],
  },
  asphalt: {
    day: [
      require('../assets/images/roundCovers/asphalt-day-01.jpg'),
      require('../assets/images/roundCovers/asphalt-day-02.jpg'),
      require('../assets/images/roundCovers/asphalt-day-03.jpg'),
      require('../assets/images/roundCovers/asphalt-day-04.jpg'),
      require('../assets/images/roundCovers/asphalt-day-05.jpg'),
      require('../assets/images/roundCovers/asphalt-day-06.jpg'),
      require('../assets/images/roundCovers/asphalt-day-07.jpg'),
      require('../assets/images/roundCovers/asphalt-day-08.jpg'),
      require('../assets/images/roundCovers/asphalt-day-09.jpg'),
      require('../assets/images/roundCovers/asphalt-day-10.jpg'),
    ],
    night: [
      require('../assets/images/roundCovers/asphalt-night-01.jpg'),
      require('../assets/images/roundCovers/asphalt-night-02.jpg'),
      require('../assets/images/roundCovers/asphalt-night-03.jpg'),
      require('../assets/images/roundCovers/asphalt-night-04.jpg'),
      require('../assets/images/roundCovers/asphalt-night-05.jpg'),
      require('../assets/images/roundCovers/asphalt-night-06.jpg'),
      require('../assets/images/roundCovers/asphalt-night-07.jpg'),
      require('../assets/images/roundCovers/asphalt-night-08.jpg'),
      require('../assets/images/roundCovers/asphalt-night-09.jpg'),
      require('../assets/images/roundCovers/asphalt-night-10.jpg'),
    ],
  },
};

/** No randomness or writes: a round retains its cover across loads/devices. */
export function roundSurfaceCover(fieldType: FieldType | undefined, roundId: string, startsAt?: number): ImageSourcePropType | undefined {
  if (!fieldType || !Object.prototype.hasOwnProperty.call(ROUND_SURFACE_COVERS, fieldType)) return undefined;
  const options = ROUND_SURFACE_COVERS[fieldType][roundCoverPeriod(startsAt)];
  let hash = 0;
  for (const char of roundId) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0;
  return options[hash % options.length];
}
