// CommunityHistoryScreen — the full list of a community's finished games
// (evenings). Reachable from the community actions (hamburger) menu. Each row
// opens that game's MatchDetails. Mirrors the inline preview that used to live
// on CommunityDetails, but as a dedicated, scrollable screen.

import React, { useEffect, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';

import { ScreenHeader } from '@/components/ScreenHeader';
import { EmptyState } from '@/components/EmptyState';
import { GameHistoryRow } from '@/components/match/GameHistoryRow';
import { SoccerBallLoader } from '@/components/SoccerBallLoader';
import { gameService } from '@/services/gameService';
import { colors, spacing, typography } from '@/theme';
import { he } from '@/i18n/he';
import type { CommunitiesStackParamList } from '@/navigation/CommunitiesStack';
import type { GameSummary } from '@/types';

type Params = RouteProp<CommunitiesStackParamList, 'CommunityHistory'>;

export function CommunityHistoryScreen() {
  const nav = useNavigation<{ navigate: (s: string, p: object) => void }>();
  const { groupId } = useRoute<Params>().params;
  const [games, setGames] = useState<GameSummary[] | null>(null);

  useEffect(() => {
    let alive = true;
    gameService
      .getHistory(groupId)
      .then((list) => {
        if (!alive) return;
        setGames(list.filter((h) => h.status === 'finished'));
      })
      .catch(() => {
        if (alive) setGames([]);
      });
    return () => {
      alive = false;
    };
  }, [groupId]);

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScreenHeader title={he.communityHistoryTitle} />
      {games === null ? (
        <View style={styles.center}>
          <SoccerBallLoader />
          <Text style={styles.muted}>{he.communityStatsLoading}</Text>
        </View>
      ) : games.length === 0 ? (
        <EmptyState
          icon="time-outline"
          title={he.communityHistoryEmptyTitle}
          hint={he.communityHistoryEmptyBody}
        />
      ) : (
        <FlatList
          data={games}
          keyExtractor={(g) => g.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => (
            <GameHistoryRow
              item={item}
              onPress={() => nav.navigate('MatchDetails', { gameId: item.id })}
            />
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.xl },
  muted: { ...typography.body, color: colors.textMuted },
  list: { padding: spacing.md, gap: spacing.sm },
});
