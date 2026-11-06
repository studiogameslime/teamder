import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { RTL_LABEL_ALIGN } from '@/theme';

export type ManagerRatingFilter = 'all' | 'up' | 'down';
export const availableManagerRatingFilter = (filter: ManagerRatingFilter, complete: boolean): ManagerRatingFilter => complete ? filter : 'all';

/** Recommendation counts are facts only after every requested score read has
 * settled successfully. Partial history can still show its available players. */
export function ManagerRatingFilters({ filter, complete, count, up, down, onSelect }: {
  filter: ManagerRatingFilter; complete: boolean; count: number; up: number; down: number;
  onSelect: (filter: ManagerRatingFilter) => void;
}) {
  const active = availableManagerRatingFilter(filter, complete);
  const rows: Array<{ key: ManagerRatingFilter; label: string }> = [
    { key: 'all', label: complete ? `הכול (${count})` : count ? `זמינים (${count})` : 'הכול' },
    { key: 'up', label: complete ? `העלאה (${up})` : 'העלאה' },
    { key: 'down', label: complete ? `הורדה (${down})` : 'הורדה' },
  ];
  return <View style={styles.filters}>{rows.map(row => {
    const selected = active === row.key, disabled = !complete && row.key !== 'all';
    return <Pressable key={row.key} accessibilityRole="button" accessibilityState={{ selected, disabled }} disabled={disabled}
      onPress={() => onSelect(row.key)} style={[styles.filter, selected && { backgroundColor: row.key === 'down' ? '#FFF0D6' : '#2467F5' }, disabled && { opacity: 0.55 }]}>
      <Text style={[styles.text, selected && { color: row.key === 'down' ? '#A66709' : '#FFF' }]}>{row.label}</Text>
      {row.key !== 'all' && <Ionicons name={row.key === 'up' ? 'arrow-up' : 'arrow-down'} size={13} color={selected ? row.key === 'down' ? '#A66709' : '#FFF' : '#101B47'}/>}</Pressable>;
  })}</View>;
}
const styles = StyleSheet.create({
  filters: { flexDirection: 'row', gap: 6 },
  filter: { flex: 1, flexDirection: 'row', gap: 4, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E6ECF5', borderRadius: 11, minHeight: 48, paddingHorizontal: 3 },
  text: { fontSize: 13, fontWeight: '700', color: '#101B47', textAlign: RTL_LABEL_ALIGN },
});
