import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { UserAvatar } from '@/components/UserAvatar';
import { colors, RTL_LABEL_ALIGN } from '@/theme';
import { clubStatsPalette as palette } from '@/components/community/ClubStatsDashboard';
import { eveningPenaltyPlayers, type EveningPenaltyAttempt, type PenaltyPhase, type PenaltyRole } from '@/utils/roundPenalties';

export interface RoundPenaltiesCardProps {
  attempts: EveningPenaltyAttempt[];
  hasHistory: boolean;
  partial?: boolean;
  userOf: (id: string) => { id: string; name: string; avatarId?: string; photoUrl?: string };
}

export function RoundPenaltiesCard({ attempts, hasHistory, partial, userOf }: RoundPenaltiesCardProps) {
  const [role, setRole] = useState<PenaltyRole>('kicker');
  const [phase, setPhase] = useState<PenaltyPhase>(() => attempts.some(a => a.phase === 'inPlay') ? 'inPlay' : 'shootout');
  const [expanded, setExpanded] = useState<string | null>(null);
  const players = eveningPenaltyPlayers(attempts, phase, role);
  const selected = attempts.filter(a => a.phase === phase);
  const name = (id: string | null, fallback: string) => id ? userOf(id).name || fallback : fallback;
  const outcomeText = (value: EveningPenaltyAttempt['outcome']) => value === 'goal' ? 'גול' : value === 'save' ? 'השוער עצר' : value === 'miss' ? 'החטאה' : 'לא הובקע. פירוט התוצאה לא נשמר';

  return <View style={s.card} testID="round-penalties-card">
    <View style={s.switches}>
      {([{ value: 'kicker', label: 'בועטים' }, { value: 'keeper', label: 'שוערים' }] as const).map(item =>
        <Pressable key={item.value} accessibilityRole="tab" accessibilityState={{ selected: role === item.value }}
          onPress={() => { setRole(item.value); setExpanded(null); }} style={[s.switch, role === item.value && s.active]}>
          <Text style={[s.switchText, role === item.value && s.activeText]}>{item.label}</Text>
        </Pressable>)}
    </View>
    <View style={s.phases}>
      {([{ value: 'inPlay', label: 'במהלך המשחק' }, { value: 'shootout', label: 'פנדלי הכרעה' }] as const).map(item =>
        <Pressable key={item.value} accessibilityRole="tab" accessibilityState={{ selected: phase === item.value }}
          onPress={() => { setPhase(item.value); setExpanded(null); }} style={[s.phase, phase === item.value && s.phaseActive]}>
          <Text style={[s.phaseText, phase === item.value && s.phaseTextActive]}>{item.label}</Text>
        </Pressable>)}
    </View>
    <Text style={s.caption}>{phase === 'inPlay' ? 'שערי הפנדלים האלה נכללים בשערי המשחק.' : 'שערי הכרעה נספרים בפנדלים בלבד.'}</Text>
    {partial ? <Text style={s.notice}>הפירוט השמור חלקי. מוצגות רק הבעיטות שתועדו.</Text> : null}
    {players.length ? <>
      <View style={s.tableHead}>
        <Text style={[s.columnLabel, s.identity]}>שחקן</Text>
        <Text style={[s.columnLabel, s.amount]}>{role === 'kicker' ? 'הבקיע' : 'עצר'}</Text>
        <Text style={[s.columnLabel, s.rate]}>הצלחה</Text>
        <View style={s.chevron} />
      </View>
      {players.map(player => {
        const open = expanded === player.id;
        const displayName = name(player.id, 'שחקן לא ידוע');
        return <View key={player.id} style={s.player}>
          <Pressable accessibilityRole="button" accessibilityLabel={`פירוט הבעיטות של ${displayName}`}
            accessibilityState={{ expanded: open }} onPress={() => setExpanded(open ? null : player.id)} style={s.playerRow}>
            <View style={s.identity}>
              <UserAvatar user={{ ...userOf(player.id), name: displayName }} size={32} />
              <Text style={s.name}>{`\u2068${displayName}\u2069`}</Text>
            </View>
            <Text style={s.amount}>{player.successes} מתוך {player.attempts.length}</Text>
            <Text style={[s.rate, player.pct === null && s.unknown]}>{player.pct === null ? 'חסר פירוט' : `\u2066${player.pct}%\u2069`}</Text>
            <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={14} color={palette.muted} style={s.chevron} />
          </Pressable>
          {open ? <View style={s.details}>
            {player.unknown ? <Text style={s.notice}>בחלק מהבעיטות הישנות לא נשמר אם היתה עצירה או החטאה. אחוז העצירה אינו מוצג.</Text> : null}
            {player.attempts.map(attempt => <View key={attempt.key} style={s.attempt}>
              <Text style={s.game}>משחק {attempt.gameNumber}{attempt.minute === undefined ? '' : `, דקה ${attempt.minute}`}</Text>
              <Text style={s.opponent}>{role === 'kicker' ? `מול \u2068${name(attempt.keeperId, 'שוער לא ידוע')}\u2069` : `בעט \u2068${name(attempt.kickerId, 'בועט לא ידוע')}\u2069`}</Text>
              <Text style={[s.result, { color: attempt.outcome === 'goal' ? colors.success : attempt.outcome === 'save' ? palette.teal : palette.muted }]}>{outcomeText(attempt.outcome)}</Text>
            </View>)}
          </View> : null}
        </View>;
      })}
      <Text style={s.hint}>לחצו על שחקן לפירוט הבעיטות.</Text>
    </> : <Text style={s.empty}>{!hasHistory ? 'אין פירוט פנדלים שמור למחזור הזה.' : selected.length ? role === 'keeper' ? 'לא נשמרה זהות השוער בבעיטות האלה.' : 'לא נשמרה זהות הבועט בבעיטות האלה.' : phase === 'inPlay' ? 'לא נרשמו פנדלים במהלך המשחק.' : 'לא נרשמו פנדלי הכרעה.'}</Text>}
    {role === 'keeper' && players.length > 0 && selected.some(a => !a.keeperId) ? <Text style={s.notice}>בחלק מהבעיטות לא נשמרה זהות השוער.</Text> : null}
  </View>;
}

