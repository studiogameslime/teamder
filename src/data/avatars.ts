// Bundled illustrations. Persisted ids remain readable, including legacy aliases.
import type { ImageSourcePropType } from 'react-native';

export interface AvatarDef {
  id: string;
  source: ImageSourcePropType;
}

export const AVATARS: AvatarDef[] = [
  { id: 'a01', source: require('../assets/images/avatars/avatar-25.jpg') },
  { id: 'a02', source: require('../assets/images/avatars/avatar-26.jpg') },
  { id: 'a03', source: require('../assets/images/avatars/avatar-33.jpg') },
  { id: 'a04', source: require('../assets/images/avatars/avatar-27.jpg') },
  { id: 'a05', source: require('../assets/images/avatars/avatar-04.jpg') },
  { id: 'a06', source: require('../assets/images/avatars/avatar-23.jpg') },
  { id: 'a07', source: require('../assets/images/avatars/avatar-02.jpg') },
  { id: 'a08', source: require('../assets/images/avatars/avatar-24.jpg') },
  { id: 'a09', source: require('../assets/images/avatars/avatar-07.jpg') },
  { id: 'a11', source: require('../assets/images/avatars/avatar-17.jpg') },
  { id: 'a13', source: require('../assets/images/avatars/avatar-10.jpg') },
  { id: 'a15', source: require('../assets/images/avatars/avatar-11.jpg') },
  { id: 'a17', source: require('../assets/images/avatars/avatar-05.jpg') },
  { id: 'a19', source: require('../assets/images/avatars/avatar-20.jpg') },
  { id: 'a21', source: require('../assets/images/avatars/avatar-13.jpg') },
  { id: 'a22', source: require('../assets/images/avatars/avatar-01.jpg') },
  { id: 'a23', source: require('../assets/images/avatars/avatar-08.jpg') },
  { id: 'a24', source: require('../assets/images/avatars/avatar-16.jpg') },
  { id: 'a25', source: require('../assets/images/avatars/avatar-03.jpg') },
  { id: 'a26', source: require('../assets/images/avatars/avatar-06.jpg') },
  { id: 'a27', source: require('../assets/images/avatars/avatar-09.jpg') },
  { id: 'a28', source: require('../assets/images/avatars/avatar-12.jpg') },
  { id: 'a29', source: require('../assets/images/avatars/avatar-14.jpg') },
  { id: 'a30', source: require('../assets/images/avatars/avatar-15.jpg') },
  { id: 'a31', source: require('../assets/images/avatars/avatar-18.jpg') },
  { id: 'a32', source: require('../assets/images/avatars/avatar-19.jpg') },
  { id: 'a33', source: require('../assets/images/avatars/avatar-21.jpg') },
  { id: 'a34', source: require('../assets/images/avatars/avatar-22.jpg') },
  { id: 'a35', source: require('../assets/images/avatars/avatar-28.jpg') },
  { id: 'a36', source: require('../assets/images/avatars/avatar-29.jpg') },
  { id: 'a37', source: require('../assets/images/avatars/avatar-30.jpg') },
  { id: 'a38', source: require('../assets/images/avatars/avatar-31.jpg') },
  { id: 'a39', source: require('../assets/images/avatars/avatar-32.jpg') },
  { id: 'a40', source: require('../assets/images/avatars/avatar-34.jpg') },
  { id: 'a41', source: require('../assets/images/avatars/avatar-35.jpg') },
  { id: 'a42', source: require('../assets/images/avatars/avatar-36.jpg') },
];

// The approved sheet has two female portraits. Keep every older female choice
// mapped to a female portrait without duplicate entries in the picker.
const LEGACY_AVATAR_ALIASES: Record<string, string> = {
  a10: 'a08', a12: 'a06', a14: 'a06',
  a16: 'a08', a18: 'a06', a20: 'a08',
};

export function getAvatarById(id: string | undefined | null): AvatarDef | undefined {
  if (!id) return undefined;
  const resolvedId = Object.prototype.hasOwnProperty.call(LEGACY_AVATAR_ALIASES, id)
    ? LEGACY_AVATAR_ALIASES[id] : id;
  return AVATARS.find((a) => a.id === resolvedId);
}

export function getAvatarSource(id: string | undefined | null): AvatarDef {
  return getAvatarById(id) ?? AVATARS[0];
}

export function pickRandomAvatarId(): string {
  return AVATARS[Math.floor(Math.random() * AVATARS.length)].id;
}
