import React from 'react';
import {
  I18nManager,
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
  /** Override the screen-reader label. Defaults to `title` — set this
   *  only when the visible title is iconic / abbreviated and the
   *  spoken label should be more descriptive. */
  accessibilityLabel?: string;
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
  accessibilityLabel,
}: Props) {
  const palette = variantPalette(variant);
  const padV = size === 'sm' ? spacing.sm : size === 'lg' ? spacing.lg : spacing.md;
  const padH = size === 'sm' ? spacing.md : spacing.lg;

  // `iconLeft` means the VISUAL left, and under forceRTL it was landing on the
  // right — the row is flipped, so the first child renders rightmost and the
  // prop's own name became a lie. Reported three times from three screens
  // ("שהאייקון יהיה מצד שמאל של הטקסט") before it was recognised as one bug in
  // this component rather than three in the callers.
  //
  // So order by DIRECTION, not by prop name: the icon that must sit on the
  // visual left is the last child when the row is flipped, and the first child
  // when it is not. Spacing moved to `gap` on the row, because marginStart /
  // marginEnd are themselves direction-aware and would re-introduce the bug on
  // the other side.
  //
  // AND THEN THE REPORTS CAME BACK. Three callers had been hand-compensating
  // for the old bug — passing `iconRight` precisely BECAUSE it used to land on
  // the left — with comments saying so. Fixing the component inverted exactly
  // those three and nothing else. If a caller comment claims `iconRight` puts
  // the glyph on the left, it is stale: delete it and pass `iconLeft`. The prop
  // names mean the visual side now, on both sides of the flip.
  const first = I18nManager.isRTL ? iconRight : iconLeft;
  const second = I18nManager.isRTL ? iconLeft : iconRight;

  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled || loading}
      // Default a11y label to the visible title — fixes FV-06 where the
      // game-edit save button had no spoken label when reached via
      // screen reader (the title is rendered inside <Text> nested under
      // PressableScale, but the wrapping Pressable's role+label takes
      // precedence). Callers can override for iconic buttons.
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
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
          {first && <Ionicons name={first} size={18} color={palette.text} />}
          <Text style={[typography.button, { color: palette.text }]} numberOfLines={1}>
            {title}
          </Text>
          {second && <Ionicons name={second} size={18} color={palette.text} />}
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
    gap: spacing.xs,
  },
});
