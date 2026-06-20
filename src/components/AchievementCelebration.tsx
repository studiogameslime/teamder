// AchievementCelebration — the full-screen "you earned a title" moment.
//
// Pass a queue of newly-unlocked tiers; it shows them one at a time over a
// dimmed backdrop with a big celebratory production: rotating sunburst rays
// in the tier colour, expanding shockwave rings, twinkling sparkles, a
// dramatic medal entrance (spin + overshoot), two confetti/ball bursts and
// a congrats line. Tap / button / auto advances to the next, then onDone.

import React, { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { AchievementBadge } from '@/components/AchievementBadge';
import { CelebrationOverlay } from '@/components/anim/CelebrationOverlay';
import { TIER_META } from '@/data/achievements';
import type { NewlyUnlocked } from '@/services/achievementsService';
import { spacing, typography } from '@/theme';
import { he } from '@/i18n/he';
import { lightHaptic, successHaptic } from '@/utils/haptics';

interface Props {
  items: NewlyUnlocked[];
  onDone: () => void;
}

export function AchievementCelebration({ items, onDone }: Props) {
  const [index, setIndex] = useState(0);
  const item = items[index];
  // Guard against a double-tap (CTA + backdrop, or two taps in one frame)
  // advancing twice / calling onDone after unmount. Reset per item.
  const advancingRef = useRef(false);
  useEffect(() => {
    advancingRef.current = false;
  }, [index]);

  // Defensive: if the queue ever shrinks past the cursor, finish cleanly
  // instead of rendering an empty modal forever.
  useEffect(() => {
    if (index >= items.length) onDone();
  }, [index, items.length, onDone]);

  const advance = () => {
    if (advancingRef.current) return;
    advancingRef.current = true;
    if (index + 1 < items.length) setIndex((i) => i + 1);
    else onDone();
  };

  if (!item) return null;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={advance}>
      <Pressable style={styles.backdrop} onPress={advance}>
        {/* key forces a fresh production for each queued item. */}
        <CelebrationCard key={index} item={item} onCta={advance} />
      </Pressable>
    </Modal>
  );
}

const RAY_COUNT = 12;
const RAY_FIELD = 300;

