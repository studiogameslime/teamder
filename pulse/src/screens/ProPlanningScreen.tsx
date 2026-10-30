import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, SectionList, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { Screen } from '../components/ui';
import { colors, font, radius, RTL_INPUT_ALIGN, RTL_LABEL_ALIGN } from '../theme';
import { PLANNING_FEATURES } from '../data/proPlanningFeatures';
import { observeCaughtError } from '../services/errorObservation';
import { filterPlanningFeatures, loadProPlan, saveProPlan, type ProFilter, type ProPlan } from '../services/proPlanning';

export function ProPlanningScreen() {
  const [plan, setPlan] = useState<ProPlan | null>(null);
  const [filter, setFilter] = useState<ProFilter>('all');
  const [category, setCategory] = useState('all');
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [retry, setRetry] = useState(0);
  const busy = useRef(false);
  useEffect(() => {
    let alive = true;
    setError('');
    loadProPlan().then(value => { if (alive) setPlan(value); }).catch((error: unknown) => {
      observeCaughtError(error, { source: 'pulse/src/screens/ProPlanningScreen.tsx', handler: 'ProPlanningScreen', site: 'proPlanning:load' });
      if (alive) setError('לא הצלחנו לטעון את הסימונים. נסו שוב לפני עריכה.');
    });
    return () => { alive = false; };
  }, [retry]);
  const categories = useMemo(() => [...new Set(PLANNING_FEATURES.map(item => item.category))], []);
  const visible = useMemo(() => filterPlanningFeatures(PLANNING_FEATURES, plan ?? {}, filter, category, search), [plan, filter, category, search]);
  const sections = categories.map(title => ({ title, data: visible.filter(item => item.category === title) })).filter(section => section.data.length);
  const pro = PLANNING_FEATURES.filter(item => plan?.[item.id] === true).length;
  const toggle = async (id: string, value: boolean) => {
    if (!plan || busy.current) return;
    busy.current = true;
    setSaving(true);
    setError('');
    const next = { ...plan, [id]: value };
    // Commit UI only after persistence succeeds. A failed save preserves the previous choice.
    try { await saveProPlan(next); setPlan(next); }
    catch (error) {
      observeCaughtError(error, { source: 'pulse/src/screens/ProPlanningScreen.tsx', handler: 'toggle', site: 'proPlanning:save' });
      setError('השינוי לא נשמר. הסימון הקודם נשאר, אפשר לנסות שוב.');
    }
    finally { busy.current = false; setSaving(false); }
  };
  return <Screen title="תכנון פרו" subtitle="מחליטים יחד מה ייכלל בפרו" scroll={false}>
    <View style={s.notice}><Text style={s.noticeTitle}>לוח תכנון פנימי בלבד</Text><Text style={s.body}>הסימונים לא משנים את האפליקציה. הרשימה כוללת פיצ'רים קיימים ומתועדים, גם כאלה שטרם הופצו.</Text><Text style={s.muted}>נשמר במכשיר הזה בלבד. כולם מתחילים כלא פרו.</Text></View>
    {plan === null ? <View style={s.empty}>{error ? <><Text style={s.error} accessibilityRole="alert">{error}</Text><Pressable style={s.chip} onPress={() => setRetry(v => v + 1)}><Text style={s.body}>ניסיון נוסף</Text></Pressable></> : <ActivityIndicator color={colors.primary} />}</View> : <>
      <View style={s.counts}>{[['כל הפיצ׳רים', PLANNING_FEATURES.length], ['פרו', pro], ['לא פרו', PLANNING_FEATURES.length - pro]].map(([label, count]) => <View key={label} style={s.count}><Text style={s.number}>{count}</Text><Text style={s.muted}>{label}</Text></View>)}</View>
      <TextInput style={s.search} value={search} onChangeText={setSearch} placeholder="חיפוש פיצ'ר" placeholderTextColor={colors.textMuted} accessibilityLabel="חיפוש פיצ'ר" />
      <View style={s.filters}>{([['all', 'הכל'], ['pro', 'רק פרו'], ['free', 'רק לא פרו']] as const).map(([key, label]) => <Pressable key={key} accessibilityRole="button" accessibilityState={{ selected: filter === key }} onPress={() => setFilter(key)} style={[s.chip, filter === key && s.selected]}><Text style={s.body}>{label}</Text></Pressable>)}</View>
      <View><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.categories}>{['all', ...categories].map(key => <Pressable key={key} accessibilityRole="button" accessibilityState={{ selected: category === key }} onPress={() => setCategory(key)} style={[s.chip, category === key && s.selected]}><Text style={s.body}>{key === 'all' ? 'כל התחומים' : key}</Text></Pressable>)}</ScrollView></View>
      <Text style={s.muted} accessibilityLiveRegion="polite">{saving ? 'שומר סימון...' : `מוצגים ${visible.length} מתוך ${PLANNING_FEATURES.length} פיצ'רים`}</Text>
      {error ? <Text style={s.error} accessibilityRole="alert">{error}</Text> : null}
      <SectionList style={{ flex: 1 }} sections={sections} keyExtractor={item => item.id} keyboardShouldPersistTaps="handled" stickySectionHeadersEnabled={false} contentContainerStyle={{ paddingBottom: 24 }}
        renderSectionHeader={({ section }) => <Text style={s.section}>{section.title} ({section.data.length})</Text>}
        ListEmptyComponent={<View style={s.empty}><Text style={font.title}>אין פיצ'רים בתצוגה הזו</Text><Text style={s.muted}>אפשר לשנות את החיפוש או את הסינון.</Text></View>}
        renderItem={({ item }) => <View style={[s.row, plan[item.id] === true && s.proRow]}><View style={{ flex: 1, gap: 5 }}><Text style={font.title}>{item.title}</Text><Text style={s.body}>{item.description}</Text><Text style={[s.muted, plan[item.id] === true && { color: colors.primary }]}>{plan[item.id] === true ? 'פרו' : 'לא פרו'}</Text></View><Switch accessibilityLabel={`${item.title}, פרו`} disabled={saving} value={plan[item.id] === true} onValueChange={value => toggle(item.id, value)} trackColor={{ false: colors.border, true: colors.primary }} thumbColor={colors.text} /></View>} />
    </>}
  </Screen>;
}

