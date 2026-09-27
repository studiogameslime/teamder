// SplashScreen — the app's single launch screen, and the new person's welcome.
//
// ─── One screen, two endings ────────────────────────────────────────────
//
// Everybody sees the same thing on launch: the artwork, with a progress bar
// sitting exactly where the button will be. What happens when loading finishes
// is the only thing that differs.
//
//   • somebody with an account — the bar completes, the screen fades, they are
//     on their Home. No button, no second screen, no tap.
//   • somebody new — the bar fades out and a "מתחילים" button rises in its
//     place. The screen waits for them. Tapping it goes to "איך בא לך להתחיל?".
//
// This replaced a separate Welcome screen that sat AFTER the splash, which
// meant a new person watched a loader, then met a second full-screen pitch
// carrying the same artwork and the same sentence. One screen says it once.
//
// ─── The wordmark and slogan are in the ARTWORK ─────────────────────────
//
// Not drawn here. Not overlaid. See `SplashHero.tsx` — this file only draws
// the bar and the button.

import React, { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import * as ExpoSplash from 'expo-splash-screen';
import { Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { SPLASH_IMAGE } from '@/components/entry/SplashHero';
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';
import { colors, radius, spacing, typography } from '@/theme';
import { he } from '@/i18n/he';

const MIN_HOLD_MS = 1400;
const FADE_MS = 320;
/**
 * The bar and the button occupy the SAME slot, at the same height, so the one
 * literally replaces the other when loading ends — no jump, no reflow.
 */
const CTA_SLOT_H = 54;
const BAR_H = 10;

// ─── Pure visual ─────────────────────────────────────────────────────────

/**
 * The launch artwork plus a bar that fills ONCE, against real boot progress.
 *
 * ─── Why it is not a loop any more ──────────────────────────────────────
 *
 * The first version swept 0→100 repeatedly. It was honest about not knowing
 * the fraction, but it read as the app loading several times over, which is a
 * worse lie than the one it was avoiding.
 *
 * `progress` is the share of the splash's OWN readiness gates that have
 * passed — auth restore, the entry flag, group hydration. Every one is a real
 * state transition, so the bar only ever moves forward and it finishes exactly
 * when the app does.
 *
 * ─── The creep, and why it is not a fake percentage ─────────────────────
 *
 * Between two gates there is nothing to report, and a bar frozen for three
 * seconds looks broken. So within a segment the fill eases toward — but never
 * reaches — the next gate: it covers at most 60% of the gap and decelerates.
 * It can therefore never claim a milestone that has not happened, and it can
 * never reach the end before the app is genuinely ready.
 */
export function SplashVisual({
  showBar = true,
  progress = 0,
}: {
  showBar?: boolean;
  progress?: number;
}) {
  const { width, height } = useWindowDimensions();

  const grow = useSharedValue(0.04);
  useEffect(() => {
    const target = Math.max(0.04, Math.min(1, progress));
    // Monotonic by construction: never animate below where the bar already is,
    // so a creep that has run ahead of its segment does not snap backwards
    // when the next gate lands.
    const from = Math.max(grow.value, 0);
    if (target >= 1) {
      grow.value = withTiming(1, { duration: 420, easing: Easing.out(Easing.cubic) });
      return;
    }
    const settled = Math.max(from, target);
    const gap = (1 - settled) * 0.6;
    grow.value = withSequence(
      withTiming(settled, { duration: 380, easing: Easing.out(Easing.cubic) }),
      // The long, decelerating reach toward the next gate. Capped short of it.
      withTiming(Math.min(0.94, settled + gap), {
        duration: 6000,
        easing: Easing.out(Easing.quad),
      }),
    );
  }, [progress, grow]);

  useEffect(() => () => cancelAnimation(grow), [grow]);

  const fillStyle = useAnimatedStyle(() => ({
    // A percentage WIDTH on an ordinary row child. Under forceRTL a row lays
    // out right-to-left, so the fill is anchored to the RIGHT edge and grows
    // leftwards — the direction Hebrew reads. No `left`, no `translateX`,
    // nothing that flips or has to be sign-corrected per locale.
    width: `${grow.value * 100}%`,
  }));

  return (
    <View style={styles.root}>
      {/* Definite width and height, from the window — not `absoluteFill`.
          An Image sized only by insets makes `cover` scale from the bitmap's
          own pixels instead of the box, and the artwork rendered several times
          too large with the wordmark off-screen. Same failure the card slot
          and the old hero both hit; numbers are the thing that resolves. */}
      <Image
        source={SPLASH_IMAGE}
        style={{ width, height }}
        resizeMode="cover"
      />
      {showBar ? (
        <SafeAreaView edges={['bottom']} style={styles.ctaBar} pointerEvents="none">
          <View style={styles.barSlot}>
            <View style={styles.barTrack}>
              <Animated.View style={[styles.barFill, fillStyle]} />
            </View>
          </View>
        </SafeAreaView>
      ) : null}
    </View>
  );
}

// ─── Kickoff / hold / hand-off ───────────────────────────────────────────

interface Props {
  ready: boolean;
  /**
   * This launch belongs to somebody who has not been asked what they came
   * for. The screen stops being a loader and becomes their welcome: the bar
   * gives way to a button and nothing happens until they tap it.
   */
  awaitStart?: boolean;
  /** Share of the boot gates that have passed, 0..1. Drives the bar. */
  progress?: number;
  onFinish: () => void;
}

export function SplashScreen({
  ready,
  awaitStart = false,
  progress = 0,
  onFinish,
}: Props) {
  const rootOpacity = useSharedValue(1);
  const rootScale = useSharedValue(1);
  const ctaOpacity = useSharedValue(0);
  const ctaShift = useSharedValue(14);
  const heldEnoughRef = useRef(false);
  const mountTsRef = useRef(Date.now());
  const [showCta, setShowCta] = React.useState(false);

  useEffect(() => {
    ExpoSplash.hideAsync().catch(() => {});
  }, []);

  const dismiss = React.useCallback(() => {
    rootScale.value = withTiming(1.12, {
      duration: FADE_MS,
      easing: Easing.out(Easing.quad),
    });
    rootOpacity.value = withTiming(
      0,
      { duration: FADE_MS, easing: Easing.in(Easing.cubic) },
      (finished) => {
        if (finished) runOnJS(onFinish)();
      },
    );
  }, [onFinish, rootOpacity, rootScale]);

  useEffect(() => {
    const elapsed = Date.now() - mountTsRef.current;
    const remaining = Math.max(0, MIN_HOLD_MS - elapsed);
    if (!ready) {
      if (remaining === 0) heldEnoughRef.current = true;
      return;
    }
    const timer = setTimeout(() => {
      heldEnoughRef.current = true;
      // A new person is NOT sent onward. The bar goes, the button arrives, and
      // the screen holds until they choose to start.
      if (awaitStart) {
        // The welcome funnel's denominator moved here with the screen: this is
        // the moment a new person is actually looking at the pitch with a way
        // forward, which is what `entry_welcome_viewed` always counted.
        logEvent(AnalyticsEvent.EntryWelcomeViewed, { is_guest: true });
        setShowCta(true);
        ctaOpacity.value = withTiming(1, { duration: 260 });
        ctaShift.value = withTiming(0, {
          duration: 300,
          easing: Easing.out(Easing.cubic),
        });
        return;
      }
      dismiss();
    }, remaining);
    return () => clearTimeout(timer);
  }, [ready, awaitStart, dismiss, ctaOpacity, ctaShift]);

  useEffect(() => {
    return () => {
      cancelAnimation(rootOpacity);
    };
  }, [rootOpacity]);

  const rootStyle = useAnimatedStyle(() => ({
    opacity: rootOpacity.value,
    transform: [{ scale: rootScale.value }],
  }));
  const ctaStyle = useAnimatedStyle(() => ({
    opacity: ctaOpacity.value,
    transform: [{ translateY: ctaShift.value }],
  }));

  return (
    <Animated.View
      style={[styles.absolute, rootStyle]}
      // Transparent to touches while it is only a loader; the button takes
      // them once it is a welcome.
      pointerEvents={showCta ? 'box-none' : 'none'}
    >
      {/* Once the hold is over the bar is full by definition — the gates it
          tracks are what `ready` is made of. */}
      <SplashVisual showBar={!showCta} progress={ready ? 1 : progress} />
      {showCta ? (
        <SafeAreaView edges={['bottom']} style={styles.ctaBar} pointerEvents="box-none">
          <Animated.View style={[styles.ctaSlot, ctaStyle]}>
            <Pressable
              onPress={() => {
                logEvent(AnalyticsEvent.EntryWelcomeContinued, { is_guest: true });
                dismiss();
              }}
              accessibilityRole="button"
              accessibilityLabel={he.entryWelcomeCta}
              style={({ pressed }) => [styles.cta, pressed && { opacity: 0.92 }]}
            >
              <View style={styles.ctaInner}>
                <Text style={styles.ctaText}>{he.entryWelcomeCta}</Text>
                {/* `chevron-back` is the RTL "forward". */}
                <Ionicons name="chevron-back" size={20} color={colors.textOnPrimary} />
              </View>
            </Pressable>
          </Animated.View>
        </SafeAreaView>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  absolute: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9999,
    elevation: 9999,
  },
  root: { ...StyleSheet.absoluteFillObject, backgroundColor: '#3E8BF2' },
  // Same height as the button so the swap is a replacement, not a reflow.
  barSlot: { height: CTA_SLOT_H, justifyContent: 'center' },
  barTrack: {
    height: BAR_H,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.55)',
    overflow: 'hidden',
    // A row, so the fill below is an ordinary child that forceRTL anchors to
    // the right edge.
    flexDirection: 'row',
  },
  barFill: {
    height: '100%',
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
  },
  ctaBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.lg,
  },
  ctaSlot: { height: CTA_SLOT_H, justifyContent: 'center' },
  cta: {
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingVertical: spacing.md + 2,
    shadowColor: '#0B3A86',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.32,
    shadowRadius: 18,
    elevation: 8,
  },
  ctaInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  ctaText: { ...typography.button, fontSize: 18, color: colors.textOnPrimary },
});
