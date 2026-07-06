// BallSwitch — a drop-in replacement for React Native's <Switch> with
// Teamder's football identity: the thumb is a real SoccerBall that
// ROLLS (translates + rotates in sync, so it genuinely looks like it's
// rolling, not sliding) from one end of the track to the other when
// toggled. The track fills with the active colour as the ball arrives.
//
// API mirrors the subset of Switch we use across the app:
//   value, onValueChange, trackColor {false,true}, disabled, style.
// `thumbColor` is accepted and ignored (the thumb is always a ball).
//
// RTL: this app runs forceRTL, where the platform Switch puts the "on"
// thumb on the LEFT. We mirror that — off → ball rests on the right,
// on → ball rolls to the left — so it reads identically to the native
// switches it replaces.

import React, { useEffect } from 'react';
import { Pressable, StyleSheet, type ViewStyle } from 'react-native';
import Animated, {
  interpolate,
  interpolateColor,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { SoccerBall } from '../SoccerBall';
import { colors } from '@/theme';

interface Props {
  value: boolean;
  onValueChange: (next: boolean) => void;
  trackColor?: { false?: string; true?: string };
  /** Accepted for Switch-compat; ignored (the thumb is a ball). */
  thumbColor?: string;
  disabled?: boolean;
  style?: ViewStyle;
}

// Track + ball geometry. The ball is CENTRE-anchored and translated
// symmetrically left/right by HALF, so it can never poke past either end
// regardless of RTL/flex quirks.
const W = 52;
const H = 30;
const PAD = 3;
const BALL = H - PAD * 2; // 24
// Max the ball centre can shift from the track centre and still keep PAD
// clearance at the end: (W/2) − (BALL/2) − PAD.
const HALF = W / 2 - BALL / 2 - PAD; // 11
const TRAVEL = HALF * 2; // 22 — full roll distance
// Realistic rolling: degrees swept = (distance / circumference) · 360.
const ROLL_DEG = (TRAVEL / (Math.PI * BALL)) * 360; // ≈105°

export function BallSwitch({
  value,
  onValueChange,
  trackColor,
  disabled,
  style,
}: Props) {
  // 0 = off (ball right), 1 = on (ball left). Spring gives the ball a
  // little overshoot as it settles — like it bumps the goalpost.
  const p = useSharedValue(value ? 1 : 0);

  useEffect(() => {
    p.value = withSpring(value ? 1 : 0, {
      damping: 14,
      stiffness: 170,
      mass: 0.7,
    });
  }, [value, p]);

  const offColor = trackColor?.false ?? colors.border;
  const onColor = trackColor?.true ?? colors.primary;

  const trackStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(p.value, [0, 1], [offColor, onColor]),
  }));

  // Rolling thumb: the ball sits at the track centre and shifts by ±HALF —
  // off (p=0) → +HALF (right), on (p=1) → −HALF (left). Rotation tracks the
  // travel so it genuinely rolls rather than slides.
  const rotation = useDerivedValue(() => -p.value * ROLL_DEG);
  const ballStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: interpolate(p.value, [0, 1], [HALF, -HALF]) },
      { rotateZ: `${rotation.value}deg` },
    ],
  }));

  return (
    <Pressable
      onPress={() => {
        if (disabled) return;
        // The spring runs in the useEffect when `value` flips. Just report.
        onValueChange(!value);
      }}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled: !!disabled }}
      hitSlop={8}
      style={[disabled && { opacity: 0.5 }, style]}
    >
      <Animated.View style={[styles.track, trackStyle]}>
        <Animated.View style={[styles.ball, ballStyle]}>
          <SoccerBall size={BALL} />
        </Animated.View>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: {
    width: W,
    height: H,
    borderRadius: H / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ball: {
    width: BALL,
    height: BALL,
    // Soft shadow so the ball reads as sitting ON the track. iOS only — the
    // Android `elevation` shadow does NOT follow `transform: translateX`, so it
    // stayed at the ball's layout (centre) position while the ball rolled away,
    // leaving a ghost circle peeking out the far end of the track (user report).
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
  },
});
