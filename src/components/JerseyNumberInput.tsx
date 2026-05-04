// JerseyNumberInput — large 2-digit text field used wherever the
// player picks their shirt number (onboarding + jersey editor).
//
// Design intent:
//   • The visual is a card-sized centered "00" input — the slot itself
//     telegraphs "two digits go here" without needing helper copy.
//   • Numeric keyboard is forced; non-digits are stripped on input.
//   • Caller owns the value as a string so the field can be
//     transiently empty while the user clears + retypes. Clamping to
//     [1, 99] is a save-time concern, not an input-time one — typing
//     "0" should be allowed mid-edit.
//
// Returns the cleaned string (digits only, max length 2). Empty string
// is a valid intermediate value; callers decide how to interpret it
// at submit time.

import React from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, radius, spacing, typography } from '@/theme';

interface Props {
  value: string;
  onChangeText: (next: string) => void;
  /** Optional caption rendered below the field. */
  hint?: string;
  /** Optional accessibility label override (defaults to "מספר חולצה"). */
  accessibilityLabel?: string;
}

export function JerseyNumberInput({
  value,
  onChangeText,
  hint,
  accessibilityLabel,
}: Props) {
  return (
    <View style={styles.wrap}>
      <View style={styles.fieldShell}>
        <TextInput
          value={value}
          onChangeText={(t) =>
            onChangeText(t.replace(/[^0-9]/g, '').slice(0, 2))
          }
          placeholder="00"
          placeholderTextColor={colors.textMuted}
          keyboardType="number-pad"
          maxLength={2}
          textAlign="center"
          style={styles.input}
          accessibilityLabel={accessibilityLabel ?? 'מספר חולצה'}
          // Selecting on focus makes "tap → re-type" the natural
          // gesture, which matches how a 2-digit field is normally
          // edited (replace, don't append).
          selectTextOnFocus
        />
      </View>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    gap: spacing.xs,
  },
  // Pill-card with a subtle inset look so the field reads as a slot,
  // not as a generic inline text input. Width is sized for two digits
  // at the chosen font size — 96 px is enough headroom on tablet
  // scaling while still feeling tight.
  fieldShell: {
    width: 110,
    height: 84,
    borderRadius: radius.xl,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    // Elevation/shadow on iOS only — Android renders shadow weirdly
    // on a TextInput parent and we don't need both layers.
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 2,
  },
  input: {
    color: colors.text,
    fontSize: 44,
    fontWeight: '800',
    lineHeight: 52,
    width: '100%',
    height: '100%',
    textAlign: 'center',
    // Slight letter-spacing reads as "two digit slot" instead of a
    // single number, reinforcing the affordance.
    letterSpacing: 4,
    padding: 0,
  },
  hint: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
  },
});