const s = StyleSheet.create({
  notice: { backgroundColor: colors.primarySoft, padding: 14, borderRadius: radius.md, gap: 6 },
  noticeTitle: { ...font.title, color: colors.primary },
  body: { ...font.body, lineHeight: 21 }, muted: { ...font.small, lineHeight: 19 },
  counts: { flexDirection: 'row', direction: 'rtl', gap: 8 },
  count: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.sm, padding: 10, gap: 3 },
  number: { ...font.big, textAlign: RTL_LABEL_ALIGN },
  search: { color: colors.text, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 14, minHeight: 48, textAlign: RTL_INPUT_ALIGN, fontSize: 15 },
  filters: { flexDirection: 'row', direction: 'rtl', gap: 8, flexWrap: 'wrap' },
  categories: { flexDirection: 'row', direction: 'rtl', gap: 8, paddingVertical: 2 },
  chip: { paddingVertical: 9, paddingHorizontal: 13, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, minHeight: 44, justifyContent: 'center' },
  selected: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  section: { ...font.h2, paddingTop: 16, paddingBottom: 10 },
  row: { flexDirection: 'row', direction: 'rtl', alignItems: 'center', gap: 10, padding: 14, backgroundColor: colors.surface, borderRadius: radius.md, marginBottom: 8, borderWidth: 1, borderColor: colors.border },
  proRow: { borderColor: colors.primary },
  empty: { paddingVertical: 24, gap: 12, alignItems: 'center' },
  error: { ...font.body, color: colors.red },
});
