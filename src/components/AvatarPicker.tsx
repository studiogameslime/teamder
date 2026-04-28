// AvatarPicker — grid of all built-in avatars, tap to choose.
//
// Layout: 4 per row, scrollable. RTL-friendly (the grid wraps in row
// direction so it flips automatically). Selected cell gets a colored
// ring + a small scale bump for tactile feedback.

import React from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import { Avatar } from './Avatar';
import { AVATARS } from '@/data/avatars';
import { colors, radius, spacing } from '@/theme';

interface Props {
  selectedAvatar?: string | null;
  onSelect: (id: string) => void;
  /** Avatar render size inside each cell. */
  size?: number;
  style?: ViewStyle;
}

export function AvatarPicker({
  selectedAvatar,
  onSelect,
  size = 64,
  style,
}: Props) {
  return (
    <ScrollView
      contentContainerStyle={[styles.grid, style]}
      keyboardShouldPersistTaps="handled"
    >
      {AVATARS.map((a) => {
        const selected = a.id === selectedAvatar;
        return (
          <Pressable
            key={a.id}
            onPress={() => onSelect(a.id)}
            accessibilityLabel={`avatar-${a.id}`}
            style={({ pressed }) => [
              styles.cell,
              selected && styles.cellSelected,
              pressed && { transform: [{ scale: 0.95 }] },
              selected && { transform: [{ scale: 1.04 }] },
            ]}
          >
            <Avatar avatarId={a.id} name="" size={size} />
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'center',
    paddingVertical: spacing.sm,
  },
  cell: {
    padding: spacing.xs,
    borderRadius: radius.lg,
    borderWidth: 2,
    borderColor: 'transparent',
    backgroundColor: colors.surface,
  },
  cellSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
  },
});
