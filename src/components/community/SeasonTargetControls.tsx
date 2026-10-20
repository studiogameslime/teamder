import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';

export function Chip({ label, active, onPress, disabled = false }: {
  label: string; active: boolean; onPress: () => void; disabled?: boolean;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: active, disabled }}
    disabled={disabled} onPress={onPress} style={[styles.chip, active && styles.selected, disabled && styles.disabled]}>
    <Text style={[styles.chipText, active && styles.selectedText]}>{label}</Text>
  </Pressable>;
}

export function Stepper({ label, value, unit, min, max = 200, step = 1, onChange, disabled = false }: {
  label: string; value: number; unit: string; min: number; max?: number; step?: number; onChange: (n: number) => void; disabled?: boolean;
}) {
  return <View style={styles.stepper}>
    <Text style={styles.hint}>{label}</Text>
    <View style={styles.row}>
      <Pressable accessibilityRole="button" accessibilityLabel="הפחתה" disabled={disabled || value <= min}
        onPress={() => onChange(Math.max(min, value - step))} style={[styles.step, (disabled || value <= min) && styles.disabled]}>
        <Text style={styles.symbol}>−</Text>
      </Pressable>
      <Text style={styles.value}>{unit}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="הוספה" disabled={disabled || value >= max}
        onPress={() => onChange(Math.min(max, value + step))} style={[styles.step, (disabled || value >= max) && styles.disabled]}>
        <Text style={styles.symbol}>+</Text>
      </Pressable>
    </View>
  </View>;
}
const styles = StyleSheet.create({
  chip: { minHeight: 44, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, justifyContent: 'center', borderRadius: radius.pill,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceMuted },
  selected: { borderColor: colors.primary, backgroundColor: colors.primary },
  chipText: { ...typography.caption, color: colors.text, fontWeight: '600' }, selectedText: { color: '#fff' },
  disabled: { opacity: 0.4 }, stepper: { gap: spacing.sm }, row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  step: { width: 44, height: 44, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  symbol: { ...typography.h3, color: colors.primary }, value: { ...typography.body, color: colors.text, fontWeight: '800', textAlign: 'center', minWidth: 120 },
  hint: { ...typography.caption, color: colors.textMuted, textAlign: RTL_LABEL_ALIGN },
});
