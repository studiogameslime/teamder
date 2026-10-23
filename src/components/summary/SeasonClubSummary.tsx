import { observeCaughtError } from '../../utils/errorObservation';
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeModal } from '@/components/SafeModal';
import { UserAvatar } from '@/components/UserAvatar';
import { ChemistrySection } from '@/components/chemistry/ChemistrySection';
import type { SeasonSummaryModel, SeasonTitleAwarded } from '@/services/seasonSummaryService';
import { SEASON_TITLE_KEYS } from '@/utils/seasonAwards';
import { SeasonTitleEmblem } from '@/components/SeasonTitleEmblem';
import { colors, RTL_LABEL_ALIGN } from '@/theme';
import { roundSummaryService } from '@/services/roundSummaryService';
import { eveningRecordsOf, type EveningRecord } from '@/utils/eveningRecords';
import { he } from '@/i18n/he';
import { SeasonSummaryIcon } from './SeasonSummaryIcon';

export function SeasonSectionTitle({ text, icon = 'stats-chart', forShare = false }: { text: string; icon?: keyof typeof Ionicons.glyphMap; forShare?: boolean }) {
  return <View style={seasonSummaryStyles.headingRow}><Text allowFontScaling={!forShare} style={seasonSummaryStyles.heading}>{text}</Text><SeasonSummaryIcon name={icon} size={19} /></View>;
}

