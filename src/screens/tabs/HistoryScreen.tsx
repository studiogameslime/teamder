import React, { useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';

import { MatchCardSkeleton } from '@/components/anim/MatchCardSkeleton';
import { ScreenHeader } from '@/components/ScreenHeader';
import { GameHistoryRow } from '@/components/match/GameHistoryRow';
import { colors, radius, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import { GameSummary } from '@/types';
import { gameService } from '@/services';
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';
import { logError } from '@/services/errorLog';
import { useUserStore } from '@/store/userStore';


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
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);

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
    setError(false);
    gameService
      .getPlayedGames(userId)
      .then((list) => {
        if (alive) setItems(list.sort((a, b) => b.date - a.date));
      })
      .catch((err) => {
        // A failed fetch must NOT masquerade as the empty state ("no history")
        // — surface a distinct error + retry instead.
        if (alive) setError(true);
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
  }, [userId, reload]);

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
      ) : error ? (
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyTitle}>{he.historyLoadError}</Text>
          <Pressable
            onPress={() => setReload((n) => n + 1)}
            style={styles.retryBtn}
            accessibilityRole="button"
          >
            <Text style={styles.retryText}>{he.retry}</Text>
          </Pressable>
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
            <GameHistoryRow item={item} onPress={() => openDetails(item.id)} />
          )}
        />
      )}
    </SafeAreaView>
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
  retryBtn: {
    marginTop: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  retryText: {
    ...typography.body,
    color: colors.primary,
    fontWeight: '700',
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
