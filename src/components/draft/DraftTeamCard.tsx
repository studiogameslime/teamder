// DraftTeamCard — one team as a self-contained card: name, captain, and
// the players drafted so far. Used both on the draft board (fixed width,
// horizontally scrollable so 2–4 teams never get cramped) and on the
// summary (full width, stacked).

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
}

export function DraftTeamCard({ index, captain, members, highlight, width }: Props) {
  return (
    <View
      style={[
        styles.card,
        width ? { width } : { alignSelf: 'stretch' },
        highlight && styles.cardHighlight,
      ]}
    >
      <Text style={styles.teamName}>{teamName(index)}</Text>
      <View style={styles.titleRule} />

      <MemberRow user={captain} captain />

      {members.length > 0 ? (
        <>
          <View style={styles.divider} />
          {members.map((m) => (
            <MemberRow key={m.id} user={m} />
          ))}
        </>
      ) : null}
    </View>
  );
}

function MemberRow({ user, captain }: { user: DraftUserLite; captain?: boolean }) {
  return (
    <View style={styles.row}>
      <UserAvatar user={user} size={30} />
      <View style={styles.rowText}>
        {captain ? <Text style={styles.captainTag}>{he.draftCaptainLabel}</Text> : null}
        {/* 2 lines so real names ("Eliran Tzabari") stay readable inside the
            narrow 3-up team cards instead of truncating to "Eli…". */}
        <Text style={styles.name} numberOfLines={2}>
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
  cardHighlight: {
    borderColor: colors.primary,
    borderWidth: 2,
  },
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
  // Avatar leads (visual right under RTL), name/label to its left.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 5,
  },
  rowText: { flexShrink: 1 },
  captainTag: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '800',
    textAlign: 'right',
  },
  name: {
    ...typography.body,
    color: colors.text,
    fontWeight: '600',
    textAlign: 'right',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.divider,
    marginVertical: spacing.sm,
  },
});
