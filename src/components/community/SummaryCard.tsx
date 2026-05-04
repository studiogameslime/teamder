// SummaryCard — single tile in the community summary grid.
// Compact, RTL-aligned, soft shadow. Label sits above the value
// because both are short and the reader scans top-to-bottom even
// in Hebrew (the visual hierarchy isn't a chronological flow).

import React from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';

interface Props {
  label: string;
  value: string;
  icon?: keyof typeof Ionicons.glyphMap;
  style?: ViewStyle;
}

export function SummaryCard({ label, value, icon, style }: Props) {
  return (
    <View style={[styles.card, style]}>
      <View style={styles.labelRow}>
        {icon ? (
          <Ionicons
            name={icon}
            size={14}
            color={colors.textMuted}
            style={styles.icon}
          />
        ) : null}
        <Text style={styles.label} numberOfLines={1}>
          {label}
        </Text>
      </View>
      <Text style={styles.value} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    gap: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  icon: {
    marginEnd: 2,
  },
  label: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
    flex: 1,
  },
  value: {
    fontSize: 17,
    fontWeight: '800',
    color: colors.text,
    textAlign: RTL_LABEL_ALIGN,
  },
});
