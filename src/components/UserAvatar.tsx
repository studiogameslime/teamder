// Unified profile-image component. Replaces the legacy <Jersey>
// surface (shirt-shape with color/number) — that's gone everywhere
// except the live-match team-color UI which doesn't need this.
//
// Render priority:
//   1. uploaded photo (user.photoUrl)  → <Image>
//   2. chosen built-in avatar (user.avatarId) → bundled illustration
//   3. fallback: deterministic auto-avatar from user.id, so every
//      user — even legacy docs without avatarId/photoUrl — gets a
//      stable illustrated avatar instead of a grey blank.
//
// All shapes are circular by virtue of `borderRadius: size / 2`.

import React, { useEffect, useState } from 'react';
import {
  Image,
  StyleSheet,
  View,
  type ImageStyle,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { AVATARS, getAvatarById } from '@/data/avatars';
import type { User } from '@/types';

interface Props {
  user?: Pick<User, 'id' | 'name' | 'avatarId' | 'photoUrl'> | null;
  size: number;
  style?: StyleProp<ViewStyle>;
  /** When true, renders a thin white ring around the disc. */
  ring?: boolean;
}

export function UserAvatar({ user, size, style, ring }: Props) {
  const radius = size / 2;
  const ringStyle = ring
    ? { borderWidth: Math.max(2, size / 28), borderColor: '#FFFFFF' }
    : null;

  // Reset photo-error latch when the URL itself changes — a new
  // upload should re-attempt loading even if the previous URL 404'd.
  const [photoFailed, setPhotoFailed] = useState(false);
  useEffect(() => {
    setPhotoFailed(false);
  }, [user?.photoUrl]);

  // 1) Uploaded photo wins. If it fails to load (Storage object
  // missing/blocked/offline), fall through to the avatar branch so
  // the user still sees something — never a blank circle.
  if (user?.photoUrl && !photoFailed) {
    const imageStyle: StyleProp<ImageStyle> = [
      { width: size, height: size, borderRadius: radius },
      ringStyle,
      style as StyleProp<ImageStyle>,
    ];
    return (
      <Image
        resizeMethod="resize"
        source={{ uri: user.photoUrl }}
        style={imageStyle}
        onError={() => setPhotoFailed(true)}
      />
    );
  }

  // 2) Picked built-in avatar.
  const def = getAvatarById(user?.avatarId) ?? autoAvatarFor(user?.id ?? '');
  return (
    <View
      style={[
        styles.disc,
        {
          width: size,
          height: size,
          borderRadius: radius,
          backgroundColor: '#FFFFFF',
        },
        ringStyle,
        style,
      ]}
    >
      <Image source={def.source} style={{ width: size, height: size }} resizeMode="contain" resizeMethod="resize" />
    </View>
  );
}

/**
 * Deterministic fallback so legacy users without avatarId/photoUrl
 * still render a stable illustration across sessions.
 */
// Automatic fallbacks use only sport objects, never infer a user's gender.
const NEUTRAL_AVATAR_IDS = ['a01', 'a02', 'a03', 'a04'];
const NEUTRAL_AVATARS = AVATARS.filter((a) => NEUTRAL_AVATAR_IDS.includes(a.id));

function autoAvatarFor(uid: string): (typeof AVATARS)[number] {
  const pool = NEUTRAL_AVATARS.length > 0 ? NEUTRAL_AVATARS : AVATARS;
  if (!uid) return pool[0];
  let hash = 0;
  for (let i = 0; i < uid.length; i++) {
    hash = (hash * 31 + uid.charCodeAt(i)) >>> 0;
  }
  return pool[hash % pool.length];
}

const styles = StyleSheet.create({
  disc: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
});