function CelebrationCard({
  item,
  onCta,
}: {
  item: NewlyUnlocked;
  onCta: () => void;
}) {
  const tierColor = TIER_META[item.tier].color;

  const cardScale = useSharedValue(0.7);
  const cardOpacity = useSharedValue(0);
  const badgeScale = useSharedValue(0.1);
  const badgeSpin = useSharedValue(-180);
  const textIn = useSharedValue(0);
  const rayspin = useSharedValue(0);
  const glow = useSharedValue(0.6);
  // Two shockwave rings + a couple of sparkles, all looping.
  const wave1 = useSharedValue(0);
  const wave2 = useSharedValue(0);
  const spark = useSharedValue(0);

  // A second confetti burst a beat after the first for a sustained pop.
  const [secondBurst, setSecondBurst] = useState(false);

  useEffect(() => {
    successHaptic();
    // Card pops in.
    cardOpacity.value = withTiming(1, { duration: 160 });
    cardScale.value = withSpring(1, { damping: 11, stiffness: 140 });
    // Medal flies in: spin to upright + overshoot scale, then settle into a
    // slow continuous breathing.
    badgeSpin.value = withSpring(0, { damping: 9, stiffness: 90 });
    badgeScale.value = withSequence(
      withSpring(1.18, { damping: 6, stiffness: 150 }),
      withSpring(1, { damping: 8, stiffness: 120 }),
      withDelay(
        200,
        withRepeat(
          withSequence(
            withTiming(1.05, { duration: 900, easing: Easing.inOut(Easing.quad) }),
            withTiming(1, { duration: 900, easing: Easing.inOut(Easing.quad) }),
          ),
          -1,
          false,
        ),
      ),
    );
    // Text rises in after the medal lands.
    textIn.value = withDelay(260, withTiming(1, { duration: 320, easing: Easing.out(Easing.cubic) }));
    // Rays rotate forever.
    rayspin.value = withRepeat(
      withTiming(1, { duration: 9000, easing: Easing.linear }),
      -1,
      false,
    );
    // Glow breathes.
    glow.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 700, easing: Easing.inOut(Easing.quad) }),
        withTiming(0.55, { duration: 700, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      true,
    );
    // Shockwave rings, staggered.
    wave1.value = withRepeat(withTiming(1, { duration: 1500, easing: Easing.out(Easing.quad) }), -1, false);
    wave2.value = withDelay(
      750,
      withRepeat(withTiming(1, { duration: 1500, easing: Easing.out(Easing.quad) }), -1, false),
    );
    // Sparkle twinkle.
    spark.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 600, easing: Easing.inOut(Easing.quad) }),
        withTiming(0.2, { duration: 600, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      true,
    );

    const h = setTimeout(() => lightHaptic(), 180);
    const h2 = setTimeout(() => successHaptic(), 620);
    const b = setTimeout(() => setSecondBurst(true), 600);
    return () => {
      clearTimeout(h);
      clearTimeout(h2);
      clearTimeout(b);
      // Stop the infinite loops on unmount / queue advance (matches the
      // codebase convention; avoids stray work after the card is gone).
      [badgeScale, rayspin, glow, wave1, wave2, spark].forEach(cancelAnimation);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cardStyle = useAnimatedStyle(() => ({
    opacity: cardOpacity.value,
    transform: [{ scale: cardScale.value }],
  }));
  const badgeStyle = useAnimatedStyle(() => ({
    transform: [{ scale: badgeScale.value }, { rotate: `${badgeSpin.value}deg` }],
  }));
  const textStyle = useAnimatedStyle(() => ({
    opacity: textIn.value,
    transform: [{ translateY: (1 - textIn.value) * 14 }],
  }));
  const raysStyle = useAnimatedStyle(() => ({
    opacity: 0.9,
    transform: [{ rotate: `${rayspin.value * 360}deg` }],
  }));
  const glowStyle = useAnimatedStyle(() => ({
    opacity: 0.12 + glow.value * 0.18,
    transform: [{ scale: 0.9 + glow.value * 0.25 }],
  }));
  const wave1Style = useAnimatedStyle(() => ({
    opacity: (1 - wave1.value) * 0.5,
    transform: [{ scale: 0.4 + wave1.value * 1.9 }],
  }));
  const wave2Style = useAnimatedStyle(() => ({
    opacity: (1 - wave2.value) * 0.5,
    transform: [{ scale: 0.4 + wave2.value * 1.9 }],
  }));

  const tierHe = TIER_META[item.tier].he;
  const headline = item.def.oneOff
    ? he.achievementCelebrateOneOff
    : he.achievementCelebrateTier(tierHe);

  // Sparkle positions around the medal.
  const sparkAt = [
    { top: 6, left: 30 },
    { top: 24, right: 18 },
    { bottom: 18, left: 14 },
    { bottom: 4, right: 36 },
  ];

  return (
    <Animated.View style={[styles.stageCard, cardStyle]} pointerEvents="box-none">
      {/* Confetti + flying balls fill the whole screen, not a box. */}
      <View style={styles.burst} pointerEvents="none">
        <CelebrationOverlay ballCount={12} spread={320} durationMs={1800} />
        {secondBurst ? (
          <CelebrationOverlay ballCount={9} spread={260} durationMs={1500} />
        ) : null}
      </View>

      <Animated.Text style={[styles.kicker, textStyle]} pointerEvents="none">
        {he.achievementCelebrateKicker}
      </Animated.Text>

      {/* Medal stage — rays + glow + shockwaves behind the badge, all
          floating in the air (no card behind them). */}
      <View style={styles.stage} pointerEvents="none">
        <Animated.View style={[styles.rays, raysStyle]} pointerEvents="none">
          {Array.from({ length: RAY_COUNT }).map((_, i) => (
            <View
              key={i}
              style={[
                styles.rayWrap,
                { transform: [{ rotate: `${(360 / RAY_COUNT) * i}deg` }] },
              ]}
            >
              <View style={[styles.ray, { backgroundColor: tierColor }]} />
            </View>
          ))}
        </Animated.View>

        <Animated.View
          style={[styles.glow, { backgroundColor: tierColor }, glowStyle]}
          pointerEvents="none"
        />
        <Animated.View
          style={[styles.wave, { borderColor: tierColor }, wave1Style]}
          pointerEvents="none"
        />
        <Animated.View
          style={[styles.wave, { borderColor: tierColor }, wave2Style]}
          pointerEvents="none"
        />

        {sparkAt.map((pos, i) => (
          <Sparkle key={i} progress={spark} color={tierColor} pos={pos} delayIdx={i} />
        ))}

        <Animated.View style={badgeStyle}>
          <AchievementBadge def={item.def} tier={item.tier} size={132} hideTitle />
        </Animated.View>
      </View>

      <Animated.View style={[styles.textWrap, textStyle]} pointerEvents="none">
        <Text style={styles.title}>{item.def.titleHe}</Text>
        <Text style={[styles.tier, { color: tierColor }]}>{headline}</Text>
      </Animated.View>

      <Pressable style={styles.cta} onPress={onCta}>
        <Text style={styles.ctaText}>{he.achievementCelebrateCta}</Text>
      </Pressable>
    </Animated.View>
  );
}

function Sparkle({
  progress,
  color,
  pos,
  delayIdx,
}: {
  progress: Animated.SharedValue<number>;
  color: string;
  pos: { top?: number; bottom?: number; left?: number; right?: number };
  delayIdx: number;
}) {
  const style = useAnimatedStyle(() => {
    // Alternate phase so sparkles don't blink in unison.
    const p = delayIdx % 2 === 0 ? progress.value : 1 - progress.value;
    return { opacity: 0.25 + p * 0.75, transform: [{ scale: 0.6 + p * 0.7 }] };
  });
  return (
    <Animated.View style={[styles.spark, pos, style]} pointerEvents="none">
      <Ionicons name="sparkles" size={18} color={color} />
    </Animated.View>
  );
}

const STAGE = 200;

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(6,10,20,0.86)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  // No box — the whole production floats over the dimmed screen.
  stageCard: {
    alignItems: 'center',
    alignSelf: 'stretch',
    gap: spacing.md,
  },
  burst: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  kicker: {
    ...typography.h2,
    color: '#FFFFFF',
    fontWeight: '900',
    letterSpacing: 0.5,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
  stage: {
    width: STAGE,
    height: STAGE,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: spacing.sm,
  },
  rays: {
    position: 'absolute',
    width: RAY_FIELD,
    height: RAY_FIELD,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rayWrap: {
    position: 'absolute',
    width: RAY_FIELD,
    height: RAY_FIELD,
    alignItems: 'center',
  },
  ray: {
    width: 10,
    height: RAY_FIELD / 2,
    borderRadius: 6,
    opacity: 0.16,
  },
  glow: {
    position: 'absolute',
    width: 160,
    height: 160,
    borderRadius: 80,
  },
  wave: {
    position: 'absolute',
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 3,
  },
  spark: {
    position: 'absolute',
  },
  textWrap: { alignItems: 'center', gap: 4 },
  title: {
    ...typography.h1,
    color: '#FFFFFF',
    fontWeight: '900',
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.55)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 10,
  },
  tier: {
    ...typography.h3,
    fontWeight: '900',
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.45)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
  // Floating glassy pill rather than a solid button — keeps the airy feel.
  cta: {
    marginTop: spacing.sm,
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.55)',
    borderRadius: 999,
    paddingVertical: 13,
    paddingHorizontal: 48,
  },
  ctaText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
  },
});
