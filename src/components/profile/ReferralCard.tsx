// ReferralCard — full-width row showing how many users joined the
// app via this player's invite link. Visual layout mirrors the
// other profile cards: icon circle on the leading edge, label +
// helper in the middle, big value + chevron on the trailing side.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SoccerBallLoader } from '@/components/SoccerBallLoader';
import { colors, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';

interface Props {
  /** Null while loading; number once resolved. */
  count: number | null;
}

export function ReferralCard({ count }: Props) {
  return (
    <View style={styles.card}>
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
    </View>
  );
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
  chevron: {
    width: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chevronInner: {
    width: 8,
    height: 8,
    borderTopWidth: 2,
    borderLeftWidth: 2,
    borderColor: colors.textMuted,
    transform: [{ rotate: '-45deg' }],
  },
});
