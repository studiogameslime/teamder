import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { DraggableMenuSheet } from '@/components/DraggableMenuSheet';
import { RTL_LABEL_ALIGN } from '@/theme/rtl';

const factors = [
  { icon: 'trophy-outline', title: 'ניצחונות', text: 'המשקל הגבוה ביותר, עם התאמה למספר המשחקים ששיחקת.', color: '#178447', bg: '#E7F7EE' },
  { icon: 'football-outline', title: 'שערים', text: 'נמדדים מול נתוני המחזורים הקודמים במועדון.', color: '#A56B00', bg: '#FFF5DB' },
  { icon: 'git-network-outline', title: 'בישולים', text: 'גם הבישולים נמדדים ביחס להיסטוריה של המועדון.', color: '#7D29CF', bg: '#F2EAFE' },
] as const;

export function EveningScoreInfoSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  return <DraggableMenuSheet visible={visible} onClose={onClose}>
    <ScrollView style={s.scroll} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
      <View style={s.heading}>
        <View style={s.headingIcon}><Ionicons name="calculator-outline" size={25} color="#2469F4" /></View>
        <View style={s.flex}><Text style={s.title}>איך מחושב הציון?</Text>
          <Text style={s.subtitle}>המספר שמסכם את הביצועים שלך במחזור</Text></View>
      </View>
      <View style={s.range}><Text style={s.rangeTitle}>ציון המחזור שלך</Text>
        <Text style={s.rangeValue}>6 עד 10</Text></View>
      <Text style={s.section}>מה משפיע על הציון?</Text>
      {factors.map(f => <View key={f.title} style={s.factor}>
        <View style={[s.icon, { backgroundColor: f.bg }]}><Ionicons name={f.icon} size={23} color={f.color} /></View>
        <View style={s.flex}><Text style={s.factorTitle}>{f.title}</Text><Text style={s.body}>{f.text}</Text></View>
      </View>)}
      <Text style={s.extra}>במועדון חדש משתמשים ביעדי ברירת מחדל. כשיש מעורבות בפנדלים, גם היא משפיעה.</Text>
      <View style={s.note}><Ionicons name="information-circle-outline" size={22} color="#2469F4" />
        <Text style={[s.body, s.flex]}>הציון מבוסס על הנתונים שתועדו. הגנה, מסירות ומאמץ אינם נמדדים כאן, ולכן הוא אינו הערכה מלאה של היכולת שלך.</Text></View>
      <View style={s.ranking}><Text style={s.factorTitle}>הציון והטבלה במועדון</Text>
        <Text style={s.body}>המיקום במחזור מבוסס על הציון. טבלת העונה מבוססת על נקודות: שתי נקודות לכל שער ונקודה לכל בישול.</Text></View>
    </ScrollView>
    <View style={s.footer}><Pressable onPress={onClose} accessibilityRole="button" style={({ pressed }) => [s.button, pressed && { opacity: 0.85 }]}>
      <Text style={s.buttonText}>הבנתי</Text></Pressable></View>
  </DraggableMenuSheet>;
}

const s = StyleSheet.create({
  scroll: { flexShrink: 1 }, content: { paddingHorizontal: 22, paddingBottom: 14, gap: 14 }, flex: { flex: 1 },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headingIcon: { width: 48, height: 48, borderRadius: 15, backgroundColor: '#E8F0FF', alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 22, fontWeight: '800', color: '#111C48', textAlign: RTL_LABEL_ALIGN },
  subtitle: { fontSize: 13, color: '#69738B', textAlign: RTL_LABEL_ALIGN, marginTop: 4 },
  range: { borderRadius: 16, padding: 16, backgroundColor: '#2469F4', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  rangeTitle: { fontSize: 15, color: '#FFFFFF', fontWeight: '600', flexShrink: 1 },
  rangeValue: { fontSize: 23, color: '#FFFFFF', fontWeight: '800' },
  section: { fontSize: 16, color: '#111C48', fontWeight: '800', textAlign: RTL_LABEL_ALIGN },
  factor: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  icon: { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  factorTitle: { fontSize: 15, color: '#111C48', fontWeight: '700', textAlign: RTL_LABEL_ALIGN, marginBottom: 3 },
  body: { fontSize: 13, lineHeight: 20, color: '#69738B', textAlign: RTL_LABEL_ALIGN },
  extra: { fontSize: 12, lineHeight: 19, color: '#69738B', textAlign: RTL_LABEL_ALIGN },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, padding: 13, backgroundColor: '#EAF2FF', borderRadius: 14 },
  ranking: { borderTopWidth: 1, borderColor: '#E7EBF2', paddingTop: 13 },
  footer: { paddingHorizontal: 22, paddingTop: 8, paddingBottom: 14 },
  button: { backgroundColor: '#2469F4', borderRadius: 14, alignItems: 'center', paddingVertical: 14 },
  buttonText: { fontSize: 16, fontWeight: '800', color: '#FFFFFF' },
});