export function SeasonAwardRows({ awards, all = false, provisional = false, personal = false, people = {} }: { people?: Record<string, { id: string; name: string; avatarId?: string; photoUrl?: string }>; awards: SeasonTitleAwarded[]; all?: boolean; provisional?: boolean; personal?: boolean }) {
  const [opened, setOpened] = useState<SeasonTitleAwarded | null>(null);
  const visibleAwards = provisional ? awards.filter(a => a.key !== 'mvp') : awards;
  const keys = all ? SEASON_TITLE_KEYS : visibleAwards.map(a => a.key);
  return <View>
    {keys.map(key => {
      const a = visibleAwards.find(x => x.key === key);
      const count = a?.winners?.length ?? a?.names.length ?? 0;
      const shared = count > 1;
      return <Pressable key={key} disabled={!a || !shared} onLongPress={() => a && setOpened(a)}
        accessibilityRole={shared ? 'button' : undefined}
        accessibilityLabel={`${he.seasonTitleNames[key]}: ${provisional && key === 'mvp' ? 'יתגלה בסיום העונה' : shared ? `${count} שחקנים` : a?.names.join(' · ') ?? 'אין זוכים'}`}
        accessibilityHint={shared ? 'לחיצה ארוכה להצגת כל השחקנים' : undefined}
        style={seasonSummaryStyles.awardRow}>
        {!personal && a?.winners?.length ? <View style={seasonSummaryStyles.awardAvatars}>
          {a.winners.slice(0, 2).map(w => <UserAvatar key={w.id} user={{ ...people[w.id], id: w.id, name: w.name }} size={a.winners!.length > 1 ? 23 : 30} />)}
        </View> : null}
        <View style={seasonSummaryStyles.awardText}>
          <Text style={seasonSummaryStyles.awardName}>{he.seasonTitleNames[key]}</Text>
          <Text style={seasonSummaryStyles.muted}>{provisional && key === 'mvp' ? 'יתגלה בסיום העונה' : personal && a ? `${he.seasonTitleValue(key, a.value, a.valueUnit)}${shared ? ' · זכייה משותפת' : ''}` : a ? (shared ? `${count} שחקנים` : a.names[0]) : provisional ? 'אין מוביל כרגע' : 'לא הוענק בעונה הזאת'}</Text>
          {key === 'topWinner' && (provisional || a?.valueUnit === 'percent') ? <Text style={seasonSummaryStyles.hint}>נדרשת השתתפות במחצית ממחזורי העונה</Text> : null}
          {a?.coverage ? <Text style={seasonSummaryStyles.muted}>{he.seasonTitleCoverage(a.coverage.rated, a.coverage.of)}</Text> : null}
          {key === 'mvp' && shared && !a?.coverage && a?.winners?.some(w => w.coverage) ? <Text style={seasonSummaryStyles.muted}>מספר ציוני המחזור של כל זוכה מופיע בלחיצה ארוכה</Text> : null}
        </View>
        {!personal ? <View style={seasonSummaryStyles.awardValue}>
          <Text style={seasonSummaryStyles.valueLabel}>{a ? he.seasonTitleValue(key, a.value, a.valueUnit) : '—'}</Text>
          {shared ? <Text style={seasonSummaryStyles.hint}>לחיצה ארוכה</Text> : null}
        </View> : null}
        <SeasonTitleEmblem titleKey={key} size={32} muted={!a} />
      </Pressable>;
    })}
    {visibleAwards.some(a => (a.winners?.length ?? a.names.length) > 1) ? <Text style={seasonSummaryStyles.note}>לחיצה ארוכה על קטגוריה מציגה את כל השותפים לזכייה</Text> : null}
    <SafeModal visible={!!opened} transparent animationType="fade" onRequestClose={() => setOpened(null)}>
      <View style={seasonSummaryStyles.overlay}>
        <View style={seasonSummaryStyles.dialog} accessibilityViewIsModal>
          <View style={seasonSummaryStyles.headingRow}>
            <Text style={seasonSummaryStyles.heading}>{opened ? he.seasonTitleNames[opened.key] : ''}</Text>
            <Pressable onPress={() => setOpened(null)} accessibilityRole="button" accessibilityLabel="סגירה" hitSlop={10}><Ionicons name="close" size={24} color={colors.text} /></Pressable>
          </View>
          <Text style={seasonSummaryStyles.note}>{opened?.key === 'deadlyDuo' ? 'הצמדים הזוכים' : provisional ? 'המובילים כרגע' : 'כל השותפים לזכייה'} · {opened ? he.seasonTitleValue(opened.key, opened.value, opened.valueUnit) : ''}</Text>
          <ScrollView style={{ maxHeight: 380 }}>
            {opened?.key === 'deadlyDuo' ? (opened.pairs?.length ? opened.pairs.map((pair, index) => <View key={pair.map(w => w.id).join('__')} style={seasonSummaryStyles.winnerPair}>
              <Text style={seasonSummaryStyles.awardName}>{`צמד ${index + 1}`}</Text>
              {pair.map(w => <View key={w.id} style={seasonSummaryStyles.winner}><UserAvatar user={{ ...people[w.id], id: w.id, name: w.name }} size={38} /><Text style={[seasonSummaryStyles.winnerName, { flex: 1 }]}>{w.name}</Text></View>)}
            </View>) : opened.names.map((name, index) => <View key={index} style={seasonSummaryStyles.winnerPair}><Text style={seasonSummaryStyles.awardName}>{`צמד ${index + 1}`}</Text><Text style={seasonSummaryStyles.winnerName}>{`\u2068${name}\u2069`}</Text></View>)) : (opened?.winners ?? opened?.names.map((name, i) => ({ id: String(i), name, coverage: undefined })) ?? []).map(w => <View key={w.id} style={seasonSummaryStyles.winner}>
              <UserAvatar user={{ ...people[w.id], id: w.id, name: w.name }} size={38} />
              <View style={{ flex: 1 }}><Text style={seasonSummaryStyles.winnerName}>{w.name}</Text>{w.coverage ? <Text style={seasonSummaryStyles.muted}>{he.seasonTitleCoverage(w.coverage.rated, w.coverage.of)}</Text> : null}</View>
            </View>)}
          </ScrollView>
        </View>
      </View>
    </SafeModal>
  </View>;
}

const format = (value: number | null | undefined, digits = 0) => value == null ? '—' : digits ? value.toFixed(digits) : String(value);

