import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '@/components/Button';
import { FORM_BLUE } from '@/components/forms/FormTheme';
import { RTL_LABEL_ALIGN } from '@/theme';
import { formatDateShort, formatTime, gameFormatLabel, HEBREW_DAYS_LONG } from '@/utils/format';
import type { GameFormValues } from '@/screens/games/GameWizardForm';
import { overlaySurfaces, overlayTheme } from '@/theme/overlays';

type Icon = keyof typeof Ionicons.glyphMap;
type Props = {
  values: GameFormValues;
  maxPlayers: number;
  communityName?: string;
  quick: boolean;
  isEdit: boolean;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
};
const date = (ms: number) => `${HEBREW_DAYS_LONG[new Date(ms).getDay()]} · ${formatDateShort(ms)} · ${formatTime(ms)}`;
const yesNo = (v: boolean) => v ? 'כן' : 'לא';

function Row({ label, value, icon, scheduled = false }: { label: string; value: string; icon: Icon; scheduled?: boolean }) {
  return <View style={[s.row, scheduled && s.scheduled]}>
    <View style={s.labelGroup}><Ionicons name={icon} size={20} color="#101D46" /><Text style={s.rowLabel}>{label}</Text></View>
    <View style={s.valueGroup}><Text style={s.rowValue}>{value}</Text>{scheduled ? <Text style={s.badge}>מתוזמנת</Text> : null}</View>
  </View>;
}

