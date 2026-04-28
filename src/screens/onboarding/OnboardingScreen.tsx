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
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { colors, radius, spacing, typography } from '@/theme';
import { he } from '@/i18n/he';
import { useUserStore } from '@/store/userStore';

interface Slide {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
}

const SLIDES: Slide[] = [
  { icon: 'flash-outline',     title: he.onb1Title, body: he.onb1Body },
  { icon: 'list-outline',      title: he.onb2Title, body: he.onb2Body },
  { icon: 'people-circle-outline', title: he.onb3Title, body: he.onb3Body },
  { icon: 'phone-portrait-outline', title: he.onb4Title, body: he.onb4Body },
];

const { width } = Dimensions.get('window');

export function OnboardingScreen() {
  const completeOnboarding = useUserStore((s) => s.completeOnboarding);
  const [index, setIndex] = useState(0);
  const ref = useRef<FlatList<Slide>>(null);

  const onViewable = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    if (viewableItems[0]?.index != null) setIndex(viewableItems[0].index);
  }).current;

  const isLast = index >= SLIDES.length - 1;
  const advance = () => {
    if (isLast) {
      completeOnboarding();
    } else {
      ref.current?.scrollToIndex({ index: index + 1, animated: true });
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.skipRow}>
        <Pressable onPress={completeOnboarding} hitSlop={12}>
          <Text style={styles.skip}>{he.onbSkip}</Text>
        </Pressable>
      </View>

      <FlatList
        ref={ref}
        data={SLIDES}
        keyExtractor={(_, i) => String(i)}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        // RTL note: with I18nManager.forceRTL the viewport flips. We invert
        // the data direction so swipe right→left reveals the next slide.
        inverted
        onViewableItemsChanged={onViewable}
        viewabilityConfig={{ itemVisiblePercentThreshold: 60 }}
        renderItem={({ item }) => (
          <View style={[styles.slide, { width }]}>
            <View style={styles.iconCircle}>
              <Ionicons name={item.icon} size={64} color={colors.primary} />
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
              i === index && { backgroundColor: colors.primary, width: 24 },
            ]}
          />
        ))}
      </View>

      <View style={styles.cta}>
        <Button
          title={isLast ? he.onbStart : he.onbNext}
          variant="primary"
          size="lg"
          onPress={advance}
          fullWidth
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  skipRow: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  skip: { ...typography.label, color: colors.textMuted },
  slide: {
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
  },
  iconCircle: {
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xl,
  },
  title: { ...typography.h1, color: colors.text, textAlign: 'center', marginBottom: spacing.md },
  body: { ...typography.body, color: colors.textMuted, textAlign: 'center' },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.lg,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.border,
  },
  cta: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
});