const s = StyleSheet.create({
  card: { borderRadius: 12, borderWidth: 1, borderColor: palette.border, backgroundColor: '#FFFFFF', padding: 12, gap: 12 },
  switches: { flexDirection: 'row', backgroundColor: '#F0F4FA', borderRadius: 10, padding: 3, gap: 4 },
  switch: { flex: 1, minHeight: 44, justifyContent: 'center', alignItems: 'center', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 8 },
  active: { backgroundColor: palette.ink }, switchText: { color: palette.muted, fontSize: 14, fontWeight: '700', textAlign: 'center' },
  activeText: { color: '#FFFFFF' }, phases: { flexDirection: 'row', gap: 8 },
  phase: { flex: 1, minHeight: 44, justifyContent: 'center', borderRadius: 8, borderWidth: 1, borderColor: palette.border, paddingHorizontal: 6, paddingVertical: 8 },
  phaseActive: { borderColor: palette.teal, backgroundColor: '#EDF3FF' },
  phaseText: { color: palette.muted, fontSize: 12, fontWeight: '600', textAlign: 'center' }, phaseTextActive: { color: palette.teal },
  caption: { color: palette.muted, fontSize: 12, lineHeight: 18, textAlign: RTL_LABEL_ALIGN },
  notice: { color: '#8C5B17', fontSize: 12, lineHeight: 19, textAlign: RTL_LABEL_ALIGN },
  tableHead: { flexDirection: 'row', alignItems: 'center', gap: 6 }, columnLabel: { color: palette.muted, fontSize: 11 },
  player: { borderTopWidth: 1, borderTopColor: palette.border },
  playerRow: { flexDirection: 'row', gap: 6, alignItems: 'center', minHeight: 58, paddingVertical: 10 },
  identity: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 7, textAlign: RTL_LABEL_ALIGN },
  name: { flex: 1, minWidth: 0, color: palette.ink, fontSize: 13, fontWeight: '700', textAlign: RTL_LABEL_ALIGN },
  amount: { width: 64, textAlign: 'center', color: palette.ink, fontSize: 12, fontWeight: '700' },
  rate: { width: 45, textAlign: 'center', color: palette.teal, fontSize: 12, fontWeight: '700' },
  unknown: { color: palette.muted, fontSize: 11 }, chevron: { width: 14 },
  details: { backgroundColor: '#F7FAFC', borderRadius: 8, padding: 10, gap: 10, marginBottom: 10 },
  attempt: { gap: 3 }, game: { color: palette.ink, fontSize: 12, fontWeight: '700', textAlign: RTL_LABEL_ALIGN },
  opponent: { color: palette.muted, fontSize: 12, textAlign: RTL_LABEL_ALIGN },
  result: { fontSize: 12, fontWeight: '600', textAlign: RTL_LABEL_ALIGN },
  hint: { color: palette.muted, fontSize: 11, lineHeight: 17, textAlign: RTL_LABEL_ALIGN },
  empty: { color: palette.muted, fontSize: 13, lineHeight: 21, textAlign: RTL_LABEL_ALIGN, paddingVertical: 8 },
});
