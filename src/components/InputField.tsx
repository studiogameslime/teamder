// InputField — the standard form input across the redesigned UI.
//
// Layout (RTL):
//   [text input (visual right, flex)] [icon (visual left)]
//
// Visual: light gray pill (`#F5F5F5`-style surface), no visible border,
// 14-18dp rounded corners, generous padding. Text precedes its supporting
// icon, consistently with the application's other labelled controls.
//
// The component is intentionally a thin wrapper around RN `TextInput`
// so it composes with all standard input props (keyboardType,
// autoCapitalize, secureTextEntry, …). For non-text "inputs" (date /
// time pickers) callers can pass `onPress` and a `value` string instead
// — the component renders a Pressable label that opens whatever modal
// the caller provides via `onPress`.

import React, { useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { InfoTip } from './InfoTip';

interface Props
  extends Omit<TextInputProps, 'style' | 'placeholderTextColor'> {
  label?: string;
  /** Optional ⓘ next to the label that opens a brief explanation —
   *  keeps the form clean instead of a constant paragraph under the field. */
  info?: { title?: string; text: string };
  /** Supporting Ionicon glyph rendered visually left of the text. */
  icon?: keyof typeof Ionicons.glyphMap;
  /** When set the field becomes a tappable label; the `value` prop is
      shown as the text and `onPress` runs on tap. Used for date / time
      / location modals where a TextInput would be wrong. */
  onPress?: () => void;
  /** Visible only on the tap-to-pick variant. Greys out the icon + text. */
  placeholder?: string;
  containerStyle?: ViewStyle;
  /** When true, render a red asterisk next to the label so the user
   *  can spot required fields at a glance. Purely visual — actual
   *  validation lives in the submitting screen. */
  required?: boolean;
}

export function InputField({
  label,
  info,
  icon,
  onPress,
  placeholder,
  containerStyle,
  value,
  required,
  onFocus,
  onBlur,
  ...textInputProps
}: Props) {
  const hasValue = typeof value === 'string' && value.length > 0;

  // Focus state drives a soft border + tint sweep on the surrounding
  // pill so the user sees which field is active. Animation is JS-thread
  // -free (worklet-only) so a long keyboard mount doesn't stutter it.
  const focus = useSharedValue(0);
  const [focused, setFocused] = useState(false);

  const fieldAnimStyle = useAnimatedStyle(() => ({
    borderColor: interpolateColor(
      focus.value,
      [0, 1],
      ['#F5F5F5', colors.primary],
    ),
    backgroundColor: interpolateColor(
      focus.value,
      [0, 1],
      ['#F5F5F5', '#FFFFFF'],
    ),
  }));

  const setFocus = (next: boolean) => {
    setFocused(next);
    focus.value = withTiming(next ? 1 : 0, {
      duration: 220,
      easing: Easing.out(Easing.cubic),
    });
  };

  return (
    <View style={[styles.wrap, containerStyle]}>
      {label ? (
        <View style={styles.labelRow}>
          <Text style={[styles.label, styles.labelFlex]}>
            {label}
            {required ? <Text style={styles.requiredStar}>{' *'}</Text> : null}
          </Text>
          {info ? <InfoTip title={info.title ?? label} text={info.text} /> : null}
        </View>
      ) : null}
      {onPress ? (
        <Pressable
          onPress={onPress}
          disabled={textInputProps.editable === false}
          accessibilityRole="button"
          accessibilityLabel={textInputProps.accessibilityLabel ?? label ?? placeholder}
          accessibilityHint={textInputProps.accessibilityHint}
          accessibilityValue={textInputProps.accessibilityValue ?? { text: hasValue ? value : (placeholder ?? '') }}
          accessibilityState={{ ...textInputProps.accessibilityState, disabled: textInputProps.editable === false }}
          onAccessibilityAction={textInputProps.onAccessibilityAction}
          accessibilityActions={textInputProps.accessibilityActions}
          testID={textInputProps.testID}
          style={({ pressed }) => [pressed && { opacity: 0.85 }]}
        >
          <Animated.View style={[styles.field, fieldAnimStyle]}>
            <Text
              numberOfLines={1}
              style={[
                styles.input,
                // Display (tap) variant is a <Text>, not a TextInput: under
                // Android forceRTL physical 'right' resolves to visual LEFT
                // for Hebrew values, so use the logical RTL_LABEL_ALIGN here.
                styles.inputDisplay,
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
          </Animated.View>
        </Pressable>
      ) : (
        <Animated.View style={[styles.field, fieldAnimStyle]}>
          <TextInput
            {...textInputProps}
            accessibilityLabel={textInputProps.accessibilityLabel ?? label ?? placeholder}
            value={value}
            placeholder={placeholder}
            placeholderTextColor="#9CA3AF"
            style={styles.input}
            onFocus={(e) => {
              setFocus(true);
              onFocus?.(e);
            }}
            onBlur={(e) => {
              setFocus(false);
              onBlur?.(e);
            }}
          />
          {icon ? (
            <Ionicons
              name={icon}
              size={20}
              color={focused ? colors.primary : colors.textMuted}
              style={styles.iconRight}
            />
          ) : null}
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.xs,
    alignSelf: 'stretch',
    width: '100%',
  },
  label: {
    ...typography.label,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
    alignSelf: 'stretch',
    width: '100%',
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    width: '100%',
  },
  labelFlex: {
    // Content-width so the label + ⓘ tooltip cluster together at the
    // start (visual RIGHT under RTL), with the ⓘ immediately to the
    // LEFT of the label text (not pushed to the far edge of the row).
    flexShrink: 1,
    width: undefined,
    alignSelf: 'auto',
  },
  requiredStar: {
    color: colors.danger,
    fontWeight: '700',
  },
  field: {
    // Text first, icon second: the icon lands visually left under forceRTL.
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F5F5F5',
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    minHeight: 52,
    // Border is invisible at rest (same colour as the fill). When the
    // field gains focus the Reanimated style interpolates the colour to
    // colors.primary, drawing a subtle blue outline without shifting
    // any pixels (constant border width = no layout reflow).
    borderWidth: 1.5,
    borderColor: '#F5F5F5',
  },
  input: {
    ...typography.body,
    color: colors.text,
    flex: 1,
    // TextInput value uses physical 'right' on every platform.
    // Unlike <Text> labels (where Android forceRTL interprets
    // textAlign:'right' as logical end → visual LEFT and we have
    // RTL_LABEL_ALIGN to compensate), Android <TextInput> respects
    // PHYSICAL alignment: 'right' actually pushes both Hebrew and
    // digit content to the visual right edge. The earlier sweep that
    // replaced literal 'right' with RTL_LABEL_ALIGN here regressed
    // short Hebrew values into hugging the LEFT — restoring the
    // explicit 'right' fixes both the date Pressable text and the
    // editable TextInput.
    textAlign: 'right',
    // Pull the cursor onto the same baseline as the icon — RN's default
    // line-height pushes the digit down a few pixels otherwise.
    paddingVertical: spacing.sm,
  },
  inputDisplay: {
    // <Text> (tap variant) needs the logical alignment so Hebrew values
    // sit on the visual right under Android forceRTL.
    textAlign: RTL_LABEL_ALIGN,
  },
  iconRight: {
    marginStart: spacing.sm,
  },
});
