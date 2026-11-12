import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { UserAvatar } from '@/components/UserAvatar';
import { colors, RTL_LABEL_ALIGN } from '@/theme';
import { clubStatsPalette as palette } from '@/components/community/ClubStatsDashboard';
import type { EveningPenaltyAttempt, PenaltyPhase } from '@/utils/roundPenalties';

export interface RoundPenaltiesCardProps {
  attempts: EveningPenaltyAttempt[];
  hasHistory: boolean;
  partial?: boolean;
  userOf: (id: string) => { id: string; name: string; avatarId?: string; photoUrl?: string };
}

const phases: { value: PenaltyPhase; label: string; empty: string }[] = [
  { value: 'inPlay', label: 'במהלך המשחק', empty: 'לא נרשמו פנדלים במהלך המשחק.' },
  { value: 'shootout', label: 'פנדלי הכרעה', empty: 'לא נרשמו פנדלי הכרעה.' },
];
const outcomes: Record<EveningPenaltyAttempt['outcome'], {
  text: string; icon: React.ComponentProps<typeof Ionicons>['name']; color: string;
}> = {
  goal: { text: 'כבש', icon: 'football-outline', color: colors.success },
  save: { text: 'השוער עצר', icon: 'hand-left-outline', color: palette.teal },
  miss: { text: 'החטיא', icon: 'close', color: colors.danger },
  unknown: { text: 'לא הובקע', icon: 'help-circle-outline', color: palette.muted },
};

/** Every saved kick is visible with both participants. No filters or disclosure controls. */
export function RoundPenaltiesCard({ attempts, hasHistory, partial, userOf }: RoundPenaltiesCardProps) {
  const participant = (id: string | null, fallback: string) => {
    const user = id ? userOf(id) : null;
    return { user, name: user?.name || fallback };
  };
  return <View style={s.card} testID="round-penalties-card">
    {partial ? <Text style={s.notice}>הפירוט השמור חלקי. מוצגות רק הבעיטות שתועדו.</Text> : null}
    {!hasHistory ? <Text style={s.empty}>אין פירוט פנדלים שמור למחזור הזה.</Text> : phases.map((phase, phaseIndex) => {
      const selected = attempts.filter(attempt => attempt.phase === phase.value);
      const games = [...new Set(selected.map(attempt => attempt.gameNumber))];
      return <View key={phase.value} style={[s.phase, phaseIndex > 0 && s.phaseDivider]}>
        <Text style={s.phaseTitle}>{phase.label}</Text>
        {!selected.length ? <Text style={s.empty}>{phase.empty}</Text> : games.map(gameNumber => <View key={gameNumber} style={s.game}>
          <Text style={s.gameTitle}>משחק {gameNumber}</Text>
          <View style={s.columns}>
            <Text style={[s.columnLabel, s.personColumn]}>בועט</Text>
            <Text style={[s.columnLabel, s.resultColumn]}>תוצאה</Text>
            <Text style={[s.columnLabel, s.personColumn]}>שוער</Text>
          </View>
          {selected.filter(attempt => attempt.gameNumber === gameNumber).map((attempt, index) => {
            const kicker = participant(attempt.kickerId, 'בועט לא תועד');
            const keeper = participant(attempt.keeperId, 'שוער לא תועד');
            const result = outcomes[attempt.outcome];
            return <View key={attempt.key} style={[s.attempt, index > 0 && s.attemptDivider]} testID={`penalty-attempt-${attempt.key}`}
              accessible accessibilityLabel={`משחק ${gameNumber}, בועט: ${kicker.name}, תוצאה: ${result.text}, שוער: ${keeper.name}${attempt.minute === undefined ? '' : `, דקה ${attempt.minute}`}`}>
              <View style={s.person} testID={`penalty-kicker-${attempt.key}`}>
                <UserAvatar user={kicker.user} size={28} />
                <Text style={s.name}>{`\u2068${kicker.name}\u2069`}</Text>
              </View>
              <View style={s.resultColumn}>
                <View style={s.resultLine}>
                  {/* forceRTL puts the first child on the right: the icon follows
                      the text so it is physically LEFT of it. */}
                  <Text style={[s.resultText, { color: result.color }]} testID={`penalty-result-text-${attempt.key}`}>{result.text}</Text>
                  <View style={s.resultIcon} testID={`penalty-result-icon-${attempt.key}`}>
                    <Ionicons name={result.icon} size={16} color={result.color} allowFontScaling={false} />
                  </View>
                </View>
                {attempt.minute === undefined ? null : <Text style={s.minute}>דקה {attempt.minute}</Text>}
              </View>
              <View style={s.person} testID={`penalty-keeper-${attempt.key}`}>
                <UserAvatar user={keeper.user} size={28} />
                <Text style={s.name}>{`\u2068${keeper.name}\u2069`}</Text>
              </View>
            </View>;
          })}
        </View>)}
      </View>;
    })}
    {hasHistory && attempts.some(attempt => attempt.outcome === 'unknown') ?
      <Text style={s.notice}>בחלק מהבעיטות הישנות לא נשמר אם היתה עצירה או החטאה.</Text> : null}
  </View>;
}

const s = StyleSheet.create({
  card: { borderRadius: 12, borderWidth: 1, borderColor: palette.border, backgroundColor: '#FFFFFF', padding: 12, gap: 16 },
  phase: { gap: 8 }, phaseDivider: { borderTopWidth: 1, borderTopColor: palette.border, paddingTop: 16 },
  phaseTitle: { color: palette.ink, fontSize: 18, fontWeight: '800', textAlign: RTL_LABEL_ALIGN },
  game: { gap: 8 }, gameTitle: { color: palette.muted, fontSize: 13, textAlign: RTL_LABEL_ALIGN },
  columns: { flexDirection: 'row', gap: 6, borderTopWidth: 1, borderTopColor: palette.border, paddingVertical: 4 },
  columnLabel: { color: palette.muted, fontSize: 12, fontWeight: '600', textAlign: 'center' },
  personColumn: { flex: 1, minWidth: 0 },
  attempt: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 12, minHeight: 60 },
  attemptDivider: { borderTopWidth: 1, borderTopColor: palette.border },
  person: { flex: 1, minWidth: 0, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6 },
  name: { flexShrink: 1, minWidth: 0, color: palette.ink, fontSize: 13, fontWeight: '700', textAlign: 'center' },
  resultColumn: { width: 88, gap: 4 }, resultLine: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 4 },
  resultText: { flexShrink: 1, fontSize: 13, fontWeight: '700', textAlign: 'center' }, resultIcon: { width: 16, flexShrink: 0, alignItems: 'center' },
  minute: { color: palette.muted, fontSize: 11, textAlign: 'center' },
  notice: { color: '#8C5B17', fontSize: 12, lineHeight: 19, textAlign: RTL_LABEL_ALIGN },
  empty: { color: palette.muted, fontSize: 13, lineHeight: 21, textAlign: RTL_LABEL_ALIGN, paddingVertical: 8 },
});
