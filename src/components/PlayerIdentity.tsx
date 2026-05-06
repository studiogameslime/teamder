// PlayerIdentity — the single user-facing identity surface.
//
// Every screen that renders a user (profile header, player card, game
// row, community member row, search result, etc.) uses this
// component. Identity is now a profile photo or a chosen avatar
// (with deterministic fallback) — the legacy jersey layer was
// retired in favour of real profile pictures.

import React from 'react';
import { Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { UserAvatar } from './UserAvatar';
import type { User } from '@/types';
import { colors, typography } from '@/theme';

export type PlayerIdentitySize = 'sm' | 'md' | 'lg' | 'xl';

interface Props {
  /**
   * Source for the identity. Pass the full User when you have it; if
   * you only have the id+name (e.g., in-game players), pass a partial.
   */
  user: Pick<User, 'id' | 'name' | 'avatarId' | 'photoUrl'> | null | undefined;
  /** Preset visual size — the most common cases mapped to dp. */
  size?: PlayerIdentitySize | number;
  /** Show the user name under the avatar. Default: false. */
  showName?: boolean;
  /**
   * @deprecated Legacy prop from the jersey era — name-on-shirt is
   * gone. Kept readable so older call sites compile while we migrate.
   */
  showShirtName?: boolean;
  /** White ring around the avatar (used for picker preview). */
  highlight?: boolean;
  /**
   * When set, the entire identity becomes tappable. Callers typically
   * wire this to navigate to the PlayerCard for `user.id`.
   */
  onPress?: () => void;
  style?: ViewStyle;
}

const SIZE_MAP: Record<PlayerIdentitySize, number> = {
  sm: 36,
  md: 56,
  lg: 96,
  xl: 140,
};

/**
 * Reusable identity. Renders a circular avatar (photo > chosen
 * avatarId > deterministic auto-fallback) plus an optional name
 * underneath.
 */
export function PlayerIdentity({
  user,
  size = 'md',
  showName = false,
  highlight = false,
  onPress,
  style,
}: Props) {
  const px = typeof size === 'number' ? size : SIZE_MAP[size];
  const name = user?.name ?? '';

  const content = (
    <>
      <UserAvatar user={user ?? null} size={px} ring={highlight} />
      {showName && name ? (
        <Text
          numberOfLines={1}
          allowFontScaling={false}
          style={[
            styles.name,
            { fontSize: Math.max(11, px * 0.16), maxWidth: px * 1.6 },
          ]}
        >
          {name}
        </Text>
      ) : null}
    </>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          styles.root,
          pressed && { opacity: 0.7 },
          style,
        ]}
      >
        {content}
      </Pressable>
    );
  }
  return <View style={[styles.root, style]}>{content}</View>;
}

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    gap: 4,
  },
  name: {
    ...typography.caption,
    color: colors.text,
    fontWeight: '600',
    textAlign: 'center',
  },
});
