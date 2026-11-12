import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, RTL_LABEL_ALIGN } from '@/theme';
import { teamName } from './rotationView';
import { teamSizeFromFormat, type LiveRoundEditRecord } from '@/types';

/** Informational allocation history, never an input to statistical calculations. */
export function LiveRoundEditsCard({ edits, nameOf }: { edits?: LiveRoundEditRecord[]; nameOf: (id: string) => string }) {
  const [open, setOpen] = useState(false);
  if (!edits?.length) return null;
  const snapshots = [{ label: 'לפני העריכה הראשונה', value: edits[0].before },
    ...edits.map((edit, i) => ({ label: `עריכה ${i + 1}, מתחילת משחק ${edit.roundNumber} מחדש`, value: edit.after }))];
  return <View style={s.card}>
    <Pressable onPress={() => setOpen(!open)} accessibilityRole="button" accessibilityState={{ expanded: open }} style={s.button}><Text style={s.title}>חלוקות לאורך המחזור ({edits.length + 1})</Text><Text style={s.hint}>{open ? 'הסתרה' : 'צפייה'}</Text></Pressable>
    {open && <><Text style={s.hint}>תיעוד החלוקה בלבד. התוצאות והסטטיסטיקות מחושבות מהמשחקים שנשמרו.</Text>{snapshots.map((row, i) => <View key={i} style={s.snapshot}>
      <Text style={s.title}>{row.label}</Text><Text style={s.hint}>{row.value.activeIds.length} שחקנים, {row.value.teams.length} קבוצות, {teamSizeFromFormat(row.value.format)} על {teamSizeFromFormat(row.value.format)} במגרש</Text>
      {row.value.teams.map(t => <Text key={t.index} style={s.text}>{teamName(t.index, row.value.teams)}: {t.playerIds.map(nameOf).join(', ')}</Text>)}
    </View>)}</>}
  </View>;
}
const s = StyleSheet.create({
  card: { borderRadius: 14, backgroundColor: colors.surfaceMuted, padding: 12, gap: 10, marginVertical: 12 },
  button: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 44, gap: 8 },
  title: { color: colors.text, fontSize: 15, fontWeight: '700', textAlign: RTL_LABEL_ALIGN, flexShrink: 1 },
  hint: { color: colors.textMuted, fontSize: 13, lineHeight: 21, textAlign: RTL_LABEL_ALIGN }, text: { color: colors.text, fontSize: 14, lineHeight: 23, textAlign: RTL_LABEL_ALIGN },
  snapshot: { gap: 6, borderTopWidth: 1, borderColor: colors.border, paddingTop: 12 },
});
