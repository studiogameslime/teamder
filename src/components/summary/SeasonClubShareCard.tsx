import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SeasonClubNumbers, seasonSummaryStyles, SeasonSectionTitle } from './SeasonClubSummary';
import type { SeasonSummaryModel } from '@/services/seasonSummaryService';
import { SeasonTitleEmblem } from '@/components/SeasonTitleEmblem';
import { colors, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';

/** A separate club card: no personal counters can leak into this capture. */
export function SeasonClubShareCard({ model }: { model: SeasonSummaryModel }) {
  const awards = model.closed ? model.seasonTitles : model.club?.leaders ?? [];
  return <View style={styles.card}>
    <Text allowFontScaling={false} style={styles.title}>{model.groupName}</Text>
    <Text allowFontScaling={false} style={styles.subtitle}>סיכום עונה {model.seasonNo} · {model.closed ? 'העונה הסתיימה' : 'העונה בעיצומה'}</Text>
    <SeasonSectionTitle forShare text={model.closed ? 'אלופי המועדון' : 'המובילים כרגע'} icon="trophy-outline" />
    {awards.map(a => <View key={a.key} style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text allowFontScaling={false} style={styles.label}>{he.seasonTitleNames[a.key]}</Text>
        <Text allowFontScaling={false} style={styles.names}>{(a.winners?.length ?? a.names.length) > 1 ? `${a.winners?.length ?? a.names.length} שחקנים` : a.names[0]}</Text>
      </View>
      <Text allowFontScaling={false} style={styles.value}>{he.seasonTitleValue(a.key, a.value, a.valueUnit)}</Text>
      <SeasonTitleEmblem titleKey={a.key} size={30} />
    </View>)}
    <SeasonSectionTitle forShare text="המועדון במספרים" />
    <SeasonClubNumbers model={model} forShare />
    <Text allowFontScaling={false} style={seasonSummaryStyles.note}>הנתונים מתייחסים לעונה הזאת בלבד</Text>
  </View>;
}
const styles = StyleSheet.create({
  card: { width: 340, backgroundColor: colors.surface, padding: 16, gap: 12 },
  title: { fontSize: 23, fontWeight: '800', color: colors.text, textAlign: RTL_LABEL_ALIGN },
  subtitle: { fontSize: 13, color: colors.textMuted, textAlign: RTL_LABEL_ALIGN },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderTopWidth: 1, borderColor: '#EAF1FC' },
  label: { fontSize: 13, fontWeight: '700', color: colors.text, textAlign: RTL_LABEL_ALIGN },
  names: { fontSize: 12, color: colors.textMuted, textAlign: RTL_LABEL_ALIGN },
  value: { fontSize: 12, color: colors.text, maxWidth: 105, textAlign: RTL_LABEL_ALIGN },
});
