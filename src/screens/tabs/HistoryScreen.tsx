import React, { useEffect, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';

import { Card } from '@/components/Card';
import { PressableScale } from '@/components/PressableScale';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Badge } from '@/components/Badge';
import { colors, radius, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
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
  // `useNavigation<any>` because History lives in ProfileStack but
  // navigates cross-stack into GameTab → MatchDetails. The shape is
  // verified by the deep-link consumer (navigationRef.navigateInvite)
  // and exercised in production already.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nav = useNavigation<any>();
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

  const openDetails = (gameId: string) => {
    // Cross-stack navigation: jump to the Games tab and push the
    // MatchDetails route there. The screen's own lifecycle helpers
    // (canJoinGame / canCancelRegistration / etc.) ensure the read-
    // only state is rendered correctly for finished + cancelled.
    nav.navigate('GameTab', {
      screen: 'MatchDetails',
      params: { gameId },
    });
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScreenHeader title={he.historyTitle} />
      {items.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyTitle}>{he.historyEmptyReal}</Text>
          <Text style={styles.emptyHint}>{he.historyEmptyHint}</Text>
        </View>
      ) : (
        <FlatList
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm }}
          data={items}
          keyExtractor={(g) => g.id}
          renderItem={({ item }) => (
            <HistoryRow item={item} onPress={() => openDetails(item.id)} />
          )}
        />
      )}
    </SafeAreaView>
  );
}

function HistoryRow({
  item,
  onPress,
}: {
  item: GameSummary;
  onPress: () => void;
}) {
  const d = new Date(item.date);
  const dateLabel = `${d.getDate()}.${d.getMonth() + 1}.${String(d.getFullYear()).slice(2)}`;
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

  // Status label — `cancelled` gets a danger-toned badge so it visually
  // distinguishes from a normal completion. Older history docs without
  // a `status` field default to "finished" via the converter projection.
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
          <Text style={styles.matches}>{he.historyMatches(item.matchCount)}</Text>
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
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    gap: spacing.xs,
  },
  emptyTitle: {
    ...typography.h3,
    color: colors.text,
    textAlign: 'center',
    fontWeight: '700',
  },
  emptyHint: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
  },
  rowPressable: {
    borderRadius: radius.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  date: {
    ...typography.h3,
    color: colors.text,
    textAlign: RTL_LABEL_ALIGN,
  },
  matches: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: 2,
    textAlign: RTL_LABEL_ALIGN,
  },
  result: { ...typography.bodyBold },
});
