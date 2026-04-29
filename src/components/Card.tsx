import React from 'react';
import { Pressable, StyleSheet, View, ViewStyle } from 'react-native';
import { colors, radius, spacing } from '@/theme';

interface Props {
  children: React.ReactNode;
  style?: ViewStyle;
  tint?: string;
  onPress?: () => void;
}

export function Card({ children, style, tint, onPress }: Props) {
  const baseStyle = [styles.card, tint ? { borderColor: tint } : null, style];
  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [...baseStyle, pressed && { opacity: 0.85 }]}
      >
        {children}
      </Pressable>
    );
  }
  return <View style={baseStyle}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    // Borderless premium look — depth comes from the soft shadow below,
    // not a thin outline. Matches the reference design language.
    shadowColor: '#0F172A',
    shadowOpacity: 0.06,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
});
