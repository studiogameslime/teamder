import { ChangeMotion } from '@/components/anim/ChangeMotion';
// CommunityHistoryScreen — the full list of a community's finished games
// (evenings). Reachable from the community actions (hamburger) menu. Each row
// opens that game's MatchDetails. Mirrors the inline preview that used to live
// on CommunityDetails, but as a dedicated, scrollable screen.

import React, { useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';

import { ScreenHeader } from '@/components/ScreenHeader';
import { EmptyState } from '@/components/EmptyState';
import { CommunityHistoryRow } from '@/components/match/CommunityHistoryRow';
import { SoccerBallLoader } from '@/components/SoccerBallLoader';
import { gameService } from '@/services/gameService';
import { colors, radius, spacing, typography } from '@/theme';
import { useUserStore } from '@/store/userStore';
import { he } from '@/i18n/he';
import type { CommunitiesStackParamList } from '@/navigation/CommunitiesStack';
import type { GameSummary } from '@/types';

type Params = RouteProp<CommunitiesStackParamList, 'CommunityHistory'>;

export function CommunityHistoryScreen() {
  const nav = useNavigation<{ navigate: (s: string, p: object) => void }>();
  const { groupId } = useRoute<Params>().params;
  const userId = useUserStore((s) => s.currentUser?.id);
  const [games, setGames] = useState<GameSummary[] | null>(null);
  const [playedOnly, setPlayedOnly] = useState(false);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true;
    setGames(null);
    setError(false);
    if (!userId) {
      setGames([]);
      return;
    }
    gameService
      .getHistory(groupId, userId)
      .then((list) => {
        if (!alive) return;
        setGames(list.filter((h) => h.status === 'finished'));
      })
      .catch(() => {
        if (alive) { setError(true); setGames([]); }
      });
    return () => {
      alive = false;
    };
  }, [groupId, userId, reload]);

  const visibleGames = playedOnly ? games?.filter((g) => g.viewerPlayed === true) : games;

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScreenHeader title={he.communityHistoryTitle} />
      <View style={styles.filters} accessibilityRole="tablist">
        {[false, true].map((only) => (
          <Pressable key={String(only)} accessibilityRole="tab" accessibilityState={{ selected: playedOnly === only }}
            onPress={() => setPlayedOnly(only)} style={[styles.filter, playedOnly === only && styles.selectedFilter]}>
            <Text style={[styles.filterText, playedOnly === only && styles.selectedText]}>
              {only ? he.historyFilterPlayed : he.historyFilterAll}
            </Text>
          </Pressable>
        ))}
      </View>
      {games === null ? (
        <View style={styles.center}>
          <SoccerBallLoader />
          <Text style={styles.muted}>{he.communityStatsLoading}</Text>
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.muted}>{he.historyLoadError}</Text>
          <Pressable onPress={() => setReload((n) => n + 1)} accessibilityRole="button" style={styles.retryButton}>
            <Text style={styles.selectedText}>{he.retry}</Text>
          </Pressable>
        </View>
      ) : visibleGames?.length === 0 ? (
        <EmptyState
          icon="time-outline"
          title={playedOnly ? he.historyPlayedEmpty : he.communityHistoryEmptyTitle}
          hint={playedOnly ? undefined : he.communityHistoryEmptyBody}
        />
      ) : (
        <ChangeMotion triggerKey={playedOnly} style={{ flex: 1 }}>
        <FlatList
          data={visibleGames}
          extraData={userId}
          keyExtractor={(g) => g.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => (
            <CommunityHistoryRow
              item={item}
              onPress={() => nav.navigate('MatchDetails', { gameId: item.id })}
            />
          )}
        />
        </ChangeMotion>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.xl },
  muted: { ...typography.body, color: colors.textMuted },
  list: { padding: spacing.md, gap: spacing.sm },
  filters: { flexDirection: 'row', marginHorizontal: spacing.md, marginTop: spacing.sm,
    padding: 3, borderRadius: radius.lg, backgroundColor: colors.surfaceMuted },
  filter: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 40, borderRadius: radius.md },
  selectedFilter: { backgroundColor: colors.primaryLight },
  filterText: { ...typography.label, fontWeight: '700', color: colors.textMuted },
  selectedText: { ...typography.label, fontWeight: '700', color: colors.primary },
  retryButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.lg },
});
