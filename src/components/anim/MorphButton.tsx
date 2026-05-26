// MorphButton — drop-in replacement for the standard Button when the
// CTA represents a discrete "do a thing once" action (Save, Submit,
// Send, Join). Idle → loading → success morphs the button shape AND
// content without unmounting:
//
//   idle      → wide pill,            label visible
//   loading   → shrinks to a circle,  spinner visible
//   success   → stays a circle,       checkmark visible (~900 ms)
//   then auto-returns to idle (caller can also force reset).
//
// We render this in places where a slow Firestore round-trip used to
// just show a grey spinner inside the button. The morph feels like
// "the button is doing the work" — way more satisfying.

import React, { useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { PressableScale } from '../PressableScale';
import { colors, radius, spacing, typography } from '@/theme';

type Status = 'idle' | 'loading' | 'success';

interface Props {
  /** Idle label. */
  title: string;
  onPress?: () => Promise<unknown> | unknown;
  /** External controlled status. Optional — if omitted we run the
   *  whole idle→loading→success cycle internally based on `onPress`'s
   *  returned promise. */
  status?: Status;
  /** When the internal flow shows success it auto-returns to idle
   *  after this many ms. Default 900. */
  successDurationMs?: number;
  disabled?: boolean;
  /** Background colour at idle. Defaults to colors.primary. */
  color?: string;
  style?: ViewStyle;
}

export function MorphButton({
  title,
  onPress,
  status,
  successDurationMs = 900,
  disabled,
  color = colors.primary,
  style,
}: Props) {
  const [internalStatus, setInternalStatus] = React.useState<Status>('idle');
  const effective = status ?? internalStatus;
  const widthDriver = useSharedValue(1); // 1 = wide, 0 = circle
  const successDriver = useSharedValue(0); // 0 = hidden, 1 = check shown
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Drive the shape animation off the effective status.
  useEffect(() => {
    cancelAnimation(widthDriver);
    cancelAnimation(successDriver);
    if (effective === 'loading') {
      widthDriver.value = withTiming(0, {
        duration: 280,
        easing: Easing.out(Easing.cubic),
      });
      successDriver.value = 0;
    } else if (effective === 'success') {
      widthDriver.value = withTiming(0, {
        duration: 220,
        easing: Easing.out(Easing.cubic),
      });
      successDriver.value = withTiming(1, { duration: 180 });
    } else {
      // idle
      widthDriver.value = withTiming(1, {
        duration: 240,
        easing: Easing.out(Easing.cubic),
      });
      successDriver.value = withTiming(0, { duration: 140 });
    }
  }, [effective, widthDriver, successDriver]);

  // When uncontrolled and we just landed on success, schedule a return
  // to idle so the caller doesn't have to reset the prop manually.
  useEffect(() => {
    if (status != null) return;
    if (internalStatus !== 'success') return;
    if (successTimerRef.current) clearTimeout(successTimerRef.current);
    successTimerRef.current = setTimeout(
      () => setInternalStatus('idle'),
      successDurationMs,
    );
    return () => {
      if (successTimerRef.current) clearTimeout(successTimerRef.current);
    };
  }, [internalStatus, status, successDurationMs]);

  const handlePress = async () => {
    if (effective !== 'idle' || disabled) return;
    if (!onPress) return;
    if (status == null) setInternalStatus('loading');
    try {
      const r = onPress();
      if (r && typeof (r as Promise<unknown>).then === 'function') {
        await r;
      }
      if (status == null) setInternalStatus('success');
    } catch (err) {
      if (status == null) setInternalStatus('idle');
      throw err;
    }
  };

  // Container animation: borderRadius stays pill-ish but width shrinks
  // to a 48-dp circle on loading. alignSelf is centre-aware so the
  // shrink looks like the button retracts to its centre rather than
  // collapsing toward one edge.
  const containerStyle = useAnimatedStyle(() => {
    const minW = 48;
    const expandW = 220;
    const width = minW + widthDriver.value * (expandW - minW);
    return {
      width,
    };
  });

  // Fade label out as we leave idle; fade check / spinner in.
  const labelStyle = useAnimatedStyle(() => ({
    opacity: widthDriver.value,
  }));
  const overlayStyle = useAnimatedStyle(() => ({
    opacity: 1 - widthDriver.value,
  }));
  const checkStyle = useAnimatedStyle(() => ({
    opacity: successDriver.value,
    transform: [{ scale: 0.6 + successDriver.value * 0.4 }],
  }));

  return (
    <PressableScale
      onPress={handlePress}
      disabled={disabled || effective !== 'idle'}
      style={[
        styles.wrap,
        { alignSelf: 'center' },
        style,
      ]}
    >
      <Animated.View
        style={[
          styles.body,
          { backgroundColor: color },
          containerStyle,
        ]}
      >
        <Animated.Text
          style={[styles.label, labelStyle]}
          numberOfLines={1}
          allowFontScaling={false}
        >
          {title}
        </Animated.Text>
        {/* Loading + success overlays share the centre; opacities are
            driven so only one is visible at a time. */}
        <Animated.View style={[styles.overlay, overlayStyle]}>
          {effective === 'success' ? (
            <Animated.View style={checkStyle}>
              <Ionicons name="checkmark" size={26} color="#FFFFFF" />
            </Animated.View>
          ) : (
            <ActivityIndicator color="#FFFFFF" />
          )}
        </Animated.View>
      </Animated.View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  wrap: {
    minHeight: 48,
  },
  body: {
    height: 48,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  label: {
    ...typography.button,
    color: '#FFFFFF',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
