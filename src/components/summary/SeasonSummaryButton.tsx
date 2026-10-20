import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';

export function SeasonSummaryButton({ onPress }: { onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={he.seasonsMySummaryOfCta}
    onPress={onPress} style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
    <View style={styles.icon}><Ionicons name="sparkles-outline" size={21} color={colors.primary} /></View>
    <Text style={styles.label}>{he.seasonsMySummaryOfCta}</Text>
    <Ionicons name="chevron-back" size={19} color={colors.primary} />
  </Pressable>;
}

const styles = StyleSheet.create({
  button: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 58, paddingVertical: 10,
    paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, borderColor: '#DFEAF8', backgroundColor: colors.surface },
  pressed: { backgroundColor: '#EDF4FF' },
  icon: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: '#EDF4FF' },
  label: { flex: 1, fontSize: 16, lineHeight: 22, fontWeight: '700', color: colors.primary, textAlign: RTL_LABEL_ALIGN },
});
