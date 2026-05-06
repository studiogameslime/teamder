// Pre-sign-in onboarding — 3 quick slides over a full-screen blue
// gradient (matching the Matches / Communities tabs the user lands
// on after signing in). The earlier 4-slide green palette didn't
// match anywhere else in the app and felt slow; this trims to the
// 3 highest-signal pitches and uses the same brand tones as the
// rest of the redesigned surfaces.

import React, { useRef, useState } from 'react';
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

import { spacing, typography } from '@/theme';
import { he } from '@/i18n/he';
import { useUserStore } from '@/store/userStore';

interface Slide {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
}

const SLIDES: Slide[] = [
  { icon: 'search-outline', title: he.onb1Title, body: he.onb1Body },
  { icon: 'add-circle-outline', title: he.onb2Title, body: he.onb2Body },
  { icon: 'football-outline', title: he.onb3Title, body: he.onb3Body },
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
  const signInWithGoogle = useUserStore((s) => s.signInWithGoogle);
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

  const handleSignIn = async () => {
    setBusy(true);
    try {
      await completeOnboarding();
      await signInWithGoogle();
    } catch {
      // sign-in failure is surfaced by the existing flow further up
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
          renderItem={({ item }) => (
            <View style={[styles.slide, { width }]}>
              <View style={styles.iconDisc}>
                <Ionicons name={item.icon} size={92} color="#FFFFFF" />
              </View>
              <Text style={styles.title}>{item.title}</Text>
              <Text style={styles.body}>{item.body}</Text>
            </View>
          )}
        />

        <View style={styles.dots}>
          {SLIDES.map((_, i) => (
            <View
              key={i}
              style={[
                styles.dot,
                i === index && styles.dotActive,
              ]}
            />
          ))}
        </View>

        <View style={styles.cta}>
          {/* White CTAs on a blue gradient — high contrast and
              brand-agnostic so the Google "G" reads cleanly. The
              <Button> component bakes in the legacy green palette,
              so we render a thin Pressable here directly. */}
          {isLast ? (
            <Pressable
              onPress={handleSignIn}
              disabled={busy}
              style={({ pressed }) => [
                styles.ctaBtn,
                pressed && { opacity: 0.92 },
                busy && { opacity: 0.6 },
              ]}
              accessibilityRole="button"
              accessibilityLabel={he.onbCtaSignIn}
            >
              <Ionicons name="logo-google" size={20} color="#1E40AF" />
              <Text style={styles.ctaBtnText}>{he.onbCtaSignIn}</Text>
            </Pressable>
          ) : (
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
          )}
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0F172A' },
  safe: { flex: 1 },
  skipRow: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    minHeight: 28,
  },
  skip: {
    ...typography.label,
    color: 'rgba(255,255,255,0.78)',
    fontWeight: '600',
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
