// NextGameCard — single tappable card showing the soonest upcoming
// open game in the community, or a muted empty state when none is
// scheduled. The full match flow lives elsewhere; this card is a
// signpost to it.

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';

interface Props {
  /** ms epoch — undefined when no upcoming game exists. */
  startsAt?: number;
  /** Game id — required if startsAt is provided. */
  gameId?: string;
  onPress?: () => void;
}

export function NextGameCard({ startsAt, gameId, onPress }: Props) {
  const hasGame = !!gameId && typeof startsAt === 'number';
  const content = (
    <View style={styles.cardInner}>
      <View style={styles.iconWrap}>
        <Ionicons
          name="calendar"
          size={18}
          color={hasGame ? colors.primary : colors.textMuted}
        />
      </View>
      <View style={styles.body}>
        <Text style={styles.title}>{he.communityNextGameTitle}</Text>
        <Text
          style={[
            styles.subtitle,
            hasGame ? styles.subtitleActive : styles.subtitleMuted,
          ]}
          numberOfLines={1}
        >
          {hasGame ? formatWhen(startsAt!) : he.communityNextGameNone}
        </Text>
      </View>
      {hasGame ? (
        <View style={styles.cta}>
          <Text style={styles.ctaText}>{he.communityNextGameCta}</Text>
          <Ionicons name="chevron-back" size={16} color={colors.primary} />
        </View>
      ) : null}
    </View>
  );

  if (!hasGame || !onPress) {
    return <View style={styles.card}>{content}</View>;
  }
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}
      accessibilityRole="button"
      accessibilityLabel={he.communityNextGameCta}
    >
      {content}
    </Pressable>
  );
}

function formatWhen(ms: number): string {
  const d = new Date(ms);
  const days = [
    'יום ראשון',
    'יום שני',
    'יום שלישי',
    'יום רביעי',
    'יום חמישי',
    'יום שישי',
    'שבת',
  ];
  const day = days[d.getDay()];
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mn = String(d.getMinutes()).padStart(2, '0');
  return `${day} · ${dd}/${mm} · ${hh}:${mn}`;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  cardInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
    gap: 2,
  },
  title: {
    ...typography.body,
    color: colors.text,
    fontWeight: '700',
    textAlign: RTL_LABEL_ALIGN,
  },
  subtitle: {
    ...typography.caption,
    textAlign: RTL_LABEL_ALIGN,
  },
  subtitleActive: { color: colors.textMuted },
  subtitleMuted: { color: colors.textMuted, fontStyle: 'italic' },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  ctaText: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '700',
  },
  // reserved
  _r: { borderRadius: radius.lg },
});
