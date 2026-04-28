import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { PlayerIdentity } from './PlayerIdentity';
import { Player } from '@/types';
import { colors, spacing, typography } from '@/theme';

interface Props {
  player: Player;
  index?: number;
  rightIcon?: 'check' | 'clock' | 'glove' | 'next';
  rightLabel?: string;
  onPress?: () => void;
}

export function PlayerRow({ player, index, rightIcon, rightLabel, onPress }: Props) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && onPress && styles.pressed]}
    >
      {typeof index === 'number' && <Text style={styles.index}>{index}</Text>}
      <PlayerIdentity
        user={{
          id: player.id,
          name: player.displayName,
          jersey: player.jersey,
        }}
        size="sm"
      />
      <Text style={styles.name} numberOfLines={1}>
        {player.displayName}
      </Text>
      {rightLabel && <Text style={styles.label}>{rightLabel}</Text>}
      {rightIcon && <RightIcon kind={rightIcon} />}
    </Pressable>
  );
}

function RightIcon({ kind }: { kind: NonNullable<Props['rightIcon']> }) {
  switch (kind) {
    case 'check':
      return <Ionicons name="checkmark-circle" size={22} color={colors.success} />;
    case 'clock':
      return <Ionicons name="time-outline" size={22} color={colors.warning} />;
    case 'glove':
      // expo's Ionicons doesn't have a glove glyph; use hand emoji-like substitute
      return <Text style={styles.glove}>🧤</Text>;
    case 'next':
      return <Ionicons name="arrow-forward-circle-outline" size={22} color={colors.textMuted} />;
  }
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    gap: spacing.md,
  },
  pressed: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: 8,
  },
  index: {
    ...typography.bodyBold,
    color: colors.textMuted,
    width: 22,
    textAlign: 'center',
  },
  name: {
    ...typography.body,
    color: colors.text,
    flex: 1,
  },
  label: {
    ...typography.caption,
    color: colors.warning,
    fontWeight: '600',
  },
  glove: {
    fontSize: 20,
  },
});
