// DraftTeamCard — one team as a self-contained card: name, captain, and
// the players drafted so far. Two layouts:
//   • compact (board, 2–4 teams fit across the screen) — each member is a
//     CENTERED chip (avatar on top, name below) so the full card width is
//     available to the name and long names never break mid-word.
//   • full-width (summary) — avatar-right / name-left rows.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { UserAvatar } from '@/components/UserAvatar';
import { colors, radius, spacing, typography, shadows } from '@/theme';
import { he } from '@/i18n/he';
import { teamName } from '@/utils/draft';

export interface DraftUserLite {
  id: string;
  name: string;
  avatarId?: string;
  photoUrl?: string;
}

interface Props {
  index: number;
  captain: DraftUserLite;
  /** Drafted players (excludes the captain). */
  members: DraftUserLite[];
  /** Highlight the team whose turn it is to pick. */
  highlight?: boolean;
  /** Fixed width for the horizontal board; omit for full-width summary. */
  width?: number;
  /** Centered-chip layout for the narrow board cards. */
  compact?: boolean;
}

export function DraftTeamCard({
  index,
  captain,
  members,
  highlight,
  width,
  compact,
}: Props) {
  const Chip = compact ? StackChip : RowChip;
  return (
    <View
      style={[
        styles.card,
        width ? { width } : { alignSelf: 'stretch' },
        compact && styles.cardCompact,
        highlight && styles.cardHighlight,
      ]}
    >
      <Text style={styles.teamName}>{teamName(index)}</Text>
      <View style={styles.titleRule} />

      <Chip user={captain} captain />
      {members.length > 0 ? <View style={styles.divider} /> : null}
      {members.map((m, i) => (
        <React.Fragment key={m.id}>
          {i > 0 ? <View style={styles.dividerLight} /> : null}
          <Chip user={m} />
        </React.Fragment>
      ))}
    </View>
  );
}

/** Centered avatar-over-name chip — used in the narrow board cards. */
function StackChip({ user, captain }: { user: DraftUserLite; captain?: boolean }) {
  return (
    <View style={styles.chip}>
      {captain ? <Text style={styles.chipTag}>{he.draftCaptainLabel}</Text> : null}
      <UserAvatar user={user} size={40} ring={captain} />
      <Text style={styles.chipName} numberOfLines={2}>
        {user.name}
      </Text>
    </View>
  );
}

/** Avatar-right / name-left row — used in the full-width summary cards. */
function RowChip({ user, captain }: { user: DraftUserLite; captain?: boolean }) {
  return (
    <View style={styles.row}>
      <UserAvatar user={user} size={36} ring={captain} />
      <View style={styles.rowText}>
        {captain ? <Text style={styles.rowTag}>{he.draftCaptainLabel}</Text> : null}
        <Text style={styles.rowName} numberOfLines={1}>
          {user.name}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    ...shadows.card,
  },
  cardCompact: { minHeight: 132 },
  cardHighlight: { borderColor: colors.primary, borderWidth: 2 },
  teamName: {
    ...typography.body,
    fontWeight: '800',
    color: colors.primary,
    textAlign: 'center',
  },
  titleRule: {
    height: 2,
    width: 36,
    alignSelf: 'center',
    backgroundColor: colors.primary,
    borderRadius: 1,
    marginTop: 4,
    marginBottom: spacing.sm,
    opacity: 0.5,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.divider,
    marginVertical: spacing.sm,
  },
  dividerLight: { height: spacing.sm },

  // ── compact (board) centered chip ──
  chip: { alignItems: 'center', gap: 4 },
  chipTag: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '800',
  },
  chipName: {
    ...typography.caption,
    color: colors.text,
    fontWeight: '700',
    textAlign: 'center',
  },

  // ── full-width (summary) row ──
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 4,
  },
  rowText: { flexShrink: 1 },
  rowTag: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '800',
    textAlign: 'right',
  },
  rowName: {
    ...typography.body,
    color: colors.text,
    fontWeight: '600',
    textAlign: 'right',
  },
});
