// DraftOrderPath — the "מסלול הבחירה" letter-circle visualization.
//
// Renders the pick sequence as connected circles (one per pick, showing
// the team letter). Used two ways:
//   • setup preview  — `order` only → all neutral, shows snake vs regular
//   • live board     — `activeIndex` set → picks before it read "done",
//                      the active pick is filled + enlarged ("now"), the
//                      rest are upcoming.
//
// First child lands on the visual RIGHT under forceRTL, so pick #1 (א)
// sits on the right and the path flows right-to-left — matching the spec.

import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, spacing, typography } from '@/theme';
import { teamLetter } from '@/utils/draft';

interface Props {
  /** Team indices in pick order. */
  order: number[];
  /** When set, the index in `order` that is picking right now. */
  activeIndex?: number;
  /** Smaller circles for inline previews. */
  compact?: boolean;
}

export function DraftOrderPath({ order, activeIndex, compact }: Props) {
  const dim = compact ? 30 : 38;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
    >
      {order.map((team, i) => {
        const isActive = activeIndex === i;
        const isDone = activeIndex !== undefined && i < activeIndex;
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
                isActive && { transform: [{ scale: 1.12 }] },
              ]}
            >
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
    paddingHorizontal: spacing.xs,
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
  },
  circleDone: {
    backgroundColor: colors.surfaceMuted,
    borderColor: colors.surfaceMuted,
  },
  circleActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
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
  letterActive: { color: colors.textOnPrimary },
});
