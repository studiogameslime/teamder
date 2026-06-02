// ReferralCard — full-width row showing how many users joined the
// app via this player's invite link. Visual layout mirrors the
// other profile cards: icon circle on the leading edge, label +
// helper in the middle, big value + chevron on the trailing side.
//
// The whole row is now tappable (when there's at least one referral).
// Tap → ReferralsListScreen, which shows the actual people who joined
// and when. We render a chevron at the trailing edge so the row
// announces itself as navigable; rows with count=0 stay static (no
// chevron, no onPress) so we don't navigate to an empty list.

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SoccerBallLoader } from '@/components/SoccerBallLoader';
import { colors, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';

interface Props {
  /** Null while loading; number once resolved. */
  count: number | null;
  /** Optional tap handler — when present (and count > 0), the row
   *  becomes a navigable button to the referrals list. */
  onPress?: () => void;
}

export function ReferralCard({ count, onPress }: Props) {
  const tappable = typeof onPress === 'function' && (count ?? 0) > 0;

  // Shared inner content. Kept separate so the non-tappable case renders
  // inside a plain <View> — passing a *function* style (which only
  // <Pressable> understands) to a <View> silently dropped ALL the card
  // styling, so the count=0 card lost its row layout + surface.
  const inner = (
    <>
      <View style={styles.iconWrap}>
        <Ionicons name="people" size={22} color="#3B82F6" />
      </View>
      <View style={styles.body}>
        <Text style={styles.label} numberOfLines={1}>
          {he.profileStatInvited}
        </Text>
        <Text style={styles.helper} numberOfLines={1}>
          {he.playerCardReferralsHelper}
        </Text>
      </View>
      <View style={styles.valueWrap}>
        {count === null ? (
          <SoccerBallLoader size={22} />
        ) : (
          <Text
            style={[
              styles.value,
              count > 0 ? styles.valuePositive : styles.valueZero,
            ]}
          >
            {count}
          </Text>
        )}
      </View>
      {tappable ? (
        <Ionicons
          name="chevron-back"
          size={18}
          color={colors.textMuted}
          style={styles.chevronIcon}
        />
      ) : null}
    </>
  );

  if (tappable) {
    return (
      <Pressable
        style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={he.profileStatInvited}
      >
        {inner}
      </Pressable>
    );
  }
  return <View style={styles.card}>{inner}</View>;
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 16,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 1,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#DBEAFE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
    gap: 2,
  },
  label: {
    ...typography.body,
    color: colors.text,
    fontWeight: '800',
    textAlign: RTL_LABEL_ALIGN,
  },
  helper: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
  },
  valueWrap: {
    minWidth: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  value: {
    fontSize: 24,
    fontWeight: '800',
  },
  valuePositive: { color: '#3B82F6' },
  valueZero: { color: colors.text },
  chevronIcon: {
    opacity: 0.6,
  },
});
