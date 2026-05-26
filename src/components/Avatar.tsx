import React, { useEffect } from 'react';
import { Image, StyleSheet, View, Text, ViewStyle } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
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
  /** When true the ring "breathes": opacity + width pulse 1↔1.08 in a
   *  long cycle so a live participant feels present without being
   *  noisy. Only meaningful when `showRing` is also true. */
  pulseRing?: boolean;
  style?: ViewStyle;
}

export function Avatar({
  avatarId,
  uri,
  name,
  size = 44,
  showRing,
  ringColor,
  pulseRing,
  style,
}: Props) {
  const ringWidth = showRing ? 2 : 0;
  const inner = size - ringWidth * 2;

  const def = getAvatarById(avatarId ?? undefined);
  const initials = name.slice(0, 1);

  // Breathing ring — long cycle so it reads as "alive" not "loading".
  // Only animates when explicitly opted-in to keep the default Avatar
  // cheap (it's used in dense lists).
  const breathe = useSharedValue(1);
  useEffect(() => {
    if (!pulseRing || !showRing) return;
    breathe.value = withRepeat(
      withSequence(
        withTiming(1.08, { duration: 1500, easing: Easing.inOut(Easing.quad) }),
        withTiming(1.0, { duration: 1500, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      false,
    );
    return () => cancelAnimation(breathe);
  }, [pulseRing, showRing, breathe]);
  const breatheStyle = useAnimatedStyle(() => ({
    transform: [{ scale: breathe.value }],
    // Subtle opacity dip in sync with the scale so the ring "exhales"
    // visibly without bouncing the avatar.
    opacity: 0.85 + (breathe.value - 1) * 1.8,
  }));

  return (
    <Animated.View
      style={[
        {
          width: size,
          height: size,
          borderRadius: radius.pill,
          padding: ringWidth,
          backgroundColor: showRing ? ringColor ?? colors.primary : 'transparent',
        },
        pulseRing && showRing ? breatheStyle : null,
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
    </Animated.View>
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
