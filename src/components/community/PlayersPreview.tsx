// PlayersPreview — replaces the inline full members list. Shows up
// to 5 jersey circles plus a "+N" overflow chip and a "see all" CTA.
// The whole card is one tap target — opens the new
// CommunityPlayersScreen.

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { PlayerIdentity } from '@/components/PlayerIdentity';
import type { User } from '@/types';
import { colors, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';

interface Props {
  /** Total members count (used in the title and the +N chip). */
  total: number;
  /** Hydrated subset to render — first MAX_VISIBLE entries are shown. */
  members: Array<Pick<User, 'id' | 'name' | 'jersey'>>;
  onPress: () => void;
}

const MAX_VISIBLE = 5;
const JERSEY_SIZE = 48;

export function PlayersPreview({ total, members, onPress }: Props) {
  const visible = members.slice(0, MAX_VISIBLE);
  const overflow = Math.max(0, total - visible.length);
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}
      accessibilityRole="button"
    >
      <View style={styles.headerRow}>
        <Text style={styles.title}>
          {he.communityPlayersTitle}{' '}
          <Text style={styles.count}>({total})</Text>
        </Text>
        <View style={styles.cta}>
          <Text style={styles.ctaText}>{he.communityPlayersSeeAll}</Text>
          <Ionicons name="chevron-back" size={16} color={colors.primary} />
        </View>
      </View>
      {visible.length === 0 ? (
        <Text style={styles.empty}>{he.communityPlayersEmpty}</Text>
      ) : (
        <View style={styles.row}>
          {visible.map((m) => (
            <View key={m.id} style={styles.cell}>
              <PlayerIdentity user={m} size={JERSEY_SIZE} />
            </View>
          ))}
          {overflow > 0 ? (
            <View style={styles.overflow}>
              <Text style={styles.overflowText}>+{overflow}</Text>
            </View>
          ) : null}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  title: {
    ...typography.body,
    color: colors.text,
    fontWeight: '700',
    textAlign: RTL_LABEL_ALIGN,
  },
  count: {
    color: colors.textMuted,
    fontWeight: '500',
  },
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flexWrap: 'wrap',
  },
  cell: {
    // Tighten each jersey cell so 5 fit comfortably on the smallest
    // phones (~360 dp) with overflow chip room to spare.
    width: JERSEY_SIZE + 4,
    alignItems: 'center',
  },
  overflow: {
    width: JERSEY_SIZE,
    height: JERSEY_SIZE,
    borderRadius: JERSEY_SIZE / 2,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
    marginStart: spacing.xs,
  },
  overflowText: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '700',
    fontSize: 13,
  },
  empty: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
  },
});
