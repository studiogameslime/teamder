// ReferralCard — full-width card showing how many users joined the
// app via this player's invite link, plus the helper copy. Visually
// matches the StatCard family but spans the full row so the metric
// stands on its own (it isn't part of the 4-stat 2×2 grid).
//
// Loading / error states render gracefully — the card never shows a
// misleading "0" while the count is in flight.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SoccerBallLoader } from '@/components/SoccerBallLoader';
import { colors, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';

interface Props {
  /** Null while loading; number once resolved. Caller is responsible
   *  for re-fetching on focus. */
  count: number | null;
}

export function ReferralCard({ count }: Props) {
  return (
    <View style={styles.card}>
      <View style={styles.iconWrap}>
        <Ionicons name="people" size={22} color={colors.primary} />
      </View>
      <View style={styles.body}>
        <Text style={styles.label}>{he.profileStatInvited}</Text>
        <Text style={styles.helper}>{he.playerCardReferralsHelper}</Text>
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
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 14,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primaryLight,
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
    fontWeight: '700',
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
  valuePositive: {
    color: colors.primary,
  },
  valueZero: {
    color: colors.textMuted,
  },
});
