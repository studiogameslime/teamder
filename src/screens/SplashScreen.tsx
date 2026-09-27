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
import { storage } from '@/services/storage';
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';
import { colors, radius, spacing, typography } from '@/theme';
import { he } from '@/i18n/he';

const MIN_HOLD_MS = 1400;
/** First run, or an unreadable measurement. A middling phone's cold boot. */
const DEFAULT_BOOT_MS = 2600;
const FADE_MS = 320;
/**
 * The bar and the button occupy the SAME slot, at the same height, so the one
 * literally replaces the other when loading ends — no jump, no reflow.
 */
const CTA_SLOT_H = 54;
const BAR_H = 10;

// ─── Pure visual ─────────────────────────────────────────────────────────

/**
 * The launch artwork plus a bar that fills ONCE, over the time boot actually
 * takes on this device.
 *
 * ─── Two earlier versions, and why both were wrong ──────────────────────
 *
 * The first swept 0→100 on a loop. It was honest about not knowing the
 * fraction, but it read as the app loading several times over.
 *
 * The second counted "readiness gates". That looked principled and was not:
 * on a fresh install `currentUserId` is null, so the group-hydration gate
 * passed for free at mount, and the other two flipped together — the bar went
 * 33% → 100% in one jump and then sat at the end waiting. It also was not
 * monotonic underneath, because that gate flips BACK to false the moment a
 * session appears.
 *
 * ─── What it does now ───────────────────────────────────────────────────
 *
 * There is no way to know in advance how long a boot will take. But the
 * previous boot ON THIS PHONE is a real measurement, and it is a far better
 * estimate than a guess: the bar animates across `expectedMs`, which is the
 * smoothed duration of past launches, so on a slow device it is a slow bar and
 * on a fast one a fast bar. Every launch measures itself and feeds the next.
 *
 * Two guards keep it from lying:
 *
 *   • it stops at 92% and then creeps, so it can never show a full bar while
 *     the app is still working. Completion is driven by `ready`, not by time;
 *   • if boot finishes early the bar jumps to full and the screen hands over —
 *     the estimate is never allowed to hold anybody back.
 */
export function SplashVisual({
  showBar = true,
  ready = false,
  expectedMs,
  finishMs = 260,
}: {
  showBar?: boolean;
  ready?: boolean;
  expectedMs: number | null;
  /**
   * How long the bar has left to complete in. The screen never dismisses
   * before its minimum hold, so on a warm boot — where `ready` lands almost
   * immediately — completing in 260ms would leave a full bar sitting there
   * doing nothing for a second, which is the "fills and waits" the whole
   * rework is about. The caller passes the hold it still owes.
   */
  finishMs?: number;
}) {
  const { width, height } = useWindowDimensions();

  const grow = useSharedValue(0.04);
  const startedRef = useRef(false);
  useEffect(() => {
    if (ready) {
      // Real completion, paced to land exactly as the screen hands over — so
      // the bar is still travelling right up to the moment the button appears,
      // instead of finishing early and waiting.
      cancelAnimation(grow);
      grow.value = withTiming(1, {
        duration: Math.max(240, finishMs),
        easing: Easing.out(Easing.cubic),
      });
      return;
    }
    if (expectedMs == null || startedRef.current) return;
    startedRef.current = true;
    grow.value = withSequence(
      // The estimate. Near-linear, because a boot's cost is spread across it
      // rather than front-loaded, and an eased curve would read as stalling.
      withTiming(0.92, { duration: expectedMs, easing: Easing.linear }),
      // Past the estimate the honest thing is "slower than usual, still
      // working" — so it keeps inching without ever arriving.
      withTiming(0.985, { duration: 14000, easing: Easing.out(Easing.quad) }),
    );
  }, [ready, expectedMs, finishMs, grow]);

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
  onFinish: () => void;
}

export function SplashScreen({ ready, awaitStart = false, onFinish }: Props) {
  const rootOpacity = useSharedValue(1);
  const rootScale = useSharedValue(1);
  const ctaOpacity = useSharedValue(0);
  const ctaShift = useSharedValue(14);
  const heldEnoughRef = useRef(false);
  const mountTsRef = useRef(Date.now());
  const [showCta, setShowCta] = React.useState(false);

  // How long boot took last time on this device. Read once, and the bar waits
  // the few milliseconds for it rather than starting on a wrong estimate and
  // having to retarget. `null` until it lands; the fallback covers a first run
  // and a failed read.
  const [expectedMs, setExpectedMs] = React.useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    void storage
      .getBootDurationMs()
      // Never shorter than the hold: the screen is up for MIN_HOLD_MS no
      // matter how fast boot is, so a bar that finished sooner would just sit
      // at the end.
      .then((v) => alive && setExpectedMs(Math.max(MIN_HOLD_MS, v ?? DEFAULT_BOOT_MS)))
      .catch(() => alive && setExpectedMs(Math.max(MIN_HOLD_MS, DEFAULT_BOOT_MS)));
    return () => {
      alive = false;
    };
  }, []);

  // And this launch measures itself, so the next one is better calibrated.
  // Recorded once, at the moment the app is genuinely ready — not when the
  // screen goes away, which for a new person is whenever they tap.
  const measuredRef = useRef(false);
  useEffect(() => {
    if (!ready || measuredRef.current) return;
    measuredRef.current = true;
    void storage.recordBootDurationMs(Date.now() - mountTsRef.current);
  }, [ready]);

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
      <SplashVisual
        showBar={!showCta}
        ready={ready}
        expectedMs={expectedMs}
        finishMs={Math.max(
          240,
          MIN_HOLD_MS - (Date.now() - mountTsRef.current),
        )}
      />
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
