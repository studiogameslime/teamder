// The two summary counters at the top of the "שחקנים" tab.
//
// This file used to be the whole tab — a three-row roster preview behind a
// "הצג הכל" link into a separate screen. The owner asked for the real list
// here instead, with the admin rating, the ⋮ menu and the join time, so the
// tab now renders `MatchPlayersScreen` embedded and all that survives of this
// file is the pair of counters that sit above it.
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { clubAccent, clubCardTint } from '@/theme/clubAccents';
import { colors, radius, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';

/**
 * The two summary counters at the top of the שחקנים tab.
 *
 * All that is left of what was once a whole tab component: the sections under
 * it are `MatchPlayersScreen` rendered embedded, so the roster, the waitlist
 * and the cancellations are the real thing rather than three-row previews.
 */
export function MatchPlayerCounters({
  registered,
  waiting,
}: {
  registered: string;
  waiting: number;
}) {
  return (
    <View style={styles.counters}>
      <Counter
        icon="people"
        tint={clubAccent.blue}
        value={registered}
        label={he.gdPlayersRegistered}
      />
      <Counter
        icon="time"
        tint={clubAccent.gold}
        value={String(waiting)}
        label={he.gdPlayersWaiting}
      />
    </View>
  );
}

function Counter({
  icon,
  tint,
  value,
  label,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  tint: string;
  value: string;
  label: string;
}) {
  return (
    <View style={styles.counter}>
      <View style={[styles.counterIcon, { backgroundColor: clubCardTint(tint) }]}>
        <Ionicons name={icon} size={18} color={tint} />
      </View>
      <View style={styles.counterText}>
        {/* The figure carries a LRM so "15/15" keeps its order inside an RTL
            paragraph — the same guard the old stats strip used. */}
        <Text style={styles.counterValue}>{`‎${value}`}</Text>
        <Text style={styles.counterLabel} numberOfLines={1}>{label}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  counters: { flexDirection: 'row', gap: spacing.sm },
  counter: {
    flex: 1,
    // `row` → icon first lands on the RIGHT, the numbers beside it.
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    shadowColor: '#1E293B',
    shadowOpacity: 0.06,
    shadowOffset: { width: 0, height: 3 },
    shadowRadius: 10,
    elevation: 2,
  },
  counterIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  counterText: { flex: 1 },
  counterValue: {
    fontSize: 19,
    fontWeight: '800',
    color: colors.text,
    textAlign: RTL_LABEL_ALIGN,
  },
  counterLabel: {
    ...typography.caption,
    fontSize: 12,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
  },
});
