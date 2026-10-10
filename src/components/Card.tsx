import React from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import { PressableScale } from '@/components/PressableScale';
import { colors, radius, spacing } from '@/theme';
import { motion } from '@/theme/motion';

interface Props {
  children: React.ReactNode;
  style?: ViewStyle;
  tint?: string;
  onPress?: () => void;
}

export function Card({ children, style, tint, onPress }: Props) {
  const baseStyle = [styles.card, tint ? { borderColor: tint } : null, style];
  if (onPress) {
    // A tappable card used to answer with `opacity: 0.85` — a dim, which reads
    // as "disabled" rather than "pressed". PressableScale (already the basis of
    // Button) gives the same surface a small settle instead, so every tappable
    // card in the app answers the finger the way every button already does.
    //
    // Scale is smaller than a button's: the same proportional shrink on a
    // full-width card is a much larger movement, and on a card it only has to
    // register, not perform. transform only — nothing here can shift the layout
    // around the card.
    //
    // haptic={false} deliberately. PressableScale fires one by default, which
    // is right for a deliberate button press and wrong here: cards are the most
    // numerous tappable surface in the app, and a buzz on every one of them
    // adds up to noise rather than feedback.
    return (
      <PressableScale
        unstable_pressDelay={100}
        onPress={onPress}
        pressedScale={motion.press.cardScale}
        haptic={false}
        style={baseStyle}
      >
        {children}
      </PressableScale>
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
