// MatchParticipantsSection — header + tappable list of registered
// players. Replaces both the old preview (jersey-only avatars) and
// the old full inline list. Each row uses the actual player jersey
// (not a generic avatar circle) so the visual matches the rest of
// the app's jersey-as-identity language.
//
// Header layout:
//   רשימת משתתפים (X/Y)                                  הצג הכל ↤
//
// Row layout:
//   [Shirt]  Name + small role badge                  Status badge
//
// Tap on any row → PlayerCard. Tap "הצג הכל" → MatchPlayers.

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '@/components/Card';
import type { Jersey, ArrivalStatus } from '@/types';
import { colors, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';

export interface ParticipantEntry {
  id: string;
  name: string;
  jersey?: Jersey;
  isAdmin: boolean;
  /** Did this user create the game? Drives the "ארגון" role
   *  badge — distinct from a community admin (which would render
   *  as "מנהל" if we ever surface that here). */
  isOrganizer?: boolean;
  /** Per-game arrival, if recorded. */
  arrival?: ArrivalStatus;
  /** Bucket — drives the trailing status badge. */
  bucket: 'players' | 'waitlist' | 'pending';
}

interface Props {
  total: number;
  capacity: number;
  /** Trim to this many rows on the main screen — caller decides. */
  maxRows?: number;
  members: ParticipantEntry[];
  onSeeAll: () => void;
  onPressMember: (uid: string) => void;
}

export function MatchParticipantsSection({
  total,
  capacity,
  maxRows = 6,
  members,
  onSeeAll,
  onPressMember,
}: Props) {
  const visible = members.slice(0, maxRows);
  return (
    <View style={styles.wrap}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>
          {he.matchParticipantsTitle}{' '}
          <Text style={styles.count}>
            ({total}/{capacity})
          </Text>
        </Text>
        <Pressable onPress={onSeeAll} hitSlop={8}>
          <Text style={styles.seeAll}>{he.achievementsSeeAll}</Text>
        </Pressable>
      </View>
      {visible.length === 0 ? (
        <Card style={styles.emptyCard}>
          <Text style={styles.empty}>{he.matchPlayersEmpty}</Text>
        </Card>
      ) : (
        <Card style={styles.listCard}>
          {visible.map((m, i) => (
            <ParticipantRow
              key={m.id}
              entry={m}
              showDivider={i > 0}
              onPress={() => onPressMember(m.id)}
            />
          ))}
        </Card>
      )}
    </View>
  );
}

function ParticipantRow({
  entry,
  showDivider,
  onPress,
}: {
  entry: ParticipantEntry;
  showDivider: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        showDivider && styles.rowDivider,
        pressed && { backgroundColor: colors.surfaceMuted },
      ]}
      accessibilityRole="button"
      accessibilityLabel={entry.name}
    >
      {/* Avatar — generic blue circle with a person silhouette.
          Matches the reference design (round avatar, not jersey).
          The jersey-style identity lives in the achievements /
          profile screens; this list is about "who's coming" and a
          neutral avatar reads better at the row scale. */}
      <View style={styles.avatar}>
        <Ionicons name="person" size={20} color="#3B82F6" />
      </View>
      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={1}>
          {entry.name}
        </Text>
        {entry.isOrganizer ? (
          <View style={styles.roleBadge}>
            <Text style={styles.roleBadgeText}>
              {he.matchParticipantRoleOrganizer}
            </Text>
          </View>
        ) : null}
      </View>
      <StatusBadge bucket={entry.bucket} arrival={entry.arrival} />
      <Ionicons name="chevron-back" size={16} color={colors.textMuted} />
    </Pressable>
  );
}

function StatusBadge({
  bucket,
  arrival,
}: {
  bucket: 'players' | 'waitlist' | 'pending';
  arrival?: ArrivalStatus;
}) {
  // Arrival overrides bucket when present (post-game accuracy).
  if (arrival === 'arrived') {
    return (
      <Tag
        label={he.matchParticipantStatusArrived}
        tone="success"
        icon="checkmark-circle"
      />
    );
  }
  if (arrival === 'late') {
    return <Tag label={he.matchPlayersLateTag} tone="warning" />;
  }
  if (arrival === 'no_show') {
    return <Tag label={he.matchPlayersNoShowTag} tone="danger" />;
  }
  if (bucket === 'waitlist') {
    return <Tag label={he.matchPlayersWaitlistTag} tone="muted" />;
  }
  if (bucket === 'pending') {
    return <Tag label={he.matchPlayersPendingTag} tone="muted" />;
  }
  return (
    <Tag
      label={he.matchParticipantStatusComing}
      tone="success"
      icon="checkmark-circle"
    />
  );
}

function Tag({
  label,
  tone,
  icon,
}: {
  label: string;
  tone: 'success' | 'warning' | 'danger' | 'muted';
  icon?: keyof typeof Ionicons.glyphMap;
}) {
  const palette =
    tone === 'success'
      ? { bg: '#DCFCE7', fg: '#166534' }
      : tone === 'warning'
        ? { bg: '#FEF3C7', fg: '#B45309' }
        : tone === 'danger'
          ? { bg: '#FEE2E2', fg: '#B91C1C' }
          : { bg: colors.surfaceMuted, fg: colors.textMuted };
  return (
    <View style={[styles.tag, { backgroundColor: palette.bg }]}>
      {icon ? <Ionicons name={icon} size={12} color={palette.fg} /> : null}
      <Text style={[styles.tagText, { color: palette.fg }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xs,
  },
  title: {
    ...typography.body,
    color: '#0F172A',
    fontWeight: '800',
    textAlign: RTL_LABEL_ALIGN,
  },
  count: { color: '#64748B', fontWeight: '500' },
  seeAll: {
    ...typography.caption,
    color: '#3B82F6',
    fontWeight: '700',
  },
  listCard: {
    padding: 0,
    overflow: 'hidden',
    borderRadius: 18,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 14,
    elevation: 3,
  },
  emptyCard: {
    padding: spacing.xl,
    alignItems: 'center',
    borderRadius: 18,
  },
  empty: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
  },
  // Taller rows (was 10 vertical → 14) with more horizontal
  // breathing room. Premium-feeling list rather than a tight
  // settings table.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 14,
    paddingHorizontal: spacing.xl,
  },
  rowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(15,23,42,0.06)',
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#DBEAFE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  name: {
    ...typography.body,
    color: '#0F172A',
    fontWeight: '700',
    textAlign: RTL_LABEL_ALIGN,
    flexShrink: 1,
  },
  roleBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: '#DBEAFE',
  },
  roleBadgeText: {
    fontWeight: '700',
    fontSize: 11,
    color: '#1D4ED8',
  },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  tagText: {
    fontSize: 12,
    fontWeight: '700',
  },
});
