// DraftTeamCard — one team, one COMPACT full-width row. The team label
// sits on the left; the captain (avatar ringed in brand blue, no "קפטן"
// text) sits on the right with their first name; each drafted player is
// added beside the captain as a smaller avatar + first name, flowing
// leftward and wrapping as the team grows. Height is content-driven — no
// wasted space.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
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
}

/** First token only — "מתן לוי" → "מתן", "Itay Davidi" → "Itay". */
function firstName(name: string): string {
  const t = (name || '').trim().split(/\s+/)[0];
  return t || name || '';
}

export function DraftTeamCard({ index, captain, members, highlight }: Props) {
  return (
    <View style={[styles.card, highlight && styles.cardHighlight]}>
      {/* RTL: captain (first chip) lands on the right; members flow left. */}
      <View style={styles.chips}>
        <Chip user={captain} captain />
        {members.map((m) => (
          <Chip key={m.id} user={m} />
        ))}
      </View>
      <Text style={styles.teamName}>{teamName(index)}</Text>
    </View>
  );
}

function Chip({ user, captain }: { user: DraftUserLite; captain?: boolean }) {
  return (
    <View style={styles.chip}>
      <View style={captain ? styles.captainRing : undefined}>
        <UserAvatar user={user} size={captain ? 42 : 34} />
      </View>
      <Text style={styles.chipName} numberOfLines={1}>
        {firstName(user.name)}
      </Text>
    </View>
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
