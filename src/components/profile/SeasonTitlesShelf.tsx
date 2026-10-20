import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SeasonTitleEmblem } from '@/components/SeasonTitleEmblem';
import { groupHeldSeasonTitles, type HeldSeasonTitle } from '@/services/seasonTitlesService';
import { colors, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';

/** The cabinet owns loading/counts; this shelf only groups frozen awards. */
export function SeasonTitlesShelf({ titles }: { titles: HeldSeasonTitle[] }) {
  const [older, setOlder] = useState(false);
  const groups = groupHeldSeasonTitles(titles);
  if (!groups.length) return <View style={styles.card}><Text style={styles.note}>כאן יופיעו תארי העונה שתזכה בהם במועדונים שלך.</Text></View>;
  const latestAt = groups[0].at;
  const latest = groups.filter(group => group.at === latestAt || group.key === groups[0].key);
  const previous = groups.filter(group => !latest.includes(group));
  const card = (group: typeof groups[number]) => <View key={group.key} style={styles.card}>
    <Text style={styles.club}>{group.groupName || 'מועדון ללא שם שמור'}</Text>
    <Text style={styles.note}>{he.seasonNumberLabel(group.seasonNo)} · העונה הסתיימה</Text>
    {group.titles.map(title => <View key={title.id} style={styles.row}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.title}>{he.seasonTitleNames[title.titleKey]}</Text>
        {title.value !== undefined ? <Text style={styles.value}>{he.seasonTitleValue(title.titleKey, title.value, title.valueUnit)}</Text> : null}
      </View>
      <SeasonTitleEmblem titleKey={title.titleKey} size={38} />
    </View>)}
  </View>;
  return <View style={{ gap: 10 }}>
    {latest.map(card)}
    <Text style={styles.note}>כל זכייה נשמרת לפי המועדון והעונה</Text>
    {previous.length ? <>
      <Pressable style={styles.history} onPress={() => setOlder(value => !value)} accessibilityRole="button" accessibilityState={{ expanded: older }}>
        <Text style={styles.title}>עונות קודמות · {previous.length}</Text>
        <Ionicons name={older ? 'chevron-up' : 'chevron-back'} size={19} color="#1479FF" />
      </Pressable>
      {older ? previous.map(card) : null}
    </> : null}
  </View>;
}
const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: '#E1ECFB', borderRadius: 14, padding: 12, gap: 4 },
  club: { fontSize: 16, lineHeight: 22, fontWeight: '800', color: colors.text, textAlign: RTL_LABEL_ALIGN },
  note: { fontSize: 11, lineHeight: 16, color: colors.textMuted, textAlign: RTL_LABEL_ALIGN },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 61, paddingVertical: 8, borderTopWidth: 1, borderColor: '#ECF2FC', marginTop: 3 },
  title: { fontSize: 14, lineHeight: 19, fontWeight: '700', color: colors.text, textAlign: RTL_LABEL_ALIGN },
  value: { fontSize: 12, lineHeight: 17, color: colors.textMuted, textAlign: RTL_LABEL_ALIGN },
  history: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.surface, borderWidth: 1, borderColor: '#E1ECFB', borderRadius: 12, minHeight: 48, padding: 12 },
});
