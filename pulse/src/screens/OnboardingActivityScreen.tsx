import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { RtlTextInput as TextInput } from '../components/RtlTextInput';
import { useRoute } from '@react-navigation/native';
import { Disclosure, SectionTabs, Screen } from '../components/ui';
import { RTL_LABEL_ALIGN, colors, font  } from '../theme';
import { queryByCreatedAt, queryEquals, type FsDoc } from '../services/firestoreRest';
import { activityLabel } from '../services/onboardingActivityCatalog';
import { createOnboardingActivityLoader } from '../services/onboardingActivityLoader';

const time = (ms: number) => new Date(ms).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });

export function OnboardingActivityScreen() {
  const [search, setSearch] = useState('');
  const route = useRoute<any>();
  const [session, setSession] = useState<string | null>(route.params?.sessionId ?? null);
  const [rows, setRows] = useState<FsDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [counts, setCounts] = useState(false);
  useEffect(() => { if (route.params?.sessionId) setSession(route.params.sessionId); }, [route.params?.sessionId]);
  const loader = useMemo(() => createOnboardingActivityLoader<FsDoc>({
    query: async (selectedSession) => {
      const result = selectedSession
        ? await queryEquals('onboardingActivity', 'sessionId', selectedSession, 2000)
        : await queryByCreatedAt('onboardingActivity', Date.now() - 86400000, Date.now(), 'integer', 2000);
      return result.sort((a, b) => selectedSession ? a.sequence - b.sequence : b.createdAt - a.createdAt);
    },
    rows: setRows, error: setError, loading: setLoading,
  }), []);
  const load = useCallback(() => loader.load(session), [loader, session]);
  useEffect(() => { void load(); return () => loader.cancel(); }, [load, loader]);
  const needle = search.trim().toLocaleLowerCase();
  const filtered = rows.filter(row => !needle || `${activityLabel(row.action, row.params)} ${row.actorName ?? ''} ${row.uid ?? ''} ${row.sessionId}`.toLocaleLowerCase().includes(needle));
  const grouped = Object.entries(filtered.reduce<Record<string, number>>((out, row) => {
    const label = activityLabel(row.action, row.params);
    out[label] = (out[label] ?? 0) + 1; return out;
  }, {})).sort((a, b) => b[1] - a[1]);
  return <Screen title="מסלול ההצטרפות" subtitle={session ? 'רצף הפעולות של הביקור הנבחר' : 'פעולות שהתקבלו ב־24 השעות האחרונות'} scroll={false}>
    <View style={s.toolbar}>
      <SectionTabs value={counts ? 'counts' : 'timeline'} onChange={value => setCounts(value === 'counts')} items={[{key:'timeline',label:'רצף הפעולות'}, {key:'counts',label:'ספירת פעולות'}]} />
      {session ? <Pressable onPress={() => setSession(null)} style={s.button}><Text style={s.buttonText}>לכל הביקורים</Text></Pressable> : null}
    </View>
    <TextInput value={search} onChangeText={setSearch} placeholder="חיפוש פעולה, משתמש או ביקור" placeholderTextColor={colors.textMuted} accessibilityLabel="חיפוש במסלול ההצטרפות" style={{ direction: 'rtl' as const,padding:14,borderRadius:12,backgroundColor:colors.surface,color:colors.text,textAlign: RTL_LABEL_ALIGN}} />
    <Text style={s.meta}>{rows.length} פעולות · {new Set(rows.map(row => row.sessionId)).size} ביקורים{rows.length >= 2000 ? ' · מוצגת תקרה של 2,000 פעולות; הספירה חלקית' : ''}</Text>
    {error ? <Pressable onPress={load}><Text style={s.error}>{error}</Text></Pressable> : null}
    {loading && !rows.length ? <ActivityIndicator color={colors.primary} /> : null}
    {counts ? <FlatList data={grouped} keyExtractor={row => row[0]} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.primary} />} renderItem={({ item }) => <View style={s.card}><Text style={font.title}>{item[0]}</Text><Text style={s.count}>{item[1]}</Text></View>} />
      : <FlatList data={filtered} keyExtractor={row => row.id} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.primary} />}
        ListEmptyComponent={!loading && !error ? <Text style={s.meta}>אין פעולות התואמות לטווח ולחיפוש הנוכחיים.</Text> : null}
        renderItem={({ item }) => <View style={s.card}>
          <Pressable accessibilityRole="button" onPress={() => setSession(item.sessionId)}>
          <Text style={font.title}>{activityLabel(item.action, item.params)}</Text>
          <Text style={s.meta}>{time(item.occurredAt)} · פעולה {item.sequence} · {item.actorName || (item.anonymous ? 'אורח' : 'חשבון מחובר')}</Text>
          </Pressable>
          <Disclosure title="פרטי הפעולה ומסירה">
          <Text style={s.meta} selectable>ביקור: {item.sessionId}</Text>
          <Text style={s.meta} selectable>מזהה שחקן: {item.uid}</Text>
          {Object.entries(item.params ?? {}).map(([key, value]) => <Text key={key} style={s.detail} selectable>{key}: {String(value)}</Text>)}
          <Text style={s.delivery}>{({ pending: 'ממתין לעיבוד', history_only: 'נשמר ברצף בלבד — ללא פוש', milestone_duplicate: 'בחירה חוזרת — נשמרה ללא פוש נוסף', sent: 'נשלח לשירות ההתראות', muted: 'ההתראות כבויות', no_devices: 'אין מכשיר רשום להתראות', retrying: 'ממתין לניסיון מסירה נוסף' } as Record<string, string>)[item.pushStatus] ?? 'מצב מסירה לא ידוע'}</Text>
          </Disclosure>
        </View>} />}
  </Screen>;
}

const s = StyleSheet.create({
  toolbar: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingVertical: 10 },
  button: { backgroundColor: colors.primarySoft, padding: 10, borderRadius: 10 },
  buttonText: { color: colors.text, fontWeight: '700' },
  card: { marginHorizontal: 16, marginBottom: 10, padding: 16, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, gap: 6 },
  meta: { direction: 'rtl' as const, color: colors.textSoft, textAlign: RTL_LABEL_ALIGN, fontSize: 12, paddingHorizontal: 16, paddingBottom: 8 },
  detail: { direction: 'rtl' as const, color: colors.textSoft, textAlign: RTL_LABEL_ALIGN, fontSize: 12 },
  delivery: { direction: 'rtl' as const, color: colors.primary, textAlign: RTL_LABEL_ALIGN, fontSize: 12 },
  error: { direction: 'rtl' as const, color: colors.red, padding: 16, textAlign: RTL_LABEL_ALIGN },
  count: { direction: 'rtl' as const, color: colors.primary, fontSize: 24, fontWeight: '800', textAlign: RTL_LABEL_ALIGN },
});
