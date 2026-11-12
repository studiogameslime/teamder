import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { PressableScale } from '@/components/PressableScale';
import { colors, RTL_LABEL_ALIGN } from '@/theme';

/** The same method picker is used before a round and while editing a live round. */
export function DraftMethodCard({ icon, title, subtitle, onPress, selected, disabled, badge, accessibilityLabel }: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  onPress: () => void;
  selected: boolean;
  disabled?: boolean;
  badge?: string;
  accessibilityLabel?: string;
}) {
  return <PressableScale onPress={onPress} disabled={disabled}
    style={[s.card, selected && s.selected, disabled && s.disabled]}
    accessibilityRole="radio" accessibilityLabel={accessibilityLabel ?? `${title}. ${subtitle}${badge ? `. ${badge}` : ''}`}
    accessibilityState={{ checked: selected, disabled: !!disabled }}>
    <View style={s.row}>
      <View style={s.icon}><Ionicons name={icon} size={26} color={disabled ? '#8795AF' : '#12234D'}/></View>
      <View style={s.body}>
        <Text style={s.title}>{title}</Text>
        <Text style={s.subtitle}>{subtitle}</Text>
        {!!badge && <View style={[s.badge, disabled && s.badgeDisabled]}><Text style={[s.badgeText, disabled && s.badgeTextDisabled]}>{badge}</Text></View>}
      </View>
      <View style={[s.radio, selected && s.radioOn]}>{selected && <View style={s.radioDot}/>}</View>
    </View>
  </PressableScale>;
}

const s = StyleSheet.create({
  card: { backgroundColor: '#FFF', borderRadius: 24, borderWidth: 1.5, borderColor: '#E1EBFA', padding: 18, marginBottom: 12, minHeight: 104 },
  selected: { borderColor: '#2D68FF', backgroundColor: '#F7FAFF' },
  disabled: { backgroundColor: '#F0F3F8' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  icon: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#E8F1FF', alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, minWidth: 0, gap: 6 },
  title: { fontSize: 19, fontWeight: '800', color: '#0C1942', textAlign: RTL_LABEL_ALIGN },
  subtitle: { fontSize: 14, lineHeight: 21, color: '#6C7EA0', textAlign: RTL_LABEL_ALIGN },
  badge: { alignSelf: 'flex-start', backgroundColor: '#DCF4EC', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, marginTop: 4 },
  badgeText: { fontSize: 12, color: '#216D54', textAlign: RTL_LABEL_ALIGN },
  badgeDisabled: { backgroundColor: '#E2E8F2' },
  badgeTextDisabled: { color: '#66758E' },
  radio: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  radioOn: { borderColor: colors.primary },
  radioDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.primary },
});
