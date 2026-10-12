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
import { Image, Platform, Pressable, StyleSheet, type ViewStyle, type AccessibilityProps } from 'react-native';
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
import { useReducedMotion } from '@/hooks/animations/useReducedMotion';
import { useFormDesign, FORM_BLUE } from '@/components/forms/FormTheme';

interface Props extends AccessibilityProps {
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
  ...accessibilityProps
}: Props) {
  const reducedMotion = useReducedMotion();
  const formDesign = useFormDesign();
  const ballSize = formDesign ? 28 : BALL;
  const halfTravel = formDesign ? 12 : HALF;
  const rollDegrees = (halfTravel * 2 / (Math.PI * ballSize)) * 360;
  // 0 = off (ball right), 1 = on (ball left). Spring gives the ball a
  // little overshoot as it settles — like it bumps the goalpost.
  const p = useSharedValue(value ? 1 : 0);

  useEffect(() => {
    p.value = reducedMotion ? (value ? 1 : 0) : withSpring(value ? 1 : 0, {
      damping: 14,
      stiffness: 170,
      mass: 0.7,
      overshootClamping: formDesign,
    });
  }, [value, p, reducedMotion, formDesign]);

  const offColor = formDesign ? '#DCE5F0' : trackColor?.false ?? colors.border;
  const onColor = formDesign ? FORM_BLUE : trackColor?.true ?? colors.primary;

  const trackStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(p.value, [0, 1], [offColor, onColor]),
  }));

  // Rolling thumb: the ball sits at the track centre and shifts by ±HALF —
  // off (p=0) → +HALF (right), on (p=1) → −HALF (left). Rotation tracks the
  // travel so it genuinely rolls rather than slides.
  const rotation = useDerivedValue(() => -p.value * (formDesign ? rollDegrees : ROLL_DEG));
  const ballStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: interpolate(p.value, [0, 1], [halfTravel, -halfTravel]) },
      { rotateZ: `${rotation.value}deg` },
    ],
  }));

  return (
    <Pressable
      {...accessibilityProps}
      onPress={() => {
        if (disabled) return;
        // The spring runs in the useEffect when `value` flips. Just report.
        onValueChange(!value);
      }}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityState={{ ...accessibilityProps.accessibilityState, checked: value, disabled: !!disabled }}
      hitSlop={8}
      style={[formDesign && styles.formTouch, disabled && { opacity: 0.5 }, style]}
    >
      <Animated.View style={[styles.track, formDesign && styles.formTrack, trackStyle]}>
        <Animated.View style={[styles.ball, formDesign && { width: ballSize, height: ballSize, shadowOpacity: 0 }, ballStyle]}>
          {formDesign ? <Image
            source={require('../../assets/images/form-toggle-football-3d.png')}
            style={{ width: ballSize, height: ballSize }}
            resizeMode="contain"
            fadeDuration={0}
            accessible={false}
          /> : <SoccerBall size={BALL} />}
        </Animated.View>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  formTouch: { minHeight: 44, justifyContent: 'center', flexShrink: 0 },
  formTrack: { width: 56, height: 32, borderRadius: 16 },
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
    // Soft shadow so the ball reads as sitting ON the track — iOS ONLY.
    // On Android the shadow (elevation historically, and now the iOS-style
    // shadow* props under Fabric/RN0.79) does NOT follow `transform:
    // translateX`: it stays anchored at the ball's LAYOUT centre while the
    // ball rolls away, leaving a faint ghost circle beside it (recurring
    // user report). Gating the whole shadow to iOS removes the ghost.
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOpacity: 0.25,
        shadowRadius: 2,
        shadowOffset: { width: 0, height: 1 },
      },
      default: {},
    }),
  },
});
