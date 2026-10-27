import React, { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeModal } from '@/components/SafeModal';
import { colors, RTL_LABEL_ALIGN } from '@/theme';
import { overlaySurfaces, overlayTheme } from '@/theme/overlays';
import { liveTeamsChanged, moveLiveWaiting, replaceLiveTeam, type LiveTeamsPlan } from '@/utils/liveTeamsEdit';
import type { DraftTeamsResult } from '@/types';
import { teamColor, teamName } from './rotationView';
import { TeamShirtIllustration } from './TeamShirt';

export function LiveTeamsEditModal({ original, draft, roundNumber, busy, stale, error, onSave, onClose }: {
  original: LiveTeamsPlan; draft: DraftTeamsResult; roundNumber: number; busy: boolean; stale: boolean;
  error?: string; onSave: (plan: LiveTeamsPlan) => void; onClose: () => void;
}) {
  const { height, width, fontScale } = useWindowDimensions();
  const [plan, setPlan] = useState<LiveTeamsPlan>(() => ({ playing: [...original.playing], waiting: [...original.waiting] }));
  const [picking, setPicking] = useState<0 | 1 | null>(null);
  const [confirm, setConfirm] = useState(false);
  const changed = liveTeamsChanged(original, plan);
  const dirty = changed || original.waiting.some((team, i) => team !== plan.waiting[i]);
  const disabled = busy || stale;
  const close = () => { if (!busy) onClose(); };
  const back = () => { if (!busy) { if (confirm) setConfirm(false); else if (picking !== null) setPicking(null); else close(); } };
  const name = (team: number) => teamName(team, draft.teams);
  const shirt = (team: number, size: number) => <TeamShirtIllustration color={teamColor(team, draft.teams)} width={size}/>;
  return <SafeModal visible transparent animationType="fade" onRequestClose={back}>
    <View style={[s.backdrop, confirm && s.center]}>
      <Pressable style={StyleSheet.absoluteFill} onPress={back} accessibilityRole="button" accessibilityLabel="חזרה מהחלון" disabled={busy}/>
      <View testID="live-teams-sheet" style={[confirm ? overlaySurfaces.dialog : overlaySurfaces.sheet, s.sheet, { maxHeight: height * 0.9 }, confirm && s.dialog]}>
        {!confirm && <View style={s.handle}/>}
        <View style={s.heading}><Text style={s.title}>{confirm ? `לאפס את משחק ${roundNumber}?` : picking !== null ? 'בחירת קבוצה למשחק' : 'סדר המשחק'}</Text>
          {!confirm && <Pressable style={s.icon} onPress={back} disabled={busy} accessibilityRole="button" accessibilityLabel={picking !== null ? 'חזרה לעריכה' : 'ביטול העריכה'}><Ionicons name={picking !== null ? 'arrow-forward' : 'close'} size={24} color={colors.text}/></Pressable>}
        </View>
        <ScrollView style={s.body} contentContainerStyle={s.bodyContent}>
          {confirm ? <>
            <Text style={s.copy}>הזמן, השערים וכל אירועי המשחק הנוכחי יימחקו. המשחק יתחיל מחדש עם הקבוצות שבחרת.</Text>
            <View style={s.pairPreview}>{plan.playing.map((team, slot) => <View key={slot} style={s.previewTeam}>{shirt(team, 42)}<Text style={s.teamName}>{name(team)}</Text></View>)}</View>
            <Text style={s.hint}>משחקים קודמים לא ישתנו.</Text>
          </> : picking !== null ? <>
            {[...original.playing, ...original.waiting].map(team => {
              const other = plan.playing[picking === 0 ? 1 : 0] === team;
              const selected = plan.playing[picking] === team;
              return <Pressable key={team} style={[s.choice, selected && s.selected, other && s.disabled]} disabled={disabled || other} accessibilityRole="radio" accessibilityLabel={name(team)} accessibilityState={{ checked: selected, disabled: disabled || other }} onPress={() => { setPlan(replaceLiveTeam(plan, picking, team)); setPicking(null); }}>
                {shirt(team, 32)}<View style={s.flex}><Text style={s.teamName}>{name(team)}</Text>{other && <Text style={s.hint}>כבר במשחק</Text>}</View><Ionicons name={selected ? 'checkmark-circle' : 'ellipse-outline'} size={24} color={selected ? colors.primary : colors.textMuted}/>
              </Pressable>;
            })}
          </> : <>
            <Text style={s.sectionTitle}>משחקות עכשיו</Text>
            <View style={[s.pair, (width < 350 || fontScale > 1.2) && s.stacked]}>{plan.playing.map((team, slot) => <Pressable key={slot} testID={`live-teams-slot-${slot}`} style={s.teamCard} disabled={disabled || !plan.waiting.length} onPress={() => setPicking(slot as 0 | 1)} accessibilityRole="button" accessibilityLabel={`החלפת ${name(team)}`} accessibilityState={{ disabled: disabled || !plan.waiting.length }}>
              {shirt(team, 42)}<Text style={[s.teamName, s.flex]}>{name(team)}</Text>{!!plan.waiting.length && <Ionicons name="chevron-down" size={18} color={colors.textMuted}/>}
            </Pressable>)}</View>
            <Text style={s.sectionTitle}>סדר הממתינות</Text>
            <Text style={s.hint}>{plan.waiting.length ? 'הראשונה בתור עולה במשחק הבא' : 'אין קבוצות ממתינות במחזור הזה'}</Text>
            {plan.waiting.map((team, position) => <View key={team} style={s.waitingRow}>
              <View style={s.order}><Text style={s.orderText}>{position + 1}</Text></View>{shirt(team, 28)}<Text style={[s.teamName, s.flex]}>{name(team)}</Text>
              <View style={s.arrows}>{([-1, 1] as const).map(delta => {
                const blocked = disabled || position + delta < 0 || position + delta >= plan.waiting.length;
                return <Pressable key={delta} style={s.icon} disabled={blocked} onPress={() => setPlan(moveLiveWaiting(plan, team, delta))} accessibilityRole="button" accessibilityLabel={`${name(team)}, ${delta === -1 ? 'הקדמה' : 'דחייה'} בתור`} accessibilityState={{ disabled: blocked }}><Ionicons name={delta === -1 ? 'chevron-up' : 'chevron-down'} size={22} color={blocked ? colors.border : colors.primary}/></Pressable>;
              })}</View>
            </View>)}
            {changed ? <View style={s.warning}><Ionicons name="warning-outline" size={20} color={colors.warning}/><Text style={[s.warningText, s.flex]}>החלפת קבוצות תאפס את הזמן, השערים וכל אירועי המשחק הנוכחי.</Text></View> : <Text style={[s.hint, s.note]}>שינוי התור בלבד שומר את הזמן והתוצאה.</Text>}
          </>}
        </ScrollView>
        {(stale || !!error) && <Text accessibilityRole="alert" style={s.error}>{stale ? 'המשחק השתנה. יש לסגור ולפתוח מחדש את העריכה.' : error}</Text>}
        {(confirm || picking === null) && <View style={s.footer}>
          <Pressable testID="live-teams-save" style={[s.primary, (!dirty || disabled) && s.disabled]} disabled={!dirty || disabled} onPress={() => { if (changed && !confirm) setConfirm(true); else onSave(plan); }} accessibilityRole="button" accessibilityState={{ disabled: !dirty || disabled }}>
            {busy ? <ActivityIndicator color={colors.textOnPrimary}/> : <Text style={s.primaryText}>{confirm ? 'החלפה ואיפוס' : changed ? 'המשך לאישור ההחלפה' : 'שמירת הסדר'}</Text>}
          </Pressable>
          {confirm && <Pressable style={s.cancel} disabled={busy} onPress={() => setConfirm(false)} accessibilityRole="button"><Text style={s.cancelText}>חזרה לעריכה</Text></Pressable>}
        </View>}
      </View>
    </View>
  </SafeModal>;
}

