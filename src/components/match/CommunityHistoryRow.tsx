import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Card } from '@/components/Card';
import { Badge } from '@/components/Badge';
import { PressableScale } from '@/components/PressableScale';
import { colors, radius, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import type { GameSummary } from '@/types';

function Metric({ icon, text }: {
  icon: React.ReactNode;
  text: string;
}) {
  return <View style={styles.metric}>{icon}<Text style={styles.metricText} numberOfLines={1}>{text}</Text></View>;
}

export function CommunityHistoryRow({ item, onPress }: {
  item: GameSummary;
  onPress: () => void;
}) {
  const date = new Date(item.date);
  const dateLabel = `${date.getDate()}.${date.getMonth() + 1}.${String(date.getFullYear()).slice(2)}`;
  const played = item.viewerPlayed === true;
  const iconProps = { size: 19, color: colors.textMuted };
  return (
    <PressableScale onPress={onPress} style={styles.pressable} accessibilityRole="button"
      accessibilityLabel={`${dateLabel}, ${item.title ?? ''}, ${played ? he.historyFilterPlayed : he.historyDidNotPlay}`}>
      <Card style={styles.card}>
        <View style={styles.header}>
          <Text style={styles.date}>{dateLabel}</Text>
          <Badge label={played ? he.historyFilterPlayed : he.historyDidNotPlay}
            tone={played ? 'primary' : 'neutral'} icon={played ? 'checkmark-circle' : 'remove-circle-outline'}
            style={{ gap: spacing.xs }} />
        </View>
        <Text style={styles.title} numberOfLines={1}>{item.title ?? ''}</Text>
        <Text style={styles.location} numberOfLines={1}>{item.fieldName ?? ''}</Text>
        <View style={styles.footer}>
          <View style={styles.grid}>
            <View style={styles.metricRow}>
              <Metric icon={<Ionicons name="people-outline" {...iconProps} />}
                text={he.historyPlayersCount(item.playerCount ?? 0)} />
              <Metric icon={<MaterialCommunityIcons name="soccer-field" {...iconProps} />}
                text={he.historyMatches(item.matchCount)} />
            </View>
            <View style={styles.metricRow}>
              <Metric icon={<Ionicons name="football-outline" {...iconProps} />}
                text={item.viewerGoals == null ? he.historyGoalsUnavailable : he.historyGoalsCount(item.viewerGoals)} />
              <Metric icon={<MaterialCommunityIcons name="shoe-cleat" {...iconProps} />}
                text={item.viewerAssists == null ? he.historyAssistsUnavailable : he.historyAssistsCount(item.viewerAssists)} />
            </View>
          </View>
          <View style={styles.formatSlot}>
            {item.format ? <View style={styles.formatChip}><Text style={styles.formatText}>{item.format}</Text></View> : null}
          </View>
        </View>
      </Card>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  pressable: { borderRadius: radius.xl },
  card: { padding: spacing.md },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 24 },
  date: { ...typography.h3, color: colors.text, fontWeight: '700', textAlign: RTL_LABEL_ALIGN },
  title: { ...typography.bodyBold, color: colors.text, textAlign: RTL_LABEL_ALIGN, minHeight: 22 },
  location: { ...typography.caption, color: colors.textMuted, textAlign: RTL_LABEL_ALIGN, minHeight: 18 },
  footer: { flexDirection: 'row', alignItems: 'flex-end', marginTop: spacing.xs, gap: spacing.sm },
  grid: { flex: 1, gap: spacing.xs },
  metricRow: { flexDirection: 'row', gap: spacing.sm },
  metric: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 5, minWidth: 0 },
  metricText: { ...typography.caption, color: colors.text, flexShrink: 1, textAlign: RTL_LABEL_ALIGN },
  formatSlot: { width: 42, alignItems: 'center', minHeight: 22 },
  formatChip: { backgroundColor: colors.primaryLight, paddingHorizontal: 7, paddingVertical: 2, borderRadius: radius.pill },
  formatText: { fontSize: 11, fontWeight: '700', color: colors.primary },
});
