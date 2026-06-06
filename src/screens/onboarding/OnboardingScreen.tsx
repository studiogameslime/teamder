// Pre-sign-in onboarding — 3 quick slides over a full-screen blue
// gradient (matching the Matches / Communities tabs the user lands
// on after signing in). The earlier 4-slide green palette didn't
// match anywhere else in the app and felt slow; this trims to the
// 3 highest-signal pitches and uses the same brand tones as the
// rest of the redesigned surfaces.

import React, { useEffect, useRef, useState } from 'react';
import {
  Dimensions,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  ViewToken,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { spacing, typography } from '@/theme';
import { he } from '@/i18n/he';
import { useUserStore } from '@/store/userStore';

interface Slide {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
}

const SLIDES: Slide[] = [
  { icon: 'location-outline', title: he.onb1Title, body: he.onb1Body },
  { icon: 'people-outline', title: he.onb2Title, body: he.onb2Body },
  { icon: 'sync-outline', title: he.onb3Title, body: he.onb3Body },
];

const { width } = Dimensions.get('window');

// Blue brand stack — same tones as the redesigned Matches /
// Communities heroes. Hardcoded here (not via colors.primary) so we
// don't pollute the green legacy primary that 100+ other places
// still depend on.
const GRADIENT = ['#0F172A', '#1E3A8A', '#1E40AF'] as const;
const DOT_INACTIVE = 'rgba(255,255,255,0.32)';
const DOT_ACTIVE = '#FFFFFF';

export function OnboardingScreen() {
  const completeOnboarding = useUserStore((s) => s.completeOnboarding);
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const ref = useRef<FlatList<Slide>>(null);

  const onViewable = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      if (viewableItems[0]?.index != null) setIndex(viewableItems[0].index);
    },
  ).current;

  const isLast = index >= SLIDES.length - 1;

  const advance = () => {
    if (!isLast) {
      ref.current?.scrollToIndex({ index: index + 1, animated: true });
    }
  };

  // The onboarding slides are purely informational — sign-in lives on a
  // single dedicated screen (SignInScreen). Finishing onboarding flips
  // `onboardingDone`, and RootNavigator then shows that one sign-in
  // screen (Google + Apple). This avoids the old duplication where both
  // the last slide AND the sign-in screen carried login buttons.
  const handleStart = async () => {
    setBusy(true);
    try {
      await completeOnboarding();
    } catch {
      // no-op
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.root}>
      <LinearGradient
        colors={GRADIENT}
        start={{ x: 0, y: 0 }}
        end={{ x: 0.6, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.skipRow}>
          {!isLast ? (
            <Pressable onPress={completeOnboarding} hitSlop={12}>
              <Text style={styles.skip}>{he.onbSkip}</Text>
            </Pressable>
          ) : null}
        </View>

        <FlatList
          ref={ref}
          data={SLIDES}
          keyExtractor={(_, i) => String(i)}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          inverted
          onViewableItemsChanged={onViewable}
          viewabilityConfig={{ itemVisiblePercentThreshold: 60 }}
          renderItem={({ item, index: i }) => (
            <View style={[styles.slide, { width }]}>
              <BreathingIconDisc icon={item.icon} active={i === index} />
              <Text style={styles.title}>{item.title}</Text>
              <Text style={styles.body}>{item.body}</Text>
            </View>
          )}
        />

        <View style={styles.dots}>
          {SLIDES.map((_, i) => (
            <Dot key={i} active={i === index} />
          ))}
        </View>

        <View style={styles.cta}>
          {/* White CTA on the blue gradient. The last slide leads to the
              dedicated sign-in screen (one place for Google + Apple). */}
          {isLast ? (
            <Pressable
              onPress={handleStart}
              disabled={busy}
              style={({ pressed }) => [
                styles.ctaBtn,
                pressed && { opacity: 0.92 },
                busy && { opacity: 0.6 },
              ]}
              accessibilityRole="button"
              accessibilityLabel={he.onbCtaStart}
            >
              <Text style={styles.ctaBtnText}>{he.onbCtaStart}</Text>
            </Pressable>
          ) : null}
          {!isLast ? (
            <Pressable
              onPress={advance}
              style={({ pressed }) => [
                styles.ctaBtn,
                pressed && { opacity: 0.92 },
              ]}
              accessibilityRole="button"
              accessibilityLabel={he.onbNext}
            >
              <Text style={styles.ctaBtnText}>{he.onbNext}</Text>
            </Pressable>
          ) : null}
        </View>
      </SafeAreaView>
    </View>
  );
}

