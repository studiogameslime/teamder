import React, { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, radius } from '../theme';

export interface Opt {
  value: string;
  label: string;
}

// Compact select: a pill showing the current value + chevron that opens a
// centered sheet of options. Reused across the segment / campaign / link
// builders for the dropdown-driven layout.
export function Dropdown({
  value, options, onSelect, placeholder, flex, title,
}: {
  value?: string;
  options: Opt[];
  onSelect: (v: string) => void;
  placeholder?: string;
  flex?: number;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const cur = options.find((o) => o.value === value);
  return (
    <>
      <Pressable style={[s.box, flex ? { flex } : null]} onPress={() => setOpen(true)}>
        <Text style={s.chev}>▾</Text>
        <Text style={[s.val, !cur && s.ph]} numberOfLines={1}>
          {cur ? cur.label : placeholder ?? 'בחר'}
        </Text>
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={s.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={s.sheet} onPress={(e) => e.stopPropagation()}>
            {title ? <Text style={s.title}>{title}</Text> : null}
            <ScrollView style={{ maxHeight: 360 }} showsVerticalScrollIndicator={false}>
              {options.map((o) => (
                <Pressable key={o.value} style={s.item} onPress={() => { onSelect(o.value); setOpen(false); }}>
                  {o.value === value ? <Text style={s.check}>✓</Text> : <View style={{ width: 18 }} />}
                  <Text style={[s.itemTxt, o.value === value && s.itemOn]}>{o.label}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const s = StyleSheet.create({
  box: {
    flexDirection: 'row-reverse', alignItems: 'center', gap: 6,
    backgroundColor: colors.surfaceAlt, borderRadius: radius.sm,
    borderWidth: 1, borderColor: colors.border, paddingHorizontal: 11, paddingVertical: 10,
  },
  chev: { color: colors.textMuted, fontSize: 12 },
  val: { flex: 1, color: colors.text, fontSize: 14, fontWeight: '600', textAlign: 'right' },
  ph: { color: colors.textMuted, fontWeight: '400' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', paddingHorizontal: 28 },
  sheet: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingVertical: 6 },
  title: { color: colors.textMuted, fontSize: 12, fontWeight: '700', textAlign: 'right', paddingHorizontal: 16, paddingVertical: 8 },
  item: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 13 },
  itemTxt: { flex: 1, color: colors.textSoft, fontSize: 15, fontWeight: '600', textAlign: 'right' },
  itemOn: { color: colors.text },
  check: { width: 18, color: colors.primary, fontSize: 15, fontWeight: '800', textAlign: 'center' },
});
