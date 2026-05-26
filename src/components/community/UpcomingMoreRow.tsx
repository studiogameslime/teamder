// UpcomingMoreRow — horizontal pills shown under the NextGameCard when
// the community has more than one upcoming game scheduled (typically
// "this Thursday" + "next Thursday"). Renders nothing when there's
// only the primary upcoming game (which lives on NextGameCard) or
// none at all.
//
// Each pill = compact date+time tag, lock icon when registration
// hasn't opened yet, fully tappable → MatchDetails. Capped at the
// next 4 to stay glanceable.

import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Game } from '@/types';
import { spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';

interface Props {
  /** All upcoming games. We slice off the first (primary) and render
   *  the rest. Pass the same array NextGameCard's `nextGame` came
   *  from. */
  upcoming: Game[];
  onPress: (gameId: string) => void;
  /** Allow up to N additional pills before showing "+ ועוד". */
  maxPills?: number;
}

export function UpcomingMoreRow({
  upcoming,
  onPress,
  maxPills = 4,
}: Props) {
  const rest = upcoming.slice(1);
  if (rest.length === 0) return null;

  const visible = rest.slice(0, maxPills);
  const overflow = rest.length - visible.length;

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{he.communityUpcomingMoreLabel}</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
      >
        {visible.map((g) => (
          <UpcomingPill
            key={g.id}
            game={g}
            onPress={() => onPress(g.id)}
          />
        ))}
        {overflow > 0 ? (
          <View style={styles.overflowPill}>
            <Text style={styles.overflowText}>
              {he.communityUpcomingMoreOverflow(overflow)}
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

function UpcomingPill({
  game,
  onPress,
}: {
  game: Game;
  onPress: () => void;
}) {
  const isLocked =
    game.status === 'scheduled' &&
    typeof game.registrationOpensAt === 'number' &&
    game.registrationOpensAt > Date.now();
  const d = new Date(game.startsAt);
  const dayLetter = HEBREW_DAYS[d.getDay()] ?? '';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mn = String(d.getMinutes()).padStart(2, '0');

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.pill,
        isLocked && styles.pillLocked,
        pressed && { opacity: 0.85 },
      ]}
      accessibilityRole="button"
      accessibilityLabel={`${dayLetter}׳ ${dd}.${mm} ${hh}:${mn}`}
    >
      {isLocked ? (
        <Ionicons
          name="lock-closed-outline"
          size={12}
          color="#64748B"
          style={styles.icon}
        />
      ) : (
        <Ionicons
          name="calendar-outline"
          size={12}
          color="#1D4ED8"
          style={styles.icon}
        />
      )}
      <Text style={[styles.pillText, isLocked && styles.pillTextLocked]}>
        {`${dayLetter}׳ ${dd}.${mm} · ${hh}:${mn}`}
      </Text>
    </Pressable>
  );
}

const HEBREW_DAYS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];

const styles = StyleSheet.create({
  wrap: {
    gap: 6,
    marginTop: spacing.sm,
  },
  label: {
    ...typography.caption,
    color: '#64748B',
    fontWeight: '700',
    textAlign: RTL_LABEL_ALIGN,
    paddingHorizontal: spacing.xs,
  },
  scroll: {
    gap: 8,
    paddingHorizontal: spacing.xs,
    paddingBottom: 2,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    borderRadius: 999,
  },
  pillLocked: {
    backgroundColor: '#F1F5F9',
    borderColor: '#CBD5E1',
  },
  icon: {
    marginEnd: 0,
  },
  pillText: {
    color: '#1D4ED8',
    fontSize: 13,
    fontWeight: '700',
  },
  pillTextLocked: {
    color: '#475569',
  },
  overflowPill: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderStyle: 'dashed',
    borderRadius: 999,
  },
  overflowText: {
    color: '#64748B',
    fontSize: 13,
    fontWeight: '600',
  },
});
