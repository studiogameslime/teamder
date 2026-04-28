// PlayerIdentity — the single user-facing identity surface.
//
// Every screen that renders a user (profile header, player card, game
// row, community member row, live match jersey, search result, etc.)
// uses this component. Currently identity = jersey + optional name.
// If we later swap to a different visual (avatar mosaic, photo, …) we
// only update this file.

import React from 'react';
import { Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { Jersey } from './Jersey';
import type { User } from '@/types';
import { colors, typography } from '@/theme';

export type PlayerIdentitySize = 'sm' | 'md' | 'lg' | 'xl';

interface Props {
  /**
   * Source for the identity. Pass the full User when you have it; if
   * you only have the id+name (e.g., in-game players), pass a partial.
   */
  user: Pick<User, 'id' | 'name' | 'jersey'> | null | undefined;
  /** Preset visual size — the most common cases mapped to dp. */
  size?: PlayerIdentitySize | number;
  /** Show the user name under the jersey. Default: false. */
  showName?: boolean;
  /** Show display-name-on-shirt caption (delegates to Jersey). */
  showShirtName?: boolean;
  /** Highlight ring around the jersey (used for picker preview). */
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
 * Reusable identity. Supports a full `User` or a partial — the Jersey
 * component handles fallback to a deterministic auto-jersey when
 * `user.jersey` is missing.
 */
export function PlayerIdentity({
  user,
  size = 'md',
  showName = false,
  showShirtName = false,
  highlight = false,
  onPress,
  style,
}: Props) {
  const px = typeof size === 'number' ? size : SIZE_MAP[size];
  const name = user?.name ?? '';

  const content = (
    <>
      <Jersey
        jersey={user?.jersey}
        user={user ? { id: user.id, name } : null}
        size={px}
        showName={showShirtName}
        showRing={highlight}
      />
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
