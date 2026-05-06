// Unified profile-image component. Replaces the legacy <Jersey>
// surface (shirt-shape with color/number) — that's gone everywhere
// except the live-match team-color UI which doesn't need this.
//
// Render priority:
//   1. uploaded photo (user.photoUrl)  → <Image>
//   2. chosen built-in avatar (user.avatarId) → colored disc + emoji
//   3. fallback: deterministic auto-avatar from user.id, so every
//      user — even legacy docs without avatarId/photoUrl — gets a
//      stable colourful disc instead of a grey blank.
//
// All shapes are circular by virtue of `borderRadius: size / 2`.

import React from 'react';
import {
  Image,
  StyleSheet,
  Text,
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

  // 1) Uploaded photo wins. We trust the URL — Storage rules already
  // guard who can write to it.
  if (user?.photoUrl) {
    const imageStyle: StyleProp<ImageStyle> = [
      { width: size, height: size, borderRadius: radius },
      ringStyle,
      style as StyleProp<ImageStyle>,
    ];
    return <Image source={{ uri: user.photoUrl }} style={imageStyle} />;
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
          backgroundColor: def.bg,
        },
        ringStyle,
        style,
      ]}
    >
      <Text
        style={[styles.glyph, { fontSize: Math.max(14, size * 0.55) }]}
        numberOfLines={1}
      >
        {def.glyph}
      </Text>
    </View>
  );
}

/**
 * Deterministic fallback so legacy users without avatarId/photoUrl
 * still render a colorful disc, and the same user always lands on
 * the same colour across sessions.
 */
function autoAvatarFor(uid: string): (typeof AVATARS)[number] {
  if (!uid) return AVATARS[0];
  let hash = 0;
  for (let i = 0; i < uid.length; i++) {
    hash = (hash * 31 + uid.charCodeAt(i)) >>> 0;
  }
  return AVATARS[hash % AVATARS.length];
}

const styles = StyleSheet.create({
  disc: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  glyph: {
    textAlign: 'center',
  },
});