// Breathing icon disc — the active slide's disc pulses gently
// (scale 1 ↔ 1.04) so the user's eye lands on it instead of darting
// around. Inactive slides hold a static smaller scale (0.94) so the
// transition between slides reads as "this one wakes up". Animation
// is cancelled when the slide goes inactive to avoid wasted UI-thread
// work on the off-screen slides.
function BreathingIconDisc({
  icon,
  active,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  active: boolean;
}) {
  const scale = useSharedValue(active ? 1 : 0.94);

  useEffect(() => {
    cancelAnimation(scale);
    if (active) {
      scale.value = withSequence(
        withTiming(1, { duration: 260, easing: Easing.out(Easing.cubic) }),
        withRepeat(
          withSequence(
            withTiming(1.04, {
              duration: 1400,
              easing: Easing.inOut(Easing.quad),
            }),
            withTiming(1.0, {
              duration: 1400,
              easing: Easing.inOut(Easing.quad),
            }),
          ),
          -1,
          false,
        ),
      );
    } else {
      scale.value = withTiming(0.94, { duration: 220 });
    }
    return () => cancelAnimation(scale);
  }, [active, scale]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Animated.View style={[styles.iconDisc, animStyle]}>
      <Ionicons name={icon} size={92} color="#FFFFFF" />
    </Animated.View>
  );
}

// Pagination dot. Width + opacity smoothly interpolate when the
// active flag flips, so swiping between slides feels continuous
// instead of jumping between hard-coded styles.
function Dot({ active }: { active: boolean }) {
  const progress = useSharedValue(active ? 1 : 0);

  useEffect(() => {
    progress.value = withTiming(active ? 1 : 0, {
      duration: 240,
      easing: Easing.out(Easing.cubic),
    });
  }, [active, progress]);

  const animStyle = useAnimatedStyle(() => ({
    width: 8 + progress.value * 16,
    opacity: 0.32 + progress.value * 0.68,
  }));

  return (
    <Animated.View
      style={[
        styles.dot,
        { backgroundColor: DOT_ACTIVE },
        animStyle,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0F172A' },
  safe: { flex: 1 },
  skipRow: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    minHeight: 40,
  },
  // Bigger + slightly more padded tap target. The original `דלג`
  // pill was 28dp tall and the text size matched `typography.label`
  // (~13sp), which made it feel cramped and easy to mis-tap. Bumping
  // to 40dp tall + label-bold + 14sp gives it visual weight without
  // pulling focus from the slide content.
  skip: {
    ...typography.label,
    color: 'rgba(255,255,255,0.88)',
    fontWeight: '700',
    fontSize: 14,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.10)',
    overflow: 'hidden',
  },
  slide: {
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
  },
  // Frosted disc — mirrors the icon discs on the Matches /
  // Communities heroes for a cross-app visual rhyme.
  iconDisc: {
    width: 168,
    height: 168,
    borderRadius: 84,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.28)',
    marginBottom: spacing.xl,
  },
  title: {
    ...typography.h1,
    color: '#FFFFFF',
    textAlign: 'center',
    marginBottom: spacing.md,
    fontSize: 28,
    letterSpacing: 0.3,
  },
  body: {
    ...typography.body,
    color: 'rgba(255,255,255,0.82)',
    textAlign: 'center',
    lineHeight: 26,
    fontSize: 16,
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.lg,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: DOT_INACTIVE,
  },
  dotActive: {
    backgroundColor: DOT_ACTIVE,
    width: 24,
  },
  cta: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    gap: spacing.sm,
  },
  ctaBtn: {
    backgroundColor: '#FFFFFF',
    borderRadius: 999,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 14,
    elevation: 4,
  },
  ctaBtnText: {
    color: '#1E40AF',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
});
