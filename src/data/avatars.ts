// Built-in avatar palette.
//
// We render avatars procedurally (background color + glyph) rather than
// shipping 24 PNG files. Trade-offs we accept:
//   - The "image" is a React component, not an asset on disk. Local-only,
//     instant, zero kb of bundle weight, no network hop.
//   - Variety comes from the emoji glyphs (skin tones, hair, gender,
//     neutrals), which render natively on Android and iOS.
//
// To add a new avatar, append an entry below — id MUST be unique and
// stable, since it's the value persisted in /users/{uid}.avatarId. Don't
// remove ids — old user docs reference them.

export interface AvatarDef {
  /** Stable id stored in Firestore. Never change. */
  id: string;
  /** Background color of the avatar circle. */
  bg: string;
  /** Emoji or short string rendered in the center. */
  glyph: string;
}

export const AVATARS: AvatarDef[] = [
  // Neutrals / sport vibe
  { id: 'a01', bg: '#16A34A', glyph: '⚽' },
  { id: 'a02', bg: '#F59E0B', glyph: '🏆' },
  { id: 'a03', bg: '#3B82F6', glyph: '🎽' },
  { id: 'a04', bg: '#EF4444', glyph: '🥅' },

  // People — varied skin tones
  { id: 'a05', bg: '#FCD34D', glyph: '👨🏻' },
  { id: 'a06', bg: '#FCA5A5', glyph: '👩🏻' },
  { id: 'a07', bg: '#FDBA74', glyph: '👨🏼' },
  { id: 'a08', bg: '#FCD9B6', glyph: '👩🏼' },
  { id: 'a09', bg: '#FBBF24', glyph: '👨🏽' },
  { id: 'a10', bg: '#F472B6', glyph: '👩🏽' },
  { id: 'a11', bg: '#A78BFA', glyph: '👨🏾' },
  { id: 'a12', bg: '#C084FC', glyph: '👩🏾' },
  { id: 'a13', bg: '#34D399', glyph: '👨🏿' },
  { id: 'a14', bg: '#22D3EE', glyph: '👩🏿' },

  // Hair / age variety
  { id: 'a15', bg: '#F87171', glyph: '👨‍🦰' },
  { id: 'a16', bg: '#FB923C', glyph: '👩‍🦰' },
  { id: 'a17', bg: '#A3E635', glyph: '👨‍🦱' },
  { id: 'a18', bg: '#FACC15', glyph: '👩‍🦱' },
  { id: 'a19', bg: '#94A3B8', glyph: '👨‍🦳' },
  { id: 'a20', bg: '#CBD5E1', glyph: '👩‍🦳' },
  { id: 'a21', bg: '#9CA3AF', glyph: '👨‍🦲' },
  { id: 'a22', bg: '#6EE7B7', glyph: '🧔' },

  // Inclusive neutrals
  { id: 'a23', bg: '#60A5FA', glyph: '🧑' },
  { id: 'a24', bg: '#F0ABFC', glyph: '🧓' },
];

export function getAvatarById(id: string | undefined | null): AvatarDef | undefined {
  if (!id) return undefined;
  return AVATARS.find((a) => a.id === id);
}

/**
 * Returns the avatar def the UI should render, falling back to a stable
 * default when the id is missing/unknown so callers never get undefined.
 */
export function getAvatarSource(id: string | undefined | null): AvatarDef {
  return getAvatarById(id) ?? AVATARS[0];
}

export function pickRandomAvatarId(): string {
  return AVATARS[Math.floor(Math.random() * AVATARS.length)].id;
}
