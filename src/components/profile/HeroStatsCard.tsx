// HeroStatsCard — dark navy floating stats strip that overlaps the
// bottom of the stadium hero. Three fixed columns:
//   משחקים · מועדונים · חברים
//
// Each column = icon + bold number + small label. The dark
// background reads against the gradient finale of the hero, then
// gives way to the lighter content below.
//
// History: "שערים" was dropped (2026-05-29, no flow wrote it). The
// old "הופעות"/"הגעה %" columns were replaced (2026-06-12) — both
// derived from stats that no flow increments yet, so they always read
// 0; clubs + friends are real counts the user can see grow.

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { spacing, typography } from '@/theme';
import { he } from '@/i18n/he';
import { CountUp } from '@/components/anim/CountUp';
import { LivingIcon, type LivingMotion } from '@/components/anim/LivingIcon';

interface Props {
  totalGames: number;
  clubs: number;
  friends: number;
  /** Tap the games cell → match history (Pulse dlsNUO). */
  onGamesPress?: () => void;
  /** Tap the clubs cell → communities. */
  onClubsPress?: () => void;
  /** Tap the friends cell → friends screen (Pulse dlsNUO). */
  onFriendsPress?: () => void;
}

export function HeroStatsCard({
  totalGames,
  clubs,
  friends,
  onGamesPress,
  onClubsPress,
  onFriendsPress,
}: Props) {
  return (
    <View style={styles.card}>
      <Cell
        icon="football-outline"
        motion="spin"
        iconColor="#FFFFFF"
        countTo={totalGames}
        label={he.profileStatTotalGames}
        onPress={onGamesPress}
      />
      <Divider />
      <Cell
        icon="people-outline"
        motion="pulse"
        iconColor="#FFFFFF"
        countTo={clubs}
        label={he.profileStatClubs}
        onPress={onClubsPress}
      />
      <Divider />
      <Cell
        icon="person-add-outline"
        motion="bounce"
        iconColor="#22C55E"
        countTo={friends}
        valueColor="#22C55E"
        label={he.profileStatFriends}
        onPress={onFriendsPress}
      />
    </View>
  );
}

function Cell({
  icon,
  motion,
  iconColor,
  value,
  countTo,
  suffix,
  valueColor,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  motion: LivingMotion;
  iconColor: string;
  value?: string;
  // When provided, the number animates up from 0 on mount (CountUp)
  // instead of rendering a static string.
  countTo?: number;
  suffix?: string;
  valueColor?: string;
  label: string;
  onPress?: () => void;
}) {
  const valueStyle = valueColor
    ? [styles.value, { color: valueColor }]
    : [styles.value];
  const Container = onPress ? Pressable : View;
  return (
    <Container
      style={styles.cell}
      onPress={onPress}
      accessibilityRole={onPress ? 'button' : undefined}
    >
      <LivingIcon motion={motion}>
        <Ionicons name={icon} size={20} color={iconColor} />
      </LivingIcon>
      {typeof countTo === 'number' ? (
        <CountUp to={countTo} suffix={suffix} style={valueStyle} />
      ) : (
        <Text style={valueStyle} numberOfLines={1}>
          {value}
        </Text>
      )}
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
    </Container>
  );
}

function Divider() {
  return <View style={styles.divider} />;
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: '#0F172A',
    borderRadius: 18,
    paddingVertical: spacing.md + 2,
    paddingHorizontal: spacing.sm,
    // Slight shadow so the card lifts off the hero's dark base.
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 14,
    elevation: 6,
  },
  cell: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 4,
  },
  value: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
  },
  label: {
    ...typography.caption,
    color: 'rgba(255,255,255,0.65)',
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
  },
  divider: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.18)',
    marginVertical: spacing.xs,
  },
});
