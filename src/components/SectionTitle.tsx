// SectionTitle — the standard heading rendered above a Card / list.
//
// Visual: bold title on the right (RTL), optional small "see all" / chip
// action on the left. Used at the top of every screen-level grouping
// (Recent Games, Members, My Communities, …) so the eye consistently
// finds the section head in the same place.

import React from 'react';
import { Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { colors, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';

interface Props {
  title: string;
  /** Optional secondary label aligned left (e.g., "Show all" / "5 of 12"). */
  action?: string;
  onActionPress?: () => void;
  style?: ViewStyle;
}

export function SectionTitle({ title, action, onActionPress, style }: Props) {
  return (
    <View style={[styles.row, style]}>
      <Text style={styles.title}>{title}</Text>
      {action ? (
        <Pressable onPress={onActionPress} hitSlop={6}>
          <Text style={styles.action}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  title: {
    ...typography.h3,
    color: colors.text,
    fontWeight: '800',
    textAlign: RTL_LABEL_ALIGN,
    writingDirection: 'rtl',
  },
  action: {
    ...typography.label,
    color: colors.primary,
    fontWeight: '600',
    textAlign: RTL_LABEL_ALIGN,
    writingDirection: 'rtl',
  },
});
