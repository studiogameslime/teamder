// PlayerCountBar — subtle progress bar replacing the plain "7/10"
// label. Uses the brand's primary green for fill, transitions to a
// glow when the roster is full so the eye lands on it. Subtle by
// design: this isn't a hero stat, just a visual sugar over the
// existing count text.
//
// Intentionally NOT a generic ProgressBar — keeps the football
// vocabulary contained: "people-outline" icon on the leading edge,
// localized count label on the trailing edge.

import React, { useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';

interface Props {
  /** Current registered count (players + guests). */
  current: number;
  /** Configured max — may be 0 for "no cap" (we render uncapped style). */
  max: number;
  /** Optional explicit label override (e.g. "סך 10 שחקנים"). */
  label?: string;
}

export function PlayerCountBar({ current, max, label }: Props) {
  const isCapped = max > 0;
  const ratio = isCapped ? Math.min(1, current / max) : 1;
  const isFull = isCapped && current >= max;

  const fill = useSharedValue(0);
  useEffect(() => {
    fill.value = withTiming(ratio, { duration: 350 });
  }, [ratio, fill]);

  // First-time-capacity-reached pulse + haptic. We track the last seen
  // `current` so we can detect the precise transition (e.g. 9 → 10),
  // and we latch with `pulsedRef` so subsequent same-render or
  // back-and-forth churn doesn't re-trigger the celebration.
  const pulse = useSharedValue(1);
  const prevCurrentRef = useRef(current);
  const pulsedRef = useRef(false);
  useEffect(() => {
    if (!isCapped) {
      prevCurrentRef.current = current;
      return;
    }
    const prev = prevCurrentRef.current;
    const reachedNow = prev < max && current >= max;
    if (reachedNow && !pulsedRef.current) {
      pulsedRef.current = true;
      pulse.value = withSequence(
        withTiming(1.06, { duration: 140 }),
        withTiming(1, { duration: 220 }),
      );
      // Light tap — celebratory but not interrupting. Failures (older
      // devices, simulators) are silently ignored; this is sugar.
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
    // If the count drops back below max (e.g. someone cancels), allow
    // the next re-fill to celebrate again.
    if (current < max && pulsedRef.current) {
      pulsedRef.current = false;
    }
    prevCurrentRef.current = current;
  }, [current, max, isCapped, pulse]);

  const fillStyle = useAnimatedStyle(() => ({
    width: `${fill.value * 100}%`,
  }));
  const pulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulse.value }],
  }));

  return (
    <Animated.View style={[styles.wrap, pulseStyle]}>
      <View style={styles.headerRow}>
        <Ionicons
          name="people-outline"
          size={16}
          color={isFull ? colors.primary : colors.textMuted}
        />
        <Text
          style={[styles.label, isFull && styles.labelFull]}
          numberOfLines={1}
        >
          {label ?? (isCapped ? `${current} / ${max} שחקנים` : `${current} שחקנים`)}
        </Text>
        {isFull ? (
          <Ionicons
            name="checkmark-circle"
            size={16}
            color={colors.primary}
          />
        ) : null}
      </View>
      <View style={styles.track}>
        <Animated.View
          style={[
            styles.fill,
            isFull && styles.fillFull,
            fillStyle,
          ]}
        />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 6,
    alignSelf: 'stretch',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  label: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '600',
    flex: 1,
    // RN on Android with forceRTL flips `textAlign:'right'` to visual
    // left because the paragraph direction is RTL ("right" = end of
    // line = visual left). RTL_LABEL_ALIGN resolves to 'left' on
    // Android and 'right' on iOS so the glyphs land on the visual
    // right edge across both platforms.
    textAlign: RTL_LABEL_ALIGN,
  },
  labelFull: {
    color: colors.primary,
    fontWeight: '700',
  },
  track: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.surfaceMuted,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 3,
    backgroundColor: colors.primary,
  },
  fillFull: {
    // "Glow" without bringing in shadows on Android (which are flaky).
    // Slightly brighter saturation on the full state — enough to read
    // as celebratory without changing the shape.
    backgroundColor: colors.primary,
    shadowColor: colors.primary,
    shadowOpacity: 0.4,
    shadowRadius: 4,
  },
});
