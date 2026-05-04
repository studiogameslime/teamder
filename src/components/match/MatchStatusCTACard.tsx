// MatchStatusCTACard — single elegant card combining the match's
// current state (title + subtitle) with the user's primary action
// and an optional secondary chip.
//
// Replaces the previous design where status, primary button, and
// secondary actions all lived as separate floating elements. This
// version keeps everything inside one card so the user reads
// "where the game stands" and "what they can do about it" in one
// sweep — no scanning back and forth.
//
// Visual rules (per spec):
//   • Primary button: filled green, 52–56 dp tall (NOT giant)
//   • Cancel/leave: outline red, smaller, never dominant
//   • Secondary chip: pill button next to/under the primary
//   • Title/subtitle right-aligned, RTL

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { Button } from '@/components/Button';
import { colors, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';

export type CTAKind =
  | 'join'
  | 'cancel'
  | 'admin'
  | 'blocked'
  | 'none';

export interface MatchStatusCTACardProps {
  title: string;
  subtitle?: string;
  /** What kind of primary action the button represents. */
  kind: CTAKind;
  /** The label rendered on the primary button (when present). */
  primaryLabel?: string;
  /** Press handler for the primary button. */
  onPrimary?: () => void;
  /** When true, the primary button shows a loading spinner. */
  busy?: boolean;
  /** Optional shake trigger (kind === 'blocked'). Bumping the
   *  number re-fires the horizontal shake animation. */
  blockedShake?: number;
  /** Helper text rendered under the primary when blocked. */
  blockedHelper?: string;
  /** Optional secondary chip — e.g. "הוסף אורח". */
  secondary?: {
    label: string;
    icon: keyof typeof Ionicons.glyphMap;
    onPress: () => void;
  };
}

export function MatchStatusCTACard({
  title,
  subtitle,
  kind,
  primaryLabel,
  onPrimary,
  busy,
  blockedShake = 0,
  blockedHelper,
  secondary,
}: MatchStatusCTACardProps) {
  // Cancel = subtle outline. The Button component doesn't ship an
  // outline-red small variant, so we render a hand-rolled Pressable
  // for that case to keep it visually quiet.
  const isCancel = kind === 'cancel';
  return (
    <View style={styles.card}>
      <View style={styles.headerBlock}>
        <Text style={styles.title} numberOfLines={2}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>

      {kind !== 'none' ? (
        <View style={styles.actionsRow}>
          {isCancel ? (
            // Subtle outline-red pill. Visible exit, not tempting.
            <Pressable
              onPress={onPrimary}
              disabled={busy}
              style={({ pressed }) => [
                styles.cancelBtn,
                pressed && { opacity: 0.6 },
                busy && { opacity: 0.4 },
              ]}
              accessibilityRole="button"
              accessibilityLabel={primaryLabel}
            >
              <Ionicons
                name="close-circle-outline"
                size={16}
                color={colors.danger}
              />
              <Text style={styles.cancelText}>{primaryLabel}</Text>
            </Pressable>
          ) : (
            <ShakeOnTrigger
              triggerKey={kind === 'blocked' ? blockedShake : 0}
              style={[
                styles.primaryWrap,
                kind === 'blocked' ? styles.primaryDimmed : null,
              ]}
            >
              <Button
                title={primaryLabel ?? ''}
                iconLeft={kind === 'blocked' ? 'lock-closed-outline' : undefined}
                variant="primary"
                // size="lg" yields ~56 dp tall — within the spec's
                // 52–56 dp range. Prevents the button from looking
                // like a giant landing-page CTA while staying
                // confidently tappable.
                size="lg"
                fullWidth
                loading={busy}
                onPress={onPrimary}
              />
            </ShakeOnTrigger>
          )}
          {secondary ? (
            <Pressable
              onPress={secondary.onPress}
              style={({ pressed }) => [
                styles.secondaryChip,
                pressed && { opacity: 0.85 },
              ]}
              accessibilityRole="button"
              accessibilityLabel={secondary.label}
            >
              <Ionicons
                name={secondary.icon}
                size={14}
                color={colors.primary}
              />
              <Text style={styles.secondaryText}>{secondary.label}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {kind === 'blocked' && blockedHelper ? (
        <Text style={styles.helper}>{blockedHelper}</Text>
      ) : null}
    </View>
  );
}

function ShakeOnTrigger({
  triggerKey,
  children,
  style,
}: {
  triggerKey: number;
  children: React.ReactNode;
  style?: import('react-native').StyleProp<import('react-native').ViewStyle>;
}) {
  const tx = useSharedValue(0);
  React.useEffect(() => {
    if (triggerKey === 0) return;
    tx.value = withSequence(
      withTiming(-8, { duration: 70 }),
      withTiming(8, { duration: 70 }),
      withTiming(-6, { duration: 60 }),
      withTiming(0, { duration: 60 }),
    );
  }, [triggerKey, tx]);
  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }],
  }));
  return <Animated.View style={[style, animStyle]}>{children}</Animated.View>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  headerBlock: {
    gap: 4,
  },
  title: {
    ...typography.h3,
    color: colors.text,
    fontWeight: '800',
    fontSize: 18,
    textAlign: RTL_LABEL_ALIGN,
  },
  subtitle: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
    fontSize: 13,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  primaryWrap: {
    flex: 1,
  },
  primaryDimmed: { opacity: 0.55 },
  // Outline-red cancel pill — paired with the same row as a
  // secondary chip, but takes the leading edge slot the primary
  // would occupy. Smaller height (44 dp) than the primary (52–56)
  // so it can never look like the dominant action.
  cancelBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 44,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(220, 38, 38, 0.32)',
    backgroundColor: colors.surface,
  },
  cancelText: {
    ...typography.caption,
    color: colors.danger,
    fontWeight: '700',
  },
  secondaryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: colors.primaryLight,
  },
  secondaryText: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '700',
  },
  helper: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
  },
});