export function SeasonClubNumbers({ model, forShare = false }: { model: SeasonSummaryModel; forShare?: boolean }) {
  const n = model.club?.numbers;
  const metrics: [string, string, keyof typeof Ionicons.glyphMap][] = [
    ['מחזורים', String(model.completedRounds), 'calendar-outline'],
    ['משחקים', format(n?.games), 'grid-outline'],
    ['שחקנים', format(n?.players), 'people-outline'],
    ['שערים', format(n?.goals), 'shield-checkmark-outline'],
    ['בישולים', format(n?.assists), 'git-branch-outline'],
    ['שערים למשחק', format(n?.goalsPerGame, 2), 'speedometer-outline'],
    ['פנדלים שהובקעו', n?.penScored == null || n.penTaken == null ? '—' : `${n.penScored}/${n.penTaken}`, 'locate-outline'],
    ['שערים עצמיים', format(n?.ownGoals), 'shield-checkmark-outline'],
    ['נוכחות ממוצעת', format(n?.averageAttendance, 1), 'people-circle-outline'],
  ];
  return <View style={{ gap: 5 }}><View style={seasonSummaryStyles.grid}>{metrics.map(([label, value, icon]) => <View key={label} style={seasonSummaryStyles.metric}>
    <View style={{ flex: 1 }}><Text allowFontScaling={!forShare} numberOfLines={1} adjustsFontSizeToFit style={seasonSummaryStyles.number}>{value}</Text><Text allowFontScaling={!forShare} style={seasonSummaryStyles.metricLabel}>{label}</Text></View>
    <SeasonSummaryIcon name={icon} size={24} />
  </View>)}</View>{forShare ? <>
    <Text allowFontScaling={false} style={seasonSummaryStyles.note}>חלקו של מלך השערים: {n?.topScorerShare == null ? '—' : `${Math.round(n.topScorerShare * 100)}%`}</Text>
    {n?.penSaved != null ? <Text allowFontScaling={false} style={seasonSummaryStyles.note}>פנדלים שנעצרו: {n.penSaved}</Text> : null}
  </> : null}</View>;
}

export function SeasonClubSummary({ model }: { model: SeasonSummaryModel }) {
  const people = useMemo(() => Object.fromEntries(Object.entries(model.names).map(([id, name]) => [id, { id, name, ...model.peerAvatars[id] }])), [model.names, model.peerAvatars]);
  const [record, setRecord] = useState<{ source: SeasonSummaryModel; value: EveningRecord | null; truncated: boolean } | null>(null);
  useEffect(() => {
    let alive = true;
    setRecord(null);
    if (model.club?.mostGoalsEvening !== undefined) {
      setRecord({ source: model, value: model.club.mostGoalsEvening, truncated: false });
      return;
    }
    // Never turn an unknown starting boundary into a lifetime record.
    if (!model.startsAt) return;
    void roundSummaryService.listEveningStats(model.groupId, { from: model.startsAt, ...(model.endsAt ? { to: model.endsAt } : {}) })
      .then(result => { if (alive) setRecord({ source: model, value: eveningRecordsOf(result.evenings).goals, truncated: result.truncated }); })
      .catch((caughtError1b5a184dea: unknown) => {
    observeCaughtError(caughtError1b5a184dea, {"source":"src/components/summary/SeasonClubSummary.tsx","handler":"SeasonClubSummary","site":"SeasonClubSummary:1b5a184dea"}); if (alive) setRecord({ source: model, value: null, truncated: false }); });
    return () => { alive = false; };
  }, [model]);
  const currentRecord = record?.source === model ? record.value : null;
  return <>
    <View style={seasonSummaryStyles.card}>
      {model.closed && model.awardNotes ? Object.entries(model.awardNotes).map(([key, text]) => <Text key={key} style={seasonSummaryStyles.note}>{text}</Text>) : null}
      <SeasonSectionTitle text={model.closed ? 'אלופי המועדון' : 'מובילי המועדון'} icon="trophy-outline" />
      {!model.closed ? <Text style={seasonSummaryStyles.note}>המובילים כרגע בלבד. התארים ייקבעו בסיום העונה.</Text> : null}
      <SeasonAwardRows awards={model.closed ? model.seasonTitles : model.club?.leaders ?? []} all provisional={!model.closed} people={people} />
    </View>
    <View style={seasonSummaryStyles.card}>
      <SeasonSectionTitle text="המספרים של המועדון" />
      <SeasonClubNumbers model={model} />
      <View style={seasonSummaryStyles.numbersFooter}>
        <View style={seasonSummaryStyles.footerMetric}>
          <View style={{ flex: 1 }}>
            <Text style={seasonSummaryStyles.metricLabel}>המחזור הפורה ביותר שתועד</Text>
            <Text style={seasonSummaryStyles.valueLabel}>{currentRecord ? `${currentRecord.value} שערים` : '—'}</Text>
            <Text style={seasonSummaryStyles.hint}>{currentRecord ? new Date(currentRecord.at).toLocaleDateString('he-IL') : 'אין נתון מתועד'}</Text>
          </View>
          <SeasonSummaryIcon name="bars" size={25} />
        </View>
        <View style={[seasonSummaryStyles.footerMetric, { borderStartWidth: 1, borderColor: '#EAF1FC', paddingStart: 8 }]}>
          <View style={{ flex: 1 }}>
            <Text style={seasonSummaryStyles.metricLabel}>חלקו של מלך השערים</Text>
            <Text style={seasonSummaryStyles.valueLabel}>{model.club?.numbers.topScorerShare == null ? '—' : `${Math.round(model.club.numbers.topScorerShare * 100)}%`}</Text>
            <Text style={seasonSummaryStyles.hint}>{model.club?.numbers.goals != null ? `מתוך ${model.club.numbers.goals} שערים` : 'אין נתון מתועד'}</Text>
          </View>
          <Ionicons name="pie-chart" size={26} color="#3393FF" />
        </View>
      </View>
      {model.club?.numbers.penSaved != null ? <Text style={seasonSummaryStyles.note}>פנדלים שנעצרו: {model.club.numbers.penSaved}</Text> : null}
      {record?.truncated ? <Text style={seasonSummaryStyles.note}>השיא מבוסס על 400 המחזורים המתועדים האחרונים בעונה.</Text> : null}
    </View>
    <View style={seasonSummaryStyles.card}>
      <SeasonSectionTitle text="הצמדים של המועדון" icon="people-outline" />
      {model.club && model.club.pairsComplete !== false ? <ChemistrySection groupId={model.groupId} pairs={model.club.pairs} identities={people} seasonScoped appearance="summary" motionEnabled={false} emptyText={model.closed ? 'לא נמצאו צמדים עם מספיק נתונים בעונה הזאת.' : undefined} /> : <Text style={seasonSummaryStyles.note}>נתוני הצמדים אינם זמינים לעונה הזאת.</Text>}
      <Text style={seasonSummaryStyles.note}>לפחות 10 משחקים יחד לחישוב אחוז הניצחונות</Text>
    </View>
  </>;
}