const s = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: overlayTheme.backdrop }, center: { justifyContent: 'center', padding: 20 },
  sheet: { padding: 18, gap: 12, flexShrink: 1 }, dialog: { padding: 22 }, handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: 'center' },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 8 }, title: { flex: 1, fontSize: 21, fontWeight: '800', color: colors.text, textAlign: RTL_LABEL_ALIGN },
  icon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, body: { flexShrink: 1 }, bodyContent: { gap: 12, paddingBottom: 4 },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: colors.text, textAlign: RTL_LABEL_ALIGN, marginTop: 6 },
  pair: { flexDirection: 'row', gap: 10 }, stacked: { flexDirection: 'column' }, teamCard: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: colors.border, borderRadius: 15, padding: 12, minHeight: 80 },
  teamName: { fontSize: 16, fontWeight: '700', color: colors.text, textAlign: RTL_LABEL_ALIGN, flexShrink: 1 }, flex: { flex: 1, minWidth: 0 },
  hint: { fontSize: 13, color: colors.textMuted, textAlign: RTL_LABEL_ALIGN, lineHeight: 21 },
  waitingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: colors.border, borderRadius: 13, padding: 8 },
  order: { minWidth: 28, minHeight: 30, borderRadius: 7, backgroundColor: colors.surfaceMuted, alignItems: 'center', justifyContent: 'center' }, orderText: { color: colors.text, fontSize: 14, fontWeight: '700' },
  arrows: { flexDirection: 'row' }, warning: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, backgroundColor: colors.surfaceMuted, borderRadius: 12 }, warningText: { color: colors.text, fontSize: 13, lineHeight: 21, textAlign: RTL_LABEL_ALIGN }, note: { marginTop: 4 },
  footer: { gap: 6, flexShrink: 0 }, primary: { backgroundColor: colors.primary, minHeight: 52, borderRadius: 14, padding: 12, alignItems: 'center', justifyContent: 'center' }, primaryText: { color: colors.textOnPrimary, textAlign: 'center', fontWeight: '800', fontSize: 17 }, disabled: { opacity: 0.4 },
  choice: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.border, minHeight: 64 }, selected: { backgroundColor: colors.surfaceMuted, borderColor: colors.primary },
  copy: { color: colors.text, fontSize: 16, lineHeight: 25, textAlign: RTL_LABEL_ALIGN }, pairPreview: { flexDirection: 'row', gap: 16, paddingVertical: 8 }, previewTeam: { flex: 1, alignItems: 'center', gap: 8 },
  cancel: { minHeight: 44, alignItems: 'center', justifyContent: 'center' }, cancelText: { color: colors.primary, fontSize: 15, fontWeight: '700' }, error: { color: colors.danger, fontSize: 14, textAlign: RTL_LABEL_ALIGN },
});
