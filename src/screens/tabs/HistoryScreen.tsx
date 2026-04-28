import React, { useEffect, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Card } from '@/components/Card';
import { ScreenHeader } from '@/components/ScreenHeader';
import { colors, spacing, typography } from '@/theme';
import { he } from '@/i18n/he';
import { GameSummary, TeamColor } from '@/types';
import { gameService } from '@/services';
import { useCurrentGroup } from '@/store/groupStore';

const TEAM_LABEL: Record<TeamColor, string> = {
  team1: he.team1,
  team2: he.team2,
  team3: he.team3,
};

export function HistoryScreen() {
  const group = useCurrentGroup();
  const [items, setItems] = useState<GameSummary[]>([]);

  useEffect(() => {
    if (!group) return;
    let alive = true;
    gameService.getHistory(group.id).then((list) => {
      if (alive) setItems(list.sort((a, b) => b.date - a.date));
    });
    return () => {
      alive = false;
    };
  }, [group]);

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScreenHeader title={he.historyTitle} />
      {items.length === 0 ? (
        <Text style={styles.empty}>{he.historyEmptyReal}</Text>
      ) : (
        <FlatList
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm }}
          data={items}
          keyExtractor={(g) => g.id}
          renderItem={({ item }) => <HistoryRow item={item} />}
          />
      )}
    </SafeAreaView>
  );
}

function HistoryRow({ item }: { item: GameSummary }) {
  const d = new Date(item.date);
  const dateLabel = `${d.getDate()}.${d.getMonth() + 1}.${String(d.getFullYear()).slice(2)}`;
  const winner = item.lastResult?.winner;
  let resultText = '';
  let resultColor: string = colors.textMuted;
  if (winner === 'tie') {
    resultText = he.tie;
  } else if (winner) {
    resultText = TEAM_LABEL[winner];
    resultColor = winner === 'team1' ? colors.team1 : winner === 'team2' ? colors.team2 : colors.team3;
  }
  return (
    <Card style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text style={styles.date}>{dateLabel}</Text>
        <Text style={styles.matches}>{he.historyMatches(item.matchCount)}</Text>
      </View>
      <Text style={[styles.result, { color: resultColor }]}>{resultText}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  title: { ...typography.h2, color: colors.text },
  empty: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
  },
  date: { ...typography.h3, color: colors.text },
  matches: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  result: { ...typography.bodyBold },
});
