// AchievementCelebration — the full-screen "you earned a title" moment.
//
// Pass a queue of newly-unlocked tiers; it shows them one at a time over a
// dimmed backdrop: the badge springs in, confetti + soccer balls burst
// (CelebrationOverlay), and a congrats line names the tier. Tap / button /
// a short auto-timer advances to the next, then calls onDone.

import React, { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { AchievementBadge } from '@/components/AchievementBadge';
import { CelebrationOverlay } from '@/components/anim/CelebrationOverlay';
import { TIER_META } from '@/data/achievements';
import type { NewlyUnlocked } from '@/services/achievementsService';
import { colors, spacing, typography } from '@/theme';
import { he } from '@/i18n/he';
import { lightHaptic, successHaptic } from '@/utils/haptics';

interface Props {
  items: NewlyUnlocked[];
  onDone: () => void;
}

export function AchievementCelebration({ items, onDone }: Props) {
  const [index, setIndex] = useState(0);
  const item = items[index];

  const advance = () => {
    if (index + 1 < items.length) setIndex((i) => i + 1);
    else onDone();
  };

  if (!item) return null;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={advance}>
      <Pressable style={styles.backdrop} onPress={advance}>
        {/* key forces a fresh spring + confetti for each queued item. */}
        <CelebrationCard key={index} item={item} onCta={advance} />
      </Pressable>
    </Modal>
  );
}

function CelebrationCard({
  item,
  onCta,
}: {
  item: NewlyUnlocked;
  onCta: () => void;
}) {
  const scale = useSharedValue(0.2);
  const opacity = useSharedValue(0);

  useEffect(() => {
    successHaptic();
    opacity.value = withTiming(1, { duration: 180 });
    scale.value = withSequence(
      withSpring(1.12, { damping: 7, stiffness: 140 }),
      withSpring(1, { damping: 9, stiffness: 130 }),
    );
    // A second little buzz as the badge lands.
    const t = setTimeout(() => lightHaptic(), 180);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const badgeStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));
  const textStyle = useAnimatedStyle(() => ({
    opacity: withDelay(220, withTiming(opacity.value, { duration: 200 })),
  }));

  const tierHe = TIER_META[item.tier].he;
  const headline = item.def.oneOff
    ? he.achievementCelebrateOneOff
    : he.achievementCelebrateTier(tierHe);

  return (
    <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
      <View style={styles.burst} pointerEvents="none">
        <CelebrationOverlay ballCount={9} spread={220} durationMs={1600} />
      </View>
      <Text style={styles.kicker}>{he.achievementCelebrateKicker}</Text>
      <Animated.View style={badgeStyle}>
        <AchievementBadge def={item.def} tier={item.tier} size={120} hideTitle />
      </Animated.View>
      <Animated.View style={[styles.textWrap, textStyle]}>
        <Text style={styles.title}>{item.def.titleHe}</Text>
        <Text style={[styles.tier, { color: TIER_META[item.tier].color }]}>
          {headline}
        </Text>
      </Animated.View>
      <Pressable style={styles.cta} onPress={onCta}>
        <Text style={styles.ctaText}>{he.achievementCelebrateCta}</Text>
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(8,12,24,0.78)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  card: {
    alignItems: 'center',
    alignSelf: 'stretch',
    maxWidth: 360,
    backgroundColor: colors.bg,
    borderRadius: 24,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  burst: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  kicker: {
    ...typography.body,
    color: colors.textMuted,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  textWrap: { alignItems: 'center', gap: 2 },
  title: {
    ...typography.h2,
    color: colors.text,
    fontWeight: '900',
    textAlign: 'center',
  },
  tier: {
    ...typography.h3,
    fontWeight: '900',
    textAlign: 'center',
  },
  cta: {
    marginTop: spacing.sm,
    backgroundColor: colors.primary,
    borderRadius: 999,
    paddingVertical: 12,
    paddingHorizontal: 40,
  },
  ctaText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
  },
});
