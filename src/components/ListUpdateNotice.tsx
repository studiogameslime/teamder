import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export function ListUpdateNotice({ count, noun, onPress, direction = 'up' }: { count: number; noun: string; onPress: () => void; direction?: 'up' | 'down' }) {
  const label = count === 1 ? 'יש עדכון חדש' : count > 1 ? `נוספו ${count} ${noun}` : 'הרשימה עודכנה';
  return <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${label}. הצג עדכונים`} accessibilityLiveRegion="polite" style={s.chip}>
    <Ionicons name={direction === 'down' ? 'arrow-down-outline' : 'arrow-up-outline'} size={17} color="#FFFFFF" accessible={false} />
    <Text style={s.text}>{label}</Text><Text style={s.action}>הצג</Text>
  </Pressable>;
}
const s = StyleSheet.create({
  chip: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, minHeight: 44, paddingHorizontal: 16,
    paddingVertical: 9, borderRadius: 24, backgroundColor: '#2467E8', shadowColor: '#102344', shadowOpacity: 0.16,
    shadowRadius: 9, shadowOffset: { width: 0, height: 3 }, elevation: 5 },
  text: { color: '#FFFFFF', fontSize: 13, fontWeight: '700', flexShrink: 1 }, action: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
});
