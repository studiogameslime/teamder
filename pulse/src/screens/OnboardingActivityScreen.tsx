import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useRoute } from '@react-navigation/native';
import { Screen } from '../components/ui';
import { colors, font } from '../theme';
import { queryByCreatedAt, queryEquals, type FsDoc } from '../services/firestoreRest';
import { activityLabel } from '../services/onboardingActivityCatalog';

const time = (ms: number) => new Date(ms).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });

export function OnboardingActivityScreen() {
  const route = useRoute<any>();
  const [session, setSession] = useState<string | null>(route.params?.sessionId ?? null);
  const [rows, setRows] = useState<FsDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [counts, setCounts] = useState(false);
  useEffect(() => { if (route.params?.sessionId) setSession(route.params.sessionId); }, [route.params?.sessionId]);
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const result = session
        ? await queryEquals('onboardingActivity', 'sessionId', session, 2000)
        : await queryByCreatedAt('onboardingActivity', Date.now() - 86400000, Date.now(), 'integer', 2000);
      setRows(result.sort((a, b) => session ? a.sequence - b.sequence : b.createdAt - a.createdAt));
    } catch { setError('לא ניתן לטעון את הפעולות. נסו שוב.'); }
    finally { setLoading(false); }
  }, [session]);
  useEffect(() => { void load(); }, [load]);
  const grouped = Object.entries(rows.reduce<Record<string, number>>((out, row) => {
    const label = activityLabel(row.action, row.params);
    out[label] = (out[label] ?? 0) + 1; return out;
  }, {})).sort((a, b) => b[1] - a[1]);
  return <Screen title="מסלול ההצטרפות" subtitle={session ? 'רצף הפעולות של הביקור הנבחר' : 'פעולות שהתקבלו ב־24 השעות האחרונות'} scroll={false}>
    <View style={s.toolbar}>
      <Pressable onPress={() => setCounts(value => !value)} style={s.button}><Text style={s.buttonText}>{counts ? 'לרצף הפעולות' : 'ספירת פעולות'}</Text></Pressable>
      {session ? <Pressable onPress={() => setSession(null)} style={s.button}><Text style={s.buttonText}>לכל הביקורים</Text></Pressable> : null}
    </View>
    <Text style={s.meta}>{rows.length} פעולות · {new Set(rows.map(row => row.sessionId)).size} ביקורים{rows.length >= 2000 ? ' · מוצגת תקרה של 2,000 פעולות; הספירה חלקית' : ''}</Text>
    {error ? <Pressable onPress={load}><Text style={s.error}>{error}</Text></Pressable> : null}
    {loading && !rows.length ? <ActivityIndicator color={colors.primary} /> : null}
    {counts ? <FlatList data={grouped} keyExtractor={row => row[0]} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.primary} />} renderItem={({ item }) => <View style={s.card}><Text style={font.title}>{item[0]}</Text><Text style={s.count}>{item[1]}</Text></View>} />
      : <FlatList data={rows} keyExtractor={row => row.id} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.primary} />}
        ListEmptyComponent={!loading && !error ? <Text style={s.meta}>אין עדיין פעולות בטווח הזה. נדרשת גרסת האפליקציה ששולחת את התיעוד החדש.</Text> : null}
        renderItem={({ item }) => <Pressable style={s.card} onPress={() => setSession(item.sessionId)}>
          <Text style={font.title}>{activityLabel(item.action, item.params)}</Text>
          <Text style={s.meta}>{time(item.occurredAt)} · פעולה {item.sequence} · {item.actorName || (item.anonymous ? 'אורח' : 'חשבון מחובר')}</Text>
          <Text style={s.meta} selectable>ביקור: {item.sessionId}</Text>
          <Text style={s.meta} selectable>מזהה שחקן: {item.uid}</Text>
          {Object.entries(item.params ?? {}).map(([key, value]) => <Text key={key} style={s.detail} selectable>{key}: {String(value)}</Text>)}
          <Text style={s.delivery}>{({ pending: 'ממתין לעיבוד', history_only: 'נשמר ברצף בלבד — ללא פוש', milestone_duplicate: 'בחירה חוזרת — נשמרה ללא פוש נוסף', sent: 'נשלח לשירות ההתראות', muted: 'ההתראות כבויות', no_devices: 'אין מכשיר רשום להתראות', retrying: 'ממתין לניסיון מסירה נוסף' } as Record<string, string>)[item.pushStatus] ?? 'מצב מסירה לא ידוע'}</Text>
        </Pressable>} />}
  </Screen>;
}

const s = StyleSheet.create({
  toolbar: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingVertical: 10 },
  button: { backgroundColor: colors.primarySoft, padding: 10, borderRadius: 10 },
  buttonText: { color: colors.text, fontWeight: '700' },
  card: { marginHorizontal: 16, marginBottom: 10, padding: 16, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, gap: 6 },
  meta: { color: colors.textSoft, textAlign: 'right', fontSize: 12, paddingHorizontal: 16, paddingBottom: 8 },
  detail: { color: colors.textSoft, textAlign: 'right', fontSize: 12 },
  delivery: { color: colors.primary, textAlign: 'right', fontSize: 12 },
  error: { color: colors.red, padding: 16, textAlign: 'right' },
  count: { color: colors.primary, fontSize: 24, fontWeight: '800', textAlign: 'right' },
});
