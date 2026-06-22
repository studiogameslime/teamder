// GameHistoryRow — one finished/cancelled game in a history list.
//
// Shared by the player's History tab AND the per-community history section, so
// both read identically (user report: "היסטוריית משחקים פר מועדון … באותו סגנון").

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Card } from '@/components/Card';
import { Badge } from '@/components/Badge';
import { PressableScale } from '@/components/PressableScale';
import { colors, radius, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import type { GameSummary, TeamColor } from '@/types';

const TEAM_LABEL: Record<TeamColor, string> = {
  team1: he.team1,
  team2: he.team2,
  team3: he.team3,
};

export function GameHistoryRow({
  item,
  onPress,
}: {
  item: GameSummary;
  onPress: () => void;
}) {
  const d = new Date(item.date);
  const dateLabel = `${d.getDate()}.${d.getMonth() + 1}.${String(
    d.getFullYear(),
  ).slice(2)}`;
  const winner = item.lastResult?.winner;
  let resultText = '';
  let resultColor: string = colors.textMuted;
  if (winner === 'tie') {
    resultText = he.tie;
  } else if (winner) {
    resultText = TEAM_LABEL[winner];
    resultColor =
      winner === 'team1'
        ? colors.team1
        : winner === 'team2'
          ? colors.team2
          : colors.team3;
  }
  const isCancelled = item.status === 'cancelled';

  return (
    <PressableScale
      onPress={onPress}
      style={styles.rowPressable}
      accessibilityLabel="open-history-game"
    >
      <Card style={styles.row}>
        <View style={{ flex: 1 }}>
          <View style={styles.headerRow}>
            <Text style={styles.date}>{dateLabel}</Text>
            <Badge
              label={
                isCancelled
                  ? he.matchDetailsAlreadyCancelled
                  : he.matchDetailsAlreadyFinished
              }
              tone={isCancelled ? 'danger' : 'neutral'}
            />
          </View>
          {item.title ? (
            <Text style={styles.gameTitle} numberOfLines={1}>
              {item.title}
            </Text>
          ) : null}
          <View style={styles.metaRow}>
            {item.fieldName ? (
              <Text style={styles.metaText} numberOfLines={1}>
                {item.fieldName}
              </Text>
            ) : null}
            {item.format ? (
              <View style={styles.formatChip}>
                <Text style={styles.formatChipText}>{item.format}</Text>
              </View>
            ) : null}
          </View>
          {item.matchCount > 0 ? (
            <Text style={styles.matches}>
              {he.historyMatches(item.matchCount)}
            </Text>
          ) : null}
        </View>
        {resultText ? (
          <Text style={[styles.result, { color: resultColor }]}>
            {resultText}
          </Text>
        ) : null}
      </Card>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  rowPressable: { borderRadius: radius.lg },
  row: { flexDirection: 'row', alignItems: 'center', padding: spacing.md },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  date: { ...typography.h3, color: colors.text, textAlign: RTL_LABEL_ALIGN },
  matches: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: 2,
    textAlign: RTL_LABEL_ALIGN,
  },
  gameTitle: {
    ...typography.body,
    color: colors.text,
    fontWeight: '700',
    marginTop: 4,
    textAlign: RTL_LABEL_ALIGN,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: 4,
  },
  metaText: {
    ...typography.caption,
    color: colors.textMuted,
    flex: 1,
    textAlign: RTL_LABEL_ALIGN,
  },
  formatChip: {
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },
  formatChipText: { fontSize: 11, fontWeight: '800', color: '#1E40AF' },
  result: { ...typography.bodyBold },
});
