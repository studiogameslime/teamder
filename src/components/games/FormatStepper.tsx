// FormatStepper — the "פורמט המחזור" card: one summary plus two steppers.
//
// Replaces two rows of fixed chips (4v4–7v7, 2–5 teams) that capped the app at
// numbers nothing underneath actually required. The ceilings here are real and
// are documented where they are defined, in @/types.
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import {
  commitTyped,
  fitAgainstRoster,
  stepBy,
  totalPlayers,
} from '@/utils/formatPicker';
import { he } from '@/i18n/he';

interface StepperProps {
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
}

/** One labelled −/number/+ row. The number is also a numeric input, so a jump
 *  from 3 to 11 does not cost eight taps. */
function Stepper({ label, hint, value, min, max, onChange }: StepperProps) {
  // While the field is focused the raw string is held here, so a half-typed
  // value — including "" mid-edit — is never pushed up as NaN. Committed on
  // blur, clamped.
  const [draft, setDraft] = useState<string | null>(null);
  const bounds = useMemo(() => ({ min, max }), [min, max]);

  const commit = () => {
    if (draft === null) return;
    onChange(commitTyped(draft, value, bounds));
    setDraft(null);
  };

  // − and + act on what is ON SCREEN, which mid-edit is the draft, not the
  // committed value. Typing 2 and then pressing + must give 3; without this it
  // gave "old value + 1" and the tap looked like it had been swallowed.
  const nudge = (delta: number) => {
    const base = draft === null ? value : commitTyped(draft, value, bounds);
    setDraft(null);
    onChange(stepBy(base, delta, bounds));
  };

  // Edge state follows the on-screen number for the same reason.
  const shown = draft === null ? value : commitTyped(draft, value, bounds);
  const atMin = shown <= min;
  const atMax = shown >= max;

  return (
    <View style={styles.row}>
      <View style={styles.rowText}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowHint}>{hint}</Text>
      </View>

      {/* flexDirection is row-reverse so `−` sits on the visual LEFT and `+` on
          the right under RTL, matching how a stepper reads everywhere else.
          Writing the JSX in logical order and letting direction place it keeps
          "minus decreases" true in both directions. */}
      <View style={styles.stepper}>
        <Pressable
          onPress={() => nudge(-1)}
          disabled={atMin}
          hitSlop={8}
          style={({ pressed }) => [
            styles.stepBtn,
            atMin && styles.stepBtnOff,
            pressed && !atMin && styles.stepBtnPressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel={`${he.formatDecrease} ${label}`}
          accessibilityState={{ disabled: atMin }}
        >
          <Ionicons name="remove" size={22} color={atMin ? colors.textMuted : colors.primary} />
        </Pressable>

        <TextInput
          value={draft ?? String(value)}
          onChangeText={setDraft}
          onFocus={() => setDraft(String(value))}
          onBlur={commit}
          onSubmitEditing={commit}
          keyboardType="number-pad"
          inputMode="numeric"
          maxLength={2}
          selectTextOnFocus
          style={styles.valueBox}
          // Two digits in a chip sized for two digits. Android's largest font
          // setting scaled 20pt past the box and clipped the number — reported
          // with the steppers circled. Capped rather than unbounded: the value
          // still grows with the system setting, just not past the control
          // that holds it, and `minHeight` below lets the row breathe.
          maxFontSizeMultiplier={1.4}
          accessibilityLabel={`${label}: ${value}`}
        />

        <Pressable
          onPress={() => nudge(+1)}
          disabled={atMax}
          hitSlop={8}
          style={({ pressed }) => [
            styles.stepBtn,
            atMax && styles.stepBtnOff,
            pressed && !atMax && styles.stepBtnPressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel={`${he.formatIncrease} ${label}`}
          accessibilityState={{ disabled: atMax }}
        >
          <Ionicons name="add" size={22} color={atMax ? colors.textMuted : colors.primary} />
        </Pressable>
      </View>
    </View>
  );
}

export interface FormatStepperProps {
  teamSize: number;
  teamCount: number;
  /** Players already holding a slot, when the caller has the number to hand.
   *  Edit flow only — nothing here fetches it. */
  registeredCount?: number;
  sizeMin: number;
  sizeMax: number;
  countMin: number;
  countMax: number;
  onChangeTeamSize: (n: number) => void;
  onChangeTeamCount: (n: number) => void;
}

export function FormatStepper({
  teamSize,
  teamCount,
  registeredCount,
  sizeMin,
  sizeMax,
  countMin,
  countMax,
  onChangeTeamSize,
  onChangeTeamCount,
}: FormatStepperProps) {
  const total = totalPlayers(teamSize, teamCount);
  const fit = fitAgainstRoster(total, registeredCount);
  return (
    <View style={styles.card}>
      <Text style={styles.summary}>{he.formatSummary(teamSize, teamCount)}</Text>
      <View style={styles.totalRow}>
        <Text style={styles.totalText}>{he.formatTotalPlayers(total)}</Text>
        <Ionicons name="people" size={17} color={colors.primary} />
      </View>
      {fit ? (
        <View style={styles.totalRow}>
          <Text
            style={[
              styles.fitText,
              fit.kind === 'exact' ? styles.fitOk : styles.fitWarn,
            ]}
          >
            {fit.kind === 'exact'
              ? he.formatFitExact(total)
              : fit.kind === 'short'
                ? he.formatFitShort(fit.by)
                : he.formatFitOver(fit.by)}
          </Text>
          <Ionicons
            name={fit.kind === 'exact' ? 'checkmark-circle' : 'alert-circle'}
            size={15}
            color={fit.kind === 'exact' ? colors.success : colors.warning}
          />
        </View>
      ) : null}

      <View style={styles.divider} />

      <Stepper
        label={he.formatTeamSizeLabel}
        hint={he.formatTeamSizeHint}
        value={teamSize}
        min={sizeMin}
        max={sizeMax}
        onChange={onChangeTeamSize}
      />
      <Stepper
        label={he.formatTeamCountLabel}
        hint={he.formatTeamCountHint}
        value={teamCount}
        min={countMin}
        max={countMax}
        onChange={onChangeTeamCount}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  summary: {
    fontSize: 24,
    fontWeight: '800',
    color: colors.text,
    textAlign: RTL_LABEL_ALIGN,
  },
  // Text first, icon after: under RTL the first child sits rightmost, which
  // puts the group glyph on the visual left beside the count.
  totalRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  totalText: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.primary,
    textAlign: RTL_LABEL_ALIGN,
  },
  fitText: {
    fontSize: 13,
    fontWeight: '600',
    textAlign: RTL_LABEL_ALIGN,
  },
  fitOk: { color: colors.success },
  fitWarn: { color: colors.warning },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.xs,
  },
  rowText: { flex: 1, gap: 2 },
  rowLabel: {
    ...typography.body,
    fontWeight: '700',
    color: colors.text,
    textAlign: RTL_LABEL_ALIGN,
  },
  rowHint: {
    fontSize: 12,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
  },
  stepper: { flexDirection: 'row-reverse', alignItems: 'center', gap: spacing.xs },
  stepBtn: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnOff: { opacity: 0.4 },
  stepBtnPressed: { opacity: 0.6 },
  valueBox: {
    minWidth: 58,
    // minHeight, not height: a fixed one clips a scaled digit instead of
    // growing with it.
    minHeight: 44,
    borderRadius: radius.md,
    backgroundColor: colors.primaryLight,
    color: colors.primary,
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
    paddingHorizontal: spacing.xs,
  },
});