export function RoundReviewSheet({ values: v, maxPlayers, communityName, quick, isEdit, busy, onConfirm, onClose }: Props) {
  const [expanded, setExpanded] = useState(false);
  const insets = useSafeAreaInsets();
  const scheduled = !quick && v.scheduledRegEnabled && v.registrationOpensAt > 0;
  const visibility = v.visibility === 'public' ? 'כל השחקנים באפליקציה' : quick ? 'למוזמנים בלבד' : 'חברי המועדון בלבד';
  const surface = v.fieldType ? { asphalt: 'אספלט', synthetic: 'סינטטי', grass: 'דשא' }[v.fieldType] : null;
  const title = v.title.trim() || communityName || 'המחזור שלך';
  const place = v.fieldName.trim() || v.city.trim() || 'לא צוין מיקום';
  const address = v.fieldAddress.trim();
  // Picker labels can already contain the address. Compare normalized text
  // without altering the actual display or suppressing a distinct landmark.
  const normalize = (text: string) => text.replace(/[\s,،·–—-]+/g, ' ').trim().toLocaleLowerCase();
  const showAddress = address.length > 0 && !normalize(place).includes(normalize(address));
  const chips: { text: string; icon: Icon }[] = [
    ...(surface ? [{ text: surface, icon: 'football-outline' as Icon }] : []),
    { text: gameFormatLabel(v.format), icon: 'people-outline' },
    { text: `${v.numberOfTeams} קבוצות`, icon: 'people-outline' },
    { text: `${maxPlayers} שחקנים`, icon: 'person-outline' },
  ];
  return <View style={s.sheet}>
    <View style={s.handle} />
    <ScrollView style={s.scroll} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
      <View style={s.heading}>
        <View pointerEvents="none" style={s.pitch}>
          <Svg width={145} height={95} viewBox="0 0 100 64"><Rect x={2} y={2} width={96} height={60} fill="none" stroke="#C5DCFC" strokeWidth={1} /><Path d="M50 2V62M2 18H18V46H2M98 18H82V46H98" stroke="#C5DCFC" strokeWidth={1} fill="none" /><Circle cx={50} cy={32} r={11} stroke="#C5DCFC" strokeWidth={1} fill="none" /></Svg>
        </View>
        <Text accessibilityRole="header" style={s.title}>הכול מוכן למחזור?</Text>
        <Text style={s.subtitle}>בדיקה קצרה לפני האישור</Text>
      </View>
      <View style={s.hero}>
        <View style={s.detail}><Ionicons name={quick ? 'football-outline' : 'shield-outline'} size={22} color="#101D46" /><Text style={s.club}>{title}</Text></View>
        {communityName && title !== communityName ? <Text style={s.community}>{communityName}</Text> : null}
        <View style={s.detail}><Ionicons name="calendar-outline" size={22} color="#101D46" /><Text style={s.when}>{date(v.startsAt)}</Text></View>
        <View style={s.detail}><Ionicons name="location-outline" size={22} color="#101D46" /><Text style={s.place}>{place}</Text></View>
        {showAddress ? <Text style={s.community}>{address}</Text> : null}
        <View style={s.chips}>{chips.map(chip => <View key={chip.text} style={s.chip}><Ionicons name={chip.icon} size={16} color="#101D46" /><Text style={s.chipText}>{chip.text}</Text></View>)}</View>
      </View>
      <Text accessibilityRole="header" style={s.sectionTitle}>הרשמה וחשיפה</Text>
      <View style={s.rows}>
        <Row label="מי רואה את המחזור?" value={visibility} icon="people-outline" />
        <Row label="אופן ההצטרפות" value={v.requiresApproval ? 'באישור מנהל' : 'ללא אישור מנהל'} icon="person-add-outline" />
        <Row label="פתיחת הרשמה" value={scheduled ? date(v.registrationOpensAt) : isEdit ? 'ללא תזמון פתיחה' : 'מיד עם יצירת המחזור'} icon="time-outline" scheduled={scheduled} />
        {!quick && v.publicOpenAt > 0 ? <Row label="פתיחה לכל האפליקציה" value={date(v.publicOpenAt)} icon="globe-outline" /> : null}
      </View>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setExpanded(!expanded)} style={s.disclosure}>
        <Text style={s.link}>{expanded ? 'הסתר את כל ההגדרות' : 'הצג את כל ההגדרות'}</Text><Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} color={FORM_BLUE} size={18} />
      </Pressable>
      {expanded ? <View style={s.rows}>
        <Row label="משך משחק" value={`${v.matchDurationMinutes} דקות`} icon="stopwatch-outline" />
        <Row label="ניהול משחק מתקדם" value={yesNo(v.advancedMode)} icon="options-outline" />
        {v.advancedMode && v.numberOfTeams === 3 ? <Row label="השלמת שחקנים" value={v.advancedFillMode === 'permanent' ? 'קבועה' : 'זמנית'} icon="people-outline" /> : null}
        {v.advancedMode && v.numberOfTeams === 4 ? <Row label="בהכרעת תיקו" value={v.advancedTieMode === 'bothOut' ? 'שתי הקבוצות יוצאות' : 'הקבוצה הוותיקה יוצאת'} icon="swap-horizontal-outline" /> : null}
        {v.ruleTags.length ? <Row label="חוקי המחזור" value={v.ruleTags.join(' · ')} icon="list-outline" /> : null}
        <Row label="אישור מעבר מהמתנה" value={v.waitlistApprovalRequired ? `נדרש אישור תוך ${v.waitlistApprovalTimeout} דקות` : 'מעבר אוטומטי'} icon="hourglass-outline" />
        <Row label="ביטול הרשמה" value={v.cancelDeadlineHours === undefined ? 'ללא הגבלת זמן' : `עד ${v.cancelDeadlineHours} שעות לפני המחזור`} icon="time-outline" />
        {!quick ? <>
          <Row label="מחזור שבועי" value={yesNo(v.recurringGameEnabled)} icon="repeat-outline" />
          <Row label="הוספת אורחים" value={v.guestsOpenAt > 0 ? date(v.guestsOpenAt) : 'ללא תזמון הגבלה'} icon="person-add-outline" />
          <Row label="תזמון יצירת כוחות" value={v.autoTeamsAt > 0 ? `${date(v.autoTeamsAt)} · ${v.autoTeamsMethod === 'rating' ? 'לפי דירוג' : 'אקראי'}` : 'כבוי'} icon="shuffle-outline" />
        </> : null}
        <Row label="חיפוש שחקנים להשלמה" value={yesNo(v.acceptsFillers)} icon="search-outline" />
        {v.acceptsFillers ? <Row label="סף אמינות להשלמה" value={v.fillerMinTrust ? `${v.fillerMinTrust}` : 'ללא סף'} icon="shield-checkmark-outline" /> : null}
        {v.inviteFriendIds?.length ? <Row label="חברים שיוזמנו" value={`${v.inviteFriendIds.length}`} icon="people-outline" /> : null}
        {v.notes.trim() ? <Row label="הערות" value={v.notes.trim()} icon="document-text-outline" /> : null}
      </View> : null}
    </ScrollView>
    <View style={[s.footer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
      <Button title={isEdit ? 'אישור ושמירת השינויים' : 'אישור ויצירת המחזור'} variant="primary" fullWidth size="lg" style={s.confirm} loading={busy} onPress={onConfirm} />
      <Pressable accessibilityRole="button" disabled={busy} onPress={onClose} style={s.back}><Text style={s.backText}>חזרה לעריכה</Text></Pressable>
    </View>
  </View>;
}

const s = StyleSheet.create({
  sheet: { ...overlaySurfaces.sheet, flexShrink: 1, maxHeight: '100%', overflow: 'hidden' },
  handle: { width: 44, height: 4, borderRadius: 3, backgroundColor: '#D0D7E5', alignSelf: 'center', marginTop: 8, marginBottom: 4 },
  scroll: { flexGrow: 0, flexShrink: 1 }, content: { padding: 16, paddingTop: 8, paddingBottom: 0, gap: 12 },
  heading: { paddingVertical: 10, minHeight: 76, justifyContent: 'center' },
  pitch: { position: 'absolute', end: -24, top: -23, opacity: 0.7, transform: [{ rotate: '-22deg' }] },
  title: { fontSize: 26, fontWeight: '900', color: '#101D46', textAlign: RTL_LABEL_ALIGN },
  subtitle: { fontSize: 15, color: '#526482', textAlign: RTL_LABEL_ALIGN, marginTop: 6 },
  hero: { borderRadius: 18, borderWidth: 1, borderColor: '#D6E6FC', backgroundColor: '#F0F7FF', padding: 12, gap: 12 },
  detail: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  club: { flex: 1, color: '#101D46', fontSize: 19, fontWeight: '800', textAlign: RTL_LABEL_ALIGN },
  community: { color: '#526482', fontSize: 13, textAlign: RTL_LABEL_ALIGN },
  when: { flex: 1, color: '#101D46', fontSize: 16, fontWeight: '800', textAlign: RTL_LABEL_ALIGN },
  place: { flex: 1, color: '#101D46', fontSize: 14, textAlign: RTL_LABEL_ALIGN },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, borderTopWidth: 1, borderColor: '#D6E6FC', paddingTop: 10 },
  chip: { flexDirection: 'row', gap: 4, alignItems: 'center', backgroundColor: '#E0EEFF', paddingHorizontal: 8, paddingVertical: 7, borderRadius: 12 },
  chipText: { fontSize: 12, color: '#101D46' },
  sectionTitle: { fontSize: 19, fontWeight: '800', color: '#101D46', textAlign: RTL_LABEL_ALIGN, marginTop: 2 },
  rows: { borderWidth: 1, borderColor: '#DFE9F8', borderRadius: 15, overflow: 'hidden' },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingHorizontal: 12, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#E8EEF8' },
  labelGroup: { flexDirection: 'row', alignItems: 'center', gap: 7, flexShrink: 1 },
  rowLabel: { fontSize: 14, fontWeight: '700', color: '#101D46', textAlign: RTL_LABEL_ALIGN, flexShrink: 1 },
  valueGroup: { flexDirection: 'row', flexShrink: 1, alignItems: 'center', gap: 6 },
  rowValue: { fontSize: 13, color: '#101D46', textAlign: RTL_LABEL_ALIGN, flexShrink: 1 },
  scheduled: { backgroundColor: '#E8F3FF' }, badge: { fontSize: 11, fontWeight: '800', color: FORM_BLUE, backgroundColor: '#CFE5FF', paddingHorizontal: 7, paddingVertical: 4, borderRadius: 8 },
  disclosure: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, minHeight: 44 },
  link: { color: FORM_BLUE, fontSize: 15 },
  footer: { paddingHorizontal: 16, paddingTop: 8, backgroundColor: overlayTheme.surface },
  confirm: { backgroundColor: FORM_BLUE, borderColor: FORM_BLUE, borderRadius: 14 },
  back: { minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: 6 }, backText: { color: FORM_BLUE, fontSize: 17, fontWeight: '700' },
});
