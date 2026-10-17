import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

/** Source order is reading order: forceRTL puts the first stage on the right. */
export function MatchSteps({ labels, current, onSelect, disabled, accentColor = '#2563EB', completedColor = '#DBEAFE', connected = false }: {
  labels: string[]; current: number; onSelect?: (index: number) => void; disabled?: boolean;
  accentColor?: string; completedColor?: string; connected?: boolean;
}) {
  return <View style={s.row}>
    {connected && labels.length > 1 && <View pointerEvents="none" accessible={false} style={[s.connector,{left:`${50/labels.length}%`,right:`${50/labels.length}%`}]}/>}
    {labels.map((label, index) => <Pressable key={label}
    disabled={disabled || !onSelect || index > current} onPress={() => onSelect?.(index)}
    accessibilityRole="button" accessibilityLabel={`${index + 1}, ${label}${index === current ? ', השלב הנוכחי' : ''}`}
    accessibilityState={{ selected: index === current, disabled: disabled || !onSelect || index > current }} style={s.step}>
    <View style={[s.circle, index === current && {backgroundColor:accentColor}, index < current && {backgroundColor:completedColor}]}>
      {index < current ? <Ionicons name="checkmark" size={19} color={accentColor}/> : <Text style={[s.number, index === current && s.white]}>{index + 1}</Text>}
    </View><Text style={[s.label, index <= current && {color:accentColor}]}>{label}</Text>
  </Pressable>)}</View>;
}
const s = StyleSheet.create({ row: { flexDirection: 'row', paddingVertical: 8 }, connector: { position: 'absolute', top: 25, height: 1, backgroundColor: '#E2E8F0' }, step: { flex: 1, alignItems: 'center', gap: 5, minHeight: 58 }, circle: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#F1F5F9', alignItems: 'center', justifyContent: 'center' }, number: { color: '#64748B', fontWeight: '800', fontSize: 16 }, white: { color: '#FFF' }, label: { color: '#64748B', fontSize: 13, fontWeight: '700' } });
