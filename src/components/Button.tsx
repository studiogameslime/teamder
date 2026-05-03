import React from 'react';
import {
  StyleSheet,
  Text,
  View,
  ViewStyle,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { PressableScale } from './PressableScale';
import { colors, radius, spacing, typography } from '@/theme';

type Variant =
  | 'primary'
  | 'secondary'
  | 'outline'
  | 'danger'
  | 'team1'
  | 'team2'
  | 'success';
type Size = 'sm' | 'md' | 'lg';

interface Props {
  title: string;
  onPress?: () => void;
  variant?: Variant;
  size?: Size;
  iconLeft?: keyof typeof Ionicons.glyphMap;
  iconRight?: keyof typeof Ionicons.glyphMap;
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
  fullWidth?: boolean;
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  iconLeft,
  iconRight,
  loading,
  disabled,
  style,
  fullWidth,
}: Props) {
  const palette = variantPalette(variant);
  const padV = size === 'sm' ? spacing.sm : size === 'lg' ? spacing.lg : spacing.md;
  const padH = size === 'sm' ? spacing.md : spacing.lg;

  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled || loading}
      // PressableScale provides scale-on-press; we still pin the
      // disabled-opacity here so the visual contrast is consistent.
      style={[
        styles.base,
        {
          backgroundColor: palette.bg,
          borderColor: palette.border,
          paddingVertical: padV,
          paddingHorizontal: padH,
          opacity: disabled ? 0.5 : 1,
          alignSelf: fullWidth ? 'stretch' : 'flex-start',
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={palette.text} />
      ) : (
        <View style={styles.content}>
          {iconLeft && (
            <Ionicons
              name={iconLeft}
              size={18}
              color={palette.text}
              style={{ marginEnd: spacing.xs }}
            />
          )}
          <Text style={[typography.button, { color: palette.text }]} numberOfLines={1}>
            {title}
          </Text>
          {iconRight && (
            <Ionicons
              name={iconRight}
              size={18}
              color={palette.text}
              style={{ marginStart: spacing.xs }}
            />
          )}
        </View>
      )}
    </PressableScale>
  );
}

function variantPalette(v: Variant) {
  switch (v) {
    case 'primary':
      // Brand-green CTA. The reference design uses this for every
      // primary action — "Save", "Send rating", "Create game".
      return { bg: colors.primary, text: colors.textOnPrimary, border: colors.primary };
    case 'secondary':
      return { bg: colors.surfaceMuted, text: colors.text, border: 'transparent' };
    case 'outline':
      // Outline = white pill with a green border + green text. Used for
      // secondary actions like "Cancel" beside a primary CTA.
      return { bg: colors.surface, text: colors.primary, border: colors.primary };
    case 'danger':
      // Red outline — destructive actions that we don't want to be a
      // filled CTA (e.g. "leave community", "cancel game"). Pairs the
      // outline shape with the danger token so it reads as "destructive
      // but you have to opt in" rather than a primary path.
      return { bg: colors.surface, text: colors.danger, border: colors.danger };
    case 'team1':
      return { bg: colors.team1, text: colors.textOnPrimary, border: colors.team1 };
    case 'team2':
      return { bg: colors.team2, text: colors.textOnPrimary, border: colors.team2 };
    case 'success':
      return { bg: colors.success, text: colors.textOnPrimary, border: colors.success };
  }
}

const styles = StyleSheet.create({
  base: {
    // Pill-rounded for the primary CTA aesthetic. radius.pill (=999) is
    // intentional — at our paddings the result reads as a true pill,
    // not the classic rounded-rectangle.
    borderRadius: radius.pill,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
