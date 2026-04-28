import React from 'react';
import { Image, StyleSheet, View, Text, ViewStyle } from 'react-native';
import { colors, radius } from '@/theme';
import { getAvatarById } from '@/data/avatars';

interface Props {
  /**
   * Built-in avatar id. When set, the procedural avatar (color + glyph) is
   * rendered and `uri` is ignored. This is the modern path used for
   * /users/{uid}.avatarId.
   */
  avatarId?: string | null;
  /** Legacy network-image fallback. Used only when `avatarId` is missing. */
  uri?: string;
  name: string;
  size?: number;
  showRing?: boolean;
  ringColor?: string;
  style?: ViewStyle;
}

export function Avatar({
  avatarId,
  uri,
  name,
  size = 44,
  showRing,
  ringColor,
  style,
}: Props) {
  const ringWidth = showRing ? 2 : 0;
  const inner = size - ringWidth * 2;

  const def = getAvatarById(avatarId ?? undefined);
  const initials = name.slice(0, 1);

  return (
    <View
      style={[
        {
          width: size,
          height: size,
          borderRadius: radius.pill,
          padding: ringWidth,
          backgroundColor: showRing ? ringColor ?? colors.primary : 'transparent',
        },
        style,
      ]}
    >
      {def ? (
        <View
          style={[
            styles.fallback,
            {
              width: inner,
              height: inner,
              borderRadius: radius.pill,
              backgroundColor: def.bg,
            },
          ]}
        >
          <Text style={{ fontSize: inner * 0.55 }}>{def.glyph}</Text>
        </View>
      ) : uri ? (
        <Image
          source={{ uri }}
          style={{ width: inner, height: inner, borderRadius: radius.pill }}
        />
      ) : (
        <View
          style={[
            styles.fallback,
            { width: inner, height: inner, borderRadius: radius.pill },
          ]}
        >
          <Text style={styles.initials}>{initials}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: {
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: {
    color: colors.primary,
    fontSize: 18,
    fontWeight: '600',
  },
});
