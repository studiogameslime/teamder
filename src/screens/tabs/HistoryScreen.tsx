import React, { useEffect, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';

import { Card } from '@/components/Card';
import { MatchCardSkeleton } from '@/components/anim/MatchCardSkeleton';
import { PressableScale } from '@/components/PressableScale';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Badge } from '@/components/Badge';
import { colors, radius, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import { GameSummary, TeamColor } from '@/types';
import { gameService } from '@/services';
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';
import { logError } from '@/services/errorLog';
import { useUserStore } from '@/store/userStore';

const TEAM_LABEL: Record<TeamColor, string> = {
  team1: he.team1,
  team2: he.team2,
  team3: he.team3,
};

export function HistoryScreen() {
  // History is now PERSONAL (cross-group): the games the user actually
  // played — i.e. was placed in the drawn teams for, and the game has
  // passed. Previously this was the current group's "finished" games,
  // which stayed empty because games are rarely ended manually.
  const userId = useUserStore((s) => s.currentUser?.id);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nav = useNavigation<any>();
  const [items, setItems] = useState<GameSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    logEvent(AnalyticsEvent.HistoryOpened);
  }, []);

  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    gameService
      .getPlayedGames(userId)
      .then((list) => {
        if (alive) setItems(list.sort((a, b) => b.date - a.date));
      })
      .catch((err) => {
        // Without this, a failed fetch silently shows the empty state
        // ("no history") — indistinguishable from genuinely having none.
        logError('loadHistory', err, {
          screen: 'HistoryScreen',
          userId,
        });
        if (__DEV__) console.warn('[history] load failed', err);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [userId]);

  const openDetails = (gameId: string) => {
    // Push within the current stack (ProfileStack) — back returns to
    // History rather than jumping the user to GamesList in the Games
    // tab, which the previous cross-tab navigate did.
    nav.navigate('MatchDetails', { gameId });
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScreenHeader title={he.historyTitle} />
      {loading ? (
        <View style={{ padding: spacing.lg, gap: spacing.sm }}>
          <MatchCardSkeleton count={4} />
        </View>
      ) : items.length === 0 ? (
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
          {/* Title + field name + format chip — give the user enough
              detail to tell games apart without drilling in. Each
              line is optional and the layout collapses when missing. */}
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
  // Title — game's headline, e.g. "חמישי כדורגל". Named gameTitle
  // (not title) so it doesn't collide with the screen-header `title`
  // style above.
  gameTitle: {
    ...typography.body,
    color: colors.text,
    fontWeight: '700',
    marginTop: 4,
    textAlign: RTL_LABEL_ALIGN,
  },
  // Field name + format chip row — secondary info row, kept compact.
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
  formatChipText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#1E40AF',
  },
  result: { ...typography.bodyBold },
});
