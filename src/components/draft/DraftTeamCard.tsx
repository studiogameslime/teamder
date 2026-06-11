// DraftTeamCard — one team, one full-width row (stacked vertically on the
// board and the summary). The captain is a larger avatar on the RIGHT with
// their first name below; each drafted player is added beside them as a
// smaller avatar + first name, flowing leftward and wrapping to new lines.

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
}

/** First token only — "מתן לוי" → "מתן", "Itay Davidi" → "Itay". */
function firstName(name: string): string {
  const t = (name || '').trim().split(/\s+/)[0];
  return t || name || '';
}

export function DraftTeamCard({ index, captain, members, highlight }: Props) {
  return (
    <View style={[styles.card, highlight && styles.cardHighlight]}>
      <Text style={styles.teamName}>{teamName(index)}</Text>
      {/* RTL: first child (captain) lands on the right; members flow left. */}
      <View style={styles.chips}>
        <Chip user={captain} big captain />
        {members.map((m) => (
          <Chip key={m.id} user={m} />
        ))}
      </View>
    </View>
  );
}

function Chip({
  user,
  big,
  captain,
}: {
  user: DraftUserLite;
  big?: boolean;
  captain?: boolean;
}) {
  return (
    <View style={[styles.chip, big && styles.chipBig]}>
      <UserAvatar user={user} size={big ? 60 : 42} ring={captain} />
      <Text style={[styles.chipName, big && styles.chipNameBig]} numberOfLines={1}>
        {firstName(user.name)}
      </Text>
      {captain ? <Text style={styles.capTag}>{he.draftCaptainLabel}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignSelf: 'stretch',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
    ...shadows.card,
  },
  cardHighlight: { borderColor: colors.primary, borderWidth: 2 },
  teamName: {
    ...typography.body,
    fontWeight: '800',
    color: colors.primary,
    textAlign: 'right',
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    columnGap: spacing.sm,
    rowGap: spacing.sm,
  },
  chip: {
    width: 58,
    alignItems: 'center',
    gap: 3,
  },
  chipBig: { width: 72 },
  chipName: {
    ...typography.caption,
    color: colors.text,
    fontWeight: '600',
    textAlign: 'center',
  },
  chipNameBig: { ...typography.body, fontWeight: '800' },
  capTag: {
    ...typography.caption,
    fontSize: 10,
    color: colors.primary,
    fontWeight: '800',
  },
});
