// DraftOrderPath — the "מסלול הבחירה" visualization.
//
// Renders the pick sequence as connected circles. Each circle shows the
// captain's AVATAR when `captains` is passed (the live board), or the
// team letter for the setup preview. The active pick is enlarged +
// ringed; done picks dim; upcoming picks are outlined.
//
// First child lands on the visual RIGHT under forceRTL, so pick #1 sits
// on the right and the path flows right-to-left. Generous padding keeps
// the enlarged active circle from being clipped at the edges.

import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { UserAvatar } from '@/components/UserAvatar';
import { colors, spacing, typography } from '@/theme';
import { teamLetter } from '@/utils/draft';

interface DraftUserLite {
  id: string;
  name: string;
  avatarId?: string;
  photoUrl?: string;
}

interface Props {
  /** Team indices in pick order. */
  order: number[];
  /** When set, the index in `order` that is picking right now. */
  activeIndex?: number;
  /** Smaller circles for inline previews. */
  compact?: boolean;
  /** Captain per team index — render their avatar instead of the letter. */
  captains?: DraftUserLite[];
}

export function DraftOrderPath({ order, activeIndex, compact, captains }: Props) {
  const dim = compact ? 30 : 42;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
    >
      {order.map((team, i) => {
        const isActive = activeIndex === i;
        const isDone = activeIndex !== undefined && i < activeIndex;
        const cap = captains?.[team];
        return (
          <View key={i} style={styles.item}>
            {i > 0 ? (
              <View
                style={[
                  styles.connector,
                  { width: compact ? 8 : 12 },
                  isDone && { backgroundColor: colors.primary },
                ]}
              />
            ) : null}
            <View
              style={[
                styles.circle,
                { width: dim, height: dim, borderRadius: dim / 2 },
                isDone && styles.circleDone,
                isActive && styles.circleActive,
                isActive && { transform: [{ scale: 1.14 }] },
              ]}
            >
              {cap ? (
                <UserAvatar user={cap} size={dim - 6} />
              ) : (
                <Text
                  style={[
                    styles.letter,
                    compact && { fontSize: 13 },
                    isDone && styles.letterDone,
                    isActive && styles.letterActive,
                  ]}
                >
                  {teamLetter(team)}
                </Text>
              )}
            </View>
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    // Center the path when it fits; still scrolls when it overflows. The
    // generous padding gives the scaled active circle room (no clipping).
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    gap: 0,
  },
  item: { flexDirection: 'row', alignItems: 'center' },
  connector: {
    height: 2,
    backgroundColor: colors.border,
  },
  circle: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  circleDone: {
    borderColor: colors.primary,
    opacity: 0.45,
  },
  circleActive: {
    borderColor: colors.primary,
    borderWidth: 2.5,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 4,
  },
  letter: {
    ...typography.body,
    fontWeight: '800',
    color: colors.text,
  },
  letterDone: { color: colors.textMuted },
  letterActive: { color: colors.primary },
});
