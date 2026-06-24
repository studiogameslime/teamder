// DidYouKnowCard — a rotating "ידעת ש..." feature-discovery tip on the home
// screen. Cycles through short benefit blurbs (auto-advance every few seconds),
// with a dots indicator and a lightbulb. Tapping the card jumps to the feature
// the current tip is about.

import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';

export interface Tip {
  text: string;
  onPress?: () => void;
}

const ROTATE_MS = 6000;

export function DidYouKnowCard({ tips }: { tips: Tip[] }) {
  const [idx, setIdx] = useState(0);
  const idxRef = useRef(0);
  idxRef.current = idx;

  useEffect(() => {
    if (tips.length <= 1) return;
    const h = setInterval(() => {
      setIdx((i) => (i + 1) % tips.length);
    }, ROTATE_MS);
    return () => clearInterval(h);
  }, [tips.length]);

  if (tips.length === 0) return null;
  const tip = tips[Math.min(idx, tips.length - 1)];

  return (
    <Pressable
      onPress={tip.onPress}
      style={({ pressed }) => [styles.card, pressed && tip.onPress && { opacity: 0.9 }]}
      accessibilityRole="button"
    >
      <View style={styles.iconDisc}>
        <Ionicons name="bulb-outline" size={22} color="#6366F1" />
      </View>
      <View style={styles.textWrap}>
        <Text style={styles.title}>{he.homeDidYouKnowTitle}</Text>
        <Text style={styles.body} numberOfLines={2}>
          {tip.text}
        </Text>
        {tips.length > 1 ? (
          <View style={styles.dots}>
            {tips.map((_, i) => (
              <View
                key={i}
                style={[styles.dot, i === idx && styles.dotActive]}
              />
            ))}
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: '#EEF2FF',
    borderRadius: 18,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  iconDisc: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#E0E7FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  textWrap: { flex: 1, gap: 2 },
  title: {
    ...typography.body,
    color: '#4338CA',
    fontWeight: '900',
    textAlign: RTL_LABEL_ALIGN,
  },
  body: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
  },
  dots: {
    flexDirection: 'row',
    gap: 5,
    marginTop: 6,
    alignSelf: 'flex-start',
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#C7D2FE',
  },
  dotActive: { backgroundColor: '#6366F1', width: 16 },
});
