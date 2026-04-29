// InputField — the standard form input across the redesigned UI.
//
// Layout (RTL):
//   [icon (right)]  [text input (flex)]
//
// Visual: light gray pill (`#F5F5F5`-style surface), no visible border,
// 14-18dp rounded corners, generous padding. The icon sits on the right
// because Hebrew is RTL and that's where the eye lands first.
//
// The component is intentionally a thin wrapper around RN `TextInput`
// so it composes with all standard input props (keyboardType,
// autoCapitalize, secureTextEntry, …). For non-text "inputs" (date /
// time pickers) callers can pass `onPress` and a `value` string instead
// — the component renders a Pressable label that opens whatever modal
// the caller provides via `onPress`.

import React from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, typography } from '@/theme';

interface Props
  extends Omit<TextInputProps, 'style' | 'placeholderTextColor'> {
  label?: string;
  /** Ionicon glyph rendered on the right (RTL). */
  icon?: keyof typeof Ionicons.glyphMap;
  /** When set the field becomes a tappable label; the `value` prop is
      shown as the text and `onPress` runs on tap. Used for date / time
      / location modals where a TextInput would be wrong. */
  onPress?: () => void;
  /** Visible only on the tap-to-pick variant. Greys out the icon + text. */
  placeholder?: string;
  containerStyle?: ViewStyle;
}

export function InputField({
  label,
  icon,
  onPress,
  placeholder,
  containerStyle,
  value,
  ...textInputProps
}: Props) {
  const hasValue = typeof value === 'string' && value.length > 0;

  return (
    <View style={[styles.wrap, containerStyle]}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      {onPress ? (
        // Tap-to-pick variant — non-editable text + icon, opens a modal
        // when tapped. We deliberately render a `<Text>` so the
        // placeholder-vs-value styling can diverge cleanly.
        <Pressable
          onPress={onPress}
          style={({ pressed }) => [styles.field, pressed && { opacity: 0.85 }]}
        >
          <Text
            numberOfLines={1}
            style={[
              styles.input,
              !hasValue && { color: colors.textMuted },
            ]}
          >
            {hasValue ? value : (placeholder ?? '')}
          </Text>
          {icon ? (
            <Ionicons
              name={icon}
              size={20}
              color={colors.textMuted}
              style={styles.iconRight}
            />
          ) : null}
        </Pressable>
      ) : (
        <View style={styles.field}>
          <TextInput
            {...textInputProps}
            value={value}
            placeholder={placeholder}
            placeholderTextColor={colors.textMuted}
            style={styles.input}
          />
          {icon ? (
            <Ionicons
              name={icon}
              size={20}
              color={colors.textMuted}
              style={styles.iconRight}
            />
          ) : null}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.xs,
  },
  label: {
    ...typography.label,
    color: colors.textMuted,
    // App.tsx sets a Text default with textAlign:'right', but a `style`
    // prop on a child Text overrides defaultProps entirely (React doesn't
    // merge style arrays from defaultProps). Spelling out the RTL pair
    // here guarantees the label hugs the right edge.
    textAlign: 'right',
    writingDirection: 'rtl',
    alignSelf: 'stretch',
    width: '100%',
  },
  field: {
    // `row-reverse` places the LAST JSX child (the icon) on the
    // physical RIGHT under forceRTL — the leading position in Hebrew
    // reading order. Plain `row` would auto-flip and put the icon on
    // the left, which trailed the text input awkwardly.
    flexDirection: 'row-reverse',
    alignItems: 'center',
    backgroundColor: '#F5F5F5',
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    minHeight: 52,
  },
  input: {
    ...typography.body,
    color: colors.text,
    flex: 1,
    textAlign: 'right',
    writingDirection: 'rtl',
    // Pull the cursor onto the same baseline as the icon — RN's default
    // line-height pushes the digit down a few pixels otherwise.
    paddingVertical: spacing.sm,
  },
  iconRight: {
    // With `flexDirection:'row-reverse'` the icon sits on the right.
    // `marginEnd` is its physical LEFT side under forceRTL — the gap
    // separating it from the input field.
    marginEnd: spacing.sm,
  },
});
