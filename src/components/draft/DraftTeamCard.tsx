// DraftTeamCard — one team, one COMPACT full-width row. The team label
// sits on the left; the captain (avatar ringed in brand blue, no "קפטן"
// text) sits on the right with their first name; each drafted player is
// added beside the captain as a smaller avatar + first name, flowing
// leftward and wrapping as the team grows. Height is content-driven — no
// wasted space.

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { UserAvatar } from '@/components/UserAvatar';
import { colors, radius, spacing, typography, shadows } from '@/theme';
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
  /** Tap a player chip → open their card. */
  onPressUser?: (id: string) => void;
}

/** First token only — "מתן לוי" → "מתן", "Itay Davidi" → "Itay". */
function firstName(name: string): string {
  const t = (name || '').trim().split(/\s+/)[0];
  return t || name || '';
}

export function DraftTeamCard({
  index,
  captain,
  members,
  highlight,
  onPressUser,
}: Props) {
  return (
    <View style={[styles.card, highlight && styles.cardHighlight]}>
      {/* RTL: captain (first chip) lands on the right; members flow left. */}
      <View style={styles.chips}>
        <Chip user={captain} captain onPressUser={onPressUser} />
        {members.map((m) => (
          <Chip key={m.id} user={m} onPressUser={onPressUser} />
        ))}
      </View>
      <Text style={styles.teamName}>{teamName(index)}</Text>
    </View>
  );
}

function Chip({
  user,
  captain,
  onPressUser,
}: {
  user: DraftUserLite;
  captain?: boolean;
  onPressUser?: (id: string) => void;
}) {
  const body = (
    <>
      {/* Fixed-height area so a smaller member avatar centers on the same
          line as the larger captain avatar (not pinned to the top). */}
      <View style={styles.avatarArea}>
        <View style={captain ? styles.captainRing : undefined}>
          <UserAvatar user={user} size={captain ? 42 : 34} />
        </View>
      </View>
      <Text style={styles.chipName} numberOfLines={1}>
        {firstName(user.name)}
      </Text>
    </>
  );
  return onPressUser ? (
    <Pressable
      style={styles.chip}
      onPress={() => onPressUser(user.id)}
      accessibilityRole="button"
      accessibilityLabel={user.name}
    >
      {body}
    </Pressable>
  ) : (
    <View style={styles.chip}>{body}</View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    ...shadows.card,
  },
  cardHighlight: { borderColor: colors.primary, borderWidth: 2 },
  teamName: {
    ...typography.caption,
    fontWeight: '800',
    color: colors.primary,
    marginTop: 6,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    justifyContent: 'flex-start',
    columnGap: spacing.sm,
    rowGap: spacing.xs,
    flexShrink: 1,
  },
  chip: { width: 50, alignItems: 'center', gap: 3 },
  avatarArea: { height: 52, justifyContent: 'center', alignItems: 'center' },
  captainRing: {
    borderWidth: 2.5,
    borderColor: colors.primary,
    borderRadius: 99,
    padding: 2,
  },
  chipName: {
    ...typography.caption,
    fontSize: 11,
    color: colors.text,
    fontWeight: '600',
    textAlign: 'center',
  },
});