export const seasonSummaryStyles = StyleSheet.create({
  winnerPair: { borderWidth: 1, borderColor: '#DFEAF8', borderRadius: 12, padding: 10, marginTop: 10, gap: 6 },
  card: { backgroundColor: colors.surface, borderRadius: 13, borderWidth: 1, borderColor: '#DFEAF8', padding: 10, gap: 6 },
  headingRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  heading: { flex: 1, fontSize: 15, lineHeight: 20, fontWeight: '800', color: colors.text, textAlign: RTL_LABEL_ALIGN },
  awardRow: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 4, borderTopWidth: 1, borderColor: '#EDF2F9', minHeight: 44 },
  awardAvatars: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  awardText: { flex: 1.35, gap: 1 }, awardName: { fontSize: 12, lineHeight: 15, fontWeight: '700', color: colors.text, textAlign: RTL_LABEL_ALIGN },
  awardValue: { flex: 1, gap: 1 }, valueLabel: { color: colors.text, fontSize: 12, lineHeight: 16, fontWeight: '700', textAlign: RTL_LABEL_ALIGN },
  muted: { color: colors.textMuted, fontSize: 11, lineHeight: 14, textAlign: RTL_LABEL_ALIGN },
  hint: { fontSize: 9, lineHeight: 12, color: colors.textMuted, textAlign: RTL_LABEL_ALIGN },
  note: { color: colors.textMuted, fontSize: 10, lineHeight: 14, textAlign: RTL_LABEL_ALIGN },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  metric: { flexDirection: 'row', alignItems: 'center', width: '32%', gap: 3, backgroundColor: '#F4F8FE', borderWidth: 1, borderColor: '#EAF1FC', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 4, minHeight: 45 },
  number: { fontSize: 18, lineHeight: 22, fontWeight: '800', color: colors.text, textAlign: RTL_LABEL_ALIGN },
  metricLabel: { color: colors.text, fontSize: 10, lineHeight: 13, textAlign: RTL_LABEL_ALIGN },
  numbersFooter: { flexDirection: 'row', borderTopWidth: 1, borderColor: '#EAF1FC', paddingTop: 6, gap: 8 },
  footerMetric: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4 },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  overlay: { flex: 1, backgroundColor: '#07152C88', justifyContent: 'center', padding: 22 },
  dialog: { backgroundColor: colors.surface, borderRadius: 20, padding: 20, gap: 12 },
  winner: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderColor: '#EDF2F9' },
  winnerName: { fontSize: 16, fontWeight: '700', color: colors.text, textAlign: RTL_LABEL_ALIGN },
});
