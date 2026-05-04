// MatchPlayersList — inline full-width list of registered players
// for the redesigned MatchDetailsScreen. Replaces the compact
// "5 jerseys + see all" preview card; the screen now lets the
// players section claim all the remaining vertical space.
//
// Each row: jersey + name + admin badge + arrow chevron. Tapping a
// row opens that user's PlayerCard. Empty state is a single muted
// line so the section doesn't collapse into nothing on a fresh
// game.

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '@/components/Card';
import { PlayerIdentity } from '@/components/PlayerIdentity';
import type { User } from '@/types';
import { colors, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';

export interface MatchPlayersListMember {
  user: Pick<User, 'id' | 'name' | 'jersey'>;
  isAdmin: boolean;
}

interface Props {
  total: number;
  capacity: number;
  members: MatchPlayersListMember[];
  onPressMember: (uid: string) => void;
}

export function MatchPlayersList({
  total,
  capacity,
  members,
  onPressMember,
}: Props) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>
        {he.matchPlayersTitle}{' '}
        <Text style={styles.count}>
          ({total}/{capacity})
        </Text>
      </Text>
      <Card style={styles.listCard}>
        {members.map((m, i) => (
          <Pressable
            key={m.user.id}
            onPress={() => onPressMember(m.user.id)}
            style={({ pressed }) => [
              styles.row,
              i > 0 && styles.rowDivider,
              pressed && { backgroundColor: colors.surfaceMuted },
            ]}
            accessibilityRole="button"
            accessibilityLabel={m.user.name}
          >
            <PlayerIdentity user={m.user} size="sm" />
            <View style={styles.body}>
              <Text style={styles.name} numberOfLines={1}>
                {m.user.name}
              </Text>
              {m.isAdmin ? (
                <View style={styles.adminBadge}>
                  <Text style={styles.adminBadgeText}>
                    {he.matchPlayersAdminTag}
                  </Text>
                </View>
              ) : null}
            </View>
            <Ionicons
              name="chevron-back"
              size={16}
              color={colors.textMuted}
            />
          </Pressable>
        ))}
        {/* Ghost rows for the open spots — give the section visible
            structure even when only 1–2 people are registered, and
            telegraph "join us" without a separate empty state. */}
        {Array.from({
          length: Math.max(0, capacity - members.length),
        }).map((_, i) => (
          <View
            key={`empty-${i}`}
            style={[
              styles.row,
              styles.emptyRow,
              members.length + i > 0 && styles.rowDivider,
            ]}
          >
            <View style={styles.emptyAvatar}>
              <Ionicons
                name="add"
                size={16}
                color={colors.textMuted}
              />
            </View>
            <Text style={styles.emptyLabel}>{he.matchPlayersOpenSlot}</Text>
          </View>
        ))}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
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
  listCard: { padding: 0, overflow: 'hidden' },
  // Ghost row visuals — dashed circle + muted "open slot" label.
  // Subtle enough not to look like real players, structured enough
  // to fill the section.
  emptyRow: {
    backgroundColor: 'transparent',
  },
  emptyAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.border,
  },
  emptyLabel: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'right',
    flex: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.lg,
  },
  rowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
  },
  body: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  name: {
    ...typography.body,
    color: colors.text,
    fontWeight: '700',
    textAlign: RTL_LABEL_ALIGN,
    flexShrink: 1,
  },
  adminBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: colors.primaryLight,
  },
  adminBadgeText: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '700',
    fontSize: 11,
  },
});
