import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Modal, RefreshControl, ScrollView, StyleSheet, Switch, Text, View, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, font, radius, space } from '../theme';
import { Screen, Card } from '../components/ui';
import { fetchAvailabilityCardEnabled, setAvailabilityCardEnabled } from '../services/homeConfig';
import {
  fetchAvailability,
  playersInCell,
  HEB_DAYS,
  TIME_BUCKETS,
  type AvailabilityData,
} from '../services/availabilityService';

const SURF = [26, 39, 64]; // surfaceAlt
const PRIM = [59, 130, 246]; // primary
function heat(v: number, max: number): string {
  const t = max > 0 ? v / max : 0;
  const c = SURF.map((s, i) => Math.round(s + (PRIM[i] - s) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

export function AvailabilityScreen() {
  const [data, setData] = useState<AvailabilityData | null>(null);
  const [city, setCity] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  // Drill-down: which cell was tapped (day + bucket, -1 bucket = day total).
  const [sel, setSel] = useState<{ day: number; bucket: number } | null>(null);
  // Master switch for the Teamder home availability card (appConfig/features).
  const [cardOn, setCardOn] = useState<boolean | null>(null);
  const [cardBusy, setCardBusy] = useState(false);
  useEffect(() => {
    fetchAvailabilityCardEnabled()
      .then(setCardOn)
      .catch(() => setCardOn(true));
  }, []);
  const onToggleCard = async (next: boolean) => {
    const prev = cardOn;
    setCardOn(next); // optimistic
    setCardBusy(true);
    const ok = await setAvailabilityCardEnabled(next).catch(() => false);
    setCardBusy(false);
    if (!ok) setCardOn(prev ?? true); // revert on failure
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await fetchAvailability(city));
    } catch (e) {
      // leave previous data; surfaced via empty state
      console.warn('[availability] load failed', (e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [city]);

  useEffect(() => {
    load();
  }, [load]);

  const max = data
    ? Math.max(1, ...data.grid.flatMap((r) => r))
    : 1;
  const maxTotal = data ? Math.max(1, ...data.dayTotal) : 1;

  return (
    <Screen
      title="זמינות שחקנים"
      subtitle={data ? `מבט-על · ${data.total} סימנו זמינות` : 'מבט-על'}
      scroll={false}
    >
      <ScrollView
        contentContainerStyle={{ padding: space(4), paddingBottom: space(10) }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.primary} />}
      >
        {/* Master switch — show/hide the "פנויים לשחק לידך" card on Teamder's home. */}
        <Card style={{ marginBottom: space(3), gap: space(3) }}>
          <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: space(3) }}>
            <View style={[cs.icon, { backgroundColor: (cardOn ? colors.green : colors.red) + '22' }]}>
              <Ionicons name="calendar" size={22} color={cardOn ? colors.green : colors.red} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={cs.title}>יומן "פנויים לשחק לידך" בבית</Text>
              <Text style={cs.state}>
                {cardOn === null ? '…' : cardOn ? 'תצוגת היומן מוצגת במסך הבית' : 'כבוי — היומן לא מוצג'}
              </Text>
            </View>
            {cardOn === null ? (
              <ActivityIndicator color={colors.primary} />
            ) : (
              <Switch
                value={cardOn}
                onValueChange={onToggleCard}
                disabled={cardBusy}
                trackColor={{ false: colors.border, true: colors.green }}
                thumbColor="#fff"
              />
            )}
          </View>
          <Text style={cs.help}>
            מכבה/מדליק רק את תצוגת היומן השבועי במסך הבית של Teamder. ההנעה
            "הגדר זמינות" (למי שעדיין לא סימן) ממשיכה להופיע כרגיל. המתג נשמר מיד,
            ונכנס לתוקף החל מהגרסה הבאה של Teamder (1.0.55+); על 1.0.54 היומן עדיין מוצג.
          </Text>
        </Card>

        {/* city filter */}
        {data && data.byCity.length > 1 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: space(3) }}>
            <Pressable onPress={() => setCity(undefined)} style={[s.chip, !city && s.chipOn]}>
              <Text style={[s.chipTxt, !city && s.chipTxtOn]}>הכל · {data.totalAll}</Text>
            </Pressable>
            {data.byCity
              .filter((c) => c.city !== '—')
              .slice(0, 12)
              .map((c) => (
                <Pressable
                  key={c.city}
                  onPress={() => setCity(city === c.city ? undefined : c.city)}
                  style={[s.chip, city === c.city && s.chipOn]}
                >
                  <Text style={[s.chipTxt, city === c.city && s.chipTxtOn]}>
                    {c.city} · {c.count}
                  </Text>
                </Pressable>
              ))}
          </ScrollView>
        ) : null}

        <Card>
          {/* header row */}
          <View style={s.row}>
            <Text style={[s.cellHead, s.dayCol]}>יום</Text>
            {TIME_BUCKETS.map((b) => (
              <Text key={b.key} style={[s.cellHead, s.col]}>{b.label}</Text>
            ))}
            <Text style={[s.cellHead, s.col, { color: colors.primary }]}>סה״כ</Text>
          </View>

          {HEB_DAYS.map((dayName, d) => (
            <View key={d} style={s.row}>
              <View style={[s.dayCol, s.dayCell]}>
                <Text style={s.dayTxt}>{dayName}</Text>
              </View>
              {data
                ? data.grid[d].map((v, bi) => (
                    <Pressable
                      key={bi}
                      disabled={v === 0}
                      onPress={() => setSel({ day: d, bucket: bi })}
                      style={({ pressed }) => [s.col, s.cell, { backgroundColor: heat(v, max) }, pressed && s.cellPressed]}
                    >
                      <Text style={[s.cellTxt, v / max > 0.5 && s.cellTxtHot]}>{v}</Text>
                    </Pressable>
                  ))
                : TIME_BUCKETS.map((_, bi) => <View key={bi} style={[s.col, s.cell]} />)}
              <Pressable
                disabled={!data || data.dayTotal[d] === 0}
                onPress={() => setSel({ day: d, bucket: -1 })}
                style={({ pressed }) => [s.col, s.cell, s.totalCell, data && { opacity: 0.4 + 0.6 * (data.dayTotal[d] / maxTotal) }, pressed && s.cellPressed]}
              >
                <Text style={s.totalTxt}>{data ? data.dayTotal[d] : ''}</Text>
              </Pressable>
            </View>
          ))}
        </Card>

        {data && data.noTime > 0 ? (
          <Text style={s.note}>
            {data.noTime} סימנו זמינות בלי לבחור חלק-יום — נספרו כזמינים לכל היום.
          </Text>
        ) : null}
        <Text style={s.note}>
          קריאה מסוננת בצד-שרת — נספרים רק מי שסימן זמינות, לא כל המשתמשים.
        </Text>
        <Text style={[s.note, { color: colors.textMuted }]}>הקש על תא כדי לראות מי זמין.</Text>
      </ScrollView>

      {/* drill-down: the players in the tapped cell */}
      <Modal visible={!!sel} transparent animationType="slide" onRequestClose={() => setSel(null)}>
        <Pressable style={s.backdrop} onPress={() => setSel(null)}>
          <Pressable style={s.sheet} onPress={(e) => e.stopPropagation()}>
            <SafeAreaView edges={['bottom']}>
              <View style={s.grip} />
              {sel && data ? (
                (() => {
                  const list = playersInCell(data.players, sel.day, sel.bucket);
                  const slot =
                    sel.bucket < 0 ? 'כל היום' : TIME_BUCKETS[sel.bucket].label;
                  return (
                    <>
                      <Text style={s.sheetTitle}>
                        {HEB_DAYS[sel.day]} · {slot}
                      </Text>
                      <Text style={s.sheetSub}>{list.length} זמינים{city ? ` · ${city}` : ''}</Text>
                      <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ paddingBottom: space(2) }}>
                        {list.map((p) => (
                          <View key={p.id} style={s.pRow}>
                            <View style={s.pAvatar}><Text style={s.pAvatarTxt}>{(p.name || '?').slice(0, 1)}</Text></View>
                            <View style={{ flex: 1 }}>
                              <Text style={s.pName}>{p.name}</Text>
                              {p.city && p.city !== '—' ? <Text style={s.pCity}>{p.city}</Text> : null}
                            </View>
                            {p.allDay && sel.bucket >= 0 ? <Text style={s.pTag}>כל היום</Text> : null}
                          </View>
                        ))}
                      </ScrollView>
                    </>
                  );
                })()
              ) : null}
            </SafeAreaView>
          </Pressable>
        </Pressable>
      </Modal>
    </Screen>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'stretch', marginBottom: 6 },
  col: { flex: 1, marginHorizontal: 3 },
  dayCol: { flex: 1.4, marginHorizontal: 3 },
  cellHead: { ...font.small, textAlign: 'center', color: colors.textMuted, paddingVertical: 4 },
  dayCell: { backgroundColor: colors.surfaceAlt, borderRadius: radius.sm, justifyContent: 'center', paddingVertical: 14 },
  dayTxt: { ...font.title, textAlign: 'center', fontSize: 14 },
  cell: { height: 56, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  cellTxt: { ...font.title, fontSize: 18, color: colors.textSoft },
  cellTxtHot: { color: '#FFFFFF' },
  totalCell: { backgroundColor: colors.primary },
  totalTxt: { ...font.title, fontSize: 19, color: '#FFFFFF' },
  chip: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingVertical: 7, paddingHorizontal: 14, marginEnd: 8 },
  chipOn: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  chipTxt: { ...font.small, color: colors.textSoft },
  chipTxtOn: { color: '#FFFFFF', fontWeight: '700' },
  note: { ...font.small, marginTop: space(3), lineHeight: 18 },
  cellPressed: { opacity: 0.6 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingHorizontal: space(5), paddingTop: space(2) },
  grip: { alignSelf: 'center', width: 44, height: 5, borderRadius: 3, backgroundColor: colors.border, marginBottom: space(3) },
  sheetTitle: { ...font.h2, marginBottom: 2 },
  sheetSub: { ...font.small, color: colors.primary, marginBottom: space(3) },
  pRow: { flexDirection: 'row', alignItems: 'center', gap: space(3), paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  pAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  pAvatarTxt: { ...font.title, color: '#FFFFFF', fontSize: 17 },
  pName: { ...font.title, fontSize: 15 },
  pCity: { ...font.small, marginTop: 1 },
  pTag: { ...font.small, color: colors.amber },
});
const cs = StyleSheet.create({
  icon: { width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  title: { color: colors.text, fontSize: 16, fontWeight: '800', textAlign: 'right' },
  state: { color: colors.textSoft, fontSize: 13, textAlign: 'right', marginTop: 2 },
  help: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'right',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: 12,
  },
});
