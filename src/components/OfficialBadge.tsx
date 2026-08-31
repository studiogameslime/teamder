// The verified mark on the Teamder official account.
//
// Rendered only where `isOfficialSender` says so — i.e. derived from the
// reserved sender id, never from a field a user could write. See
// src/utils/officialAccount.ts for why that distinction is the whole point.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/theme';
import { he } from '@/i18n/he';

interface Props {
  /** 'mark' = the checkmark alone (tight spots: a bubble header, a list row).
   *  'full' = checkmark + "חשבון רשמי", for the chat header where there is
   *  room to say it in words — a symbol alone teaches nobody what it means. */
  variant?: 'mark' | 'full';
  size?: number;
}

export function OfficialBadge({ variant = 'mark', size = 13 }: Props) {
  const mark = (
    <Ionicons name="checkmark-circle" size={size} color={colors.primary} />
  );
  if (variant === 'mark') return mark;
  return (
    <View style={styles.pill}>
      {mark}
      <Text style={[styles.label, { fontSize: Math.max(10, size - 2) }]}>
        {he.officialAccount}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: colors.primaryLight,
    alignSelf: 'center',
  },
  label: { fontWeight: '800', color: colors.primary },
});
