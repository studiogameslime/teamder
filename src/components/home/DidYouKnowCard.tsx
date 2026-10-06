// DidYouKnowCard — the rotating "ידעת ש..." tip at the foot of the home
// screen. Short benefit blurbs that advance on their own, a dots indicator,
// and a tap that jumps to the feature the current tip is about.
//
// This is the ONE rotating surface on the screen, and it is allowed to be:
// the tips are a set with no order and no urgency, so cycling them costs the
// reader nothing. Everything else on this screen states a single fact and
// gets a single card.
//
// The rotation itself is unchanged — same interval, same order, same tips
// from the screen. Only the surface around it was redrawn.
//
// A faded clipboard glyph was tried in the trailing corner as texture. On the
// device it read as a stray white shape rather than decoration, so it is not
// here: the card is the lamp, the words and the dots.

import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

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
      style={({ pressed }) => [styles.card, pressed && tip.onPress && { opacity: 0.92 }]}
      accessibilityRole={tip.onPress ? 'button' : 'summary'}
      accessibilityLabel={`${he.homeDidYouKnowTitle} ${tip.text}`}
    >
      <LinearGradient
        colors={['#EEF2FF', '#E7E9FE']}
        start={{ x: 1, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      {/* First child → visual RIGHT: the lamp, then the words, which is the
          order a Hebrew reader takes them in. */}
      <View style={styles.iconDisc}>
        <Ionicons name="bulb" size={20} color="#6366F1" />
      </View>

      <View style={styles.textWrap}>
        <Text style={styles.title}>{he.homeDidYouKnowTitle}</Text>
        <Text style={styles.body} numberOfLines={2}>
          {tip.text}
        </Text>
        {tips.length > 1 ? (
          <View style={styles.dots}>
            {tips.map((_, i) => (
              <View key={i} style={[styles.dot, i === idx && styles.dotActive]} />
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
    borderRadius: 20,
    overflow: 'hidden',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#D9DDFB',
  },
  iconDisc: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  textWrap: { flex: 1, minWidth: 0, gap: 2 },
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
  dots: { flexDirection: 'row', gap: 5, marginTop: 6, alignSelf: 'flex-start' },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#C7D2FE' },
  dotActive: { backgroundColor: '#6366F1', width: 16 },
});
