// QuickActionsRow — small pill buttons that sit under the primary
// CTA on the match screen. Currently: Waze nav + share. Both are
// optional via the props so the row hides itself when neither is
// applicable (no location, no game id).

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, typography } from '@/theme';

interface ActionProps {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  /** When true, render the pill in a muted style. */
  muted?: boolean;
}

interface Props {
  actions: ActionProps[];
}

export function QuickActionsRow({ actions }: Props) {
  if (actions.length === 0) return null;
  return (
    <View style={styles.row}>
      {actions.map((a) => (
        <ActionPill key={a.label} {...a} />
      ))}
    </View>
  );
}

function ActionPill({ icon, label, onPress, muted }: ActionProps) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.pill,
        muted ? styles.pillMuted : styles.pillActive,
        pressed && { opacity: 0.75 },
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Ionicons
        name={icon}
        size={14}
        color={muted ? colors.textMuted : colors.primary}
      />
      <Text
        style={[
          styles.pillText,
          muted ? styles.pillTextMuted : styles.pillTextActive,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: 999,
  },
  pillActive: {
    backgroundColor: colors.primaryLight,
  },
  pillMuted: {
    backgroundColor: colors.surfaceMuted,
  },
  pillText: {
    ...typography.caption,
    fontWeight: '700',
  },
  pillTextActive: {
    color: colors.primary,
  },
  pillTextMuted: {
    color: colors.textMuted,
  },
});
