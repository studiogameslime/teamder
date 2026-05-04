// CommunityPlayersScreen — full member list with per-community stats.
// Reachable from the redesigned CommunityDetailsScreen via the
// PlayersPreview tap, and from the hamburger menu.
//
// Visual: identity-row card per player (jersey + name + admin badge
// + games / wins). Sorted admins-first, then by games-played desc.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  RouteProp,
  useNavigation,
  useRoute,
} from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { ScreenHeader } from '@/components/ScreenHeader';
import { Card } from '@/components/Card';
import { PlayerIdentity } from '@/components/PlayerIdentity';
import { SoccerBallLoader } from '@/components/SoccerBallLoader';
import { groupService } from '@/services';
import { gameService } from '@/services/gameService';
import { colors, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import type { Group, User, UserId } from '@/types';
import type { CommunitiesStackParamList } from '@/navigation/CommunitiesStack';

type Nav = NativeStackNavigationProp<
  CommunitiesStackParamList,
  'CommunityPlayers'
>;
type Params = RouteProp<CommunitiesStackParamList, 'CommunityPlayers'>;

interface PlayerStats {
  gamesPlayed: number;
  wins: number;
}

export function CommunityPlayersScreen() {
  const nav = useNavigation<Nav>();
  const { groupId } = useRoute<Params>().params;
  const [group, setGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<User[]>([]);
  const [stats, setStats] = useState<Record<UserId, PlayerStats> | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const g = await groupService.get(groupId);
      setGroup(g);
      if (!g) {
        setMembers([]);
        setStats({});
        return;
      }
      const ids = Array.from(new Set([...g.adminIds, ...g.playerIds]));
      const [users, derived] = await Promise.all([
        groupService.hydrateUsers(ids),
        gameService.getCommunityPlayerStats(g.id, ids).catch(() => ({})),
      ]);
      setMembers(users);
      setStats(derived);
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => {
    reload();
  }, [reload]);

  // Sort: admins first (by name), then players by games-played desc,
  // tie-broken by name. Ensures the top of the list is the most
  // active/relevant entries.
  const ordered = useMemo(() => {
    if (!group) return [];
    const adminSet = new Set(group.adminIds);
    return [...members].sort((a, b) => {
      const aAdmin = adminSet.has(a.id) ? 1 : 0;
      const bAdmin = adminSet.has(b.id) ? 1 : 0;
      if (aAdmin !== bAdmin) return bAdmin - aAdmin;
      const aGames = stats?.[a.id]?.gamesPlayed ?? 0;
      const bGames = stats?.[b.id]?.gamesPlayed ?? 0;
      if (aGames !== bGames) return bGames - aGames;
      return a.name.localeCompare(b.name, 'he');
    });
  }, [members, stats, group]);

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <ScreenHeader title={he.communityPlayersScreenTitle} />
      {loading && !group ? (
        <View style={styles.center}>
          <SoccerBallLoader size={40} />
        </View>
      ) : !group ? (
        <View style={styles.center}>
          <Text style={styles.empty}>{he.communitiesEmpty}</Text>
        </View>
      ) : ordered.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.empty}>{he.communityPlayersEmpty}</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.headline}>
            {he.communityPlayersTitle}{' '}
            <Text style={styles.headlineCount}>({ordered.length})</Text>
          </Text>
          <Card style={styles.listCard}>
            {ordered.map((u, i) => (
              <PlayerRow
                key={u.id}
                user={u}
                isAdmin={group.adminIds.includes(u.id)}
                stats={stats?.[u.id]}
                showDivider={i > 0}
                onPress={() =>
                  (nav as { navigate: (s: string, p: unknown) => void }).navigate(
                    'PlayerCard',
                    { userId: u.id, groupId: group.id },
                  )
                }
              />
            ))}
          </Card>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function PlayerRow({
  user,
  isAdmin,
  stats,
  showDivider,
  onPress,
}: {
  user: User;
  isAdmin: boolean;
  stats?: PlayerStats;
  showDivider: boolean;
  onPress: () => void;
}) {
  const games = stats?.gamesPlayed ?? 0;
  const wins = stats?.wins ?? 0;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        showDivider && styles.rowDivider,
        pressed && { backgroundColor: colors.surfaceMuted },
      ]}
      accessibilityRole="button"
      accessibilityLabel={user.name}
    >
      <PlayerIdentity user={user} size="sm" />
      <View style={styles.rowBody}>
        <View style={styles.nameRow}>
          <Text style={styles.name} numberOfLines={1}>
            {user.name}
          </Text>
          {isAdmin ? (
            <View style={styles.adminBadge}>
              <Text style={styles.adminBadgeText}>
                {he.communityDetailsAdminBadge}
              </Text>
            </View>
          ) : null}
        </View>
        <View style={styles.statsRow}>
          <StatChip
            icon="football-outline"
            text={he.communityPlayerGames(games)}
          />
          <StatChip
            icon="trophy-outline"
            text={he.communityPlayerWins(wins)}
            tint={wins > 0 ? colors.primary : colors.textMuted}
          />
        </View>
      </View>
      <Ionicons name="chevron-back" size={18} color={colors.textMuted} />
    </Pressable>
  );
}

function StatChip({
  icon,
  text,
  tint = colors.textMuted,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
  tint?: string;
}) {
  return (
    <View style={styles.chip}>
      <Ionicons name={icon} size={12} color={tint} />
      <Text style={[styles.chipText, { color: tint }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
  },
  content: {
    padding: spacing.lg,
    gap: spacing.md,
    paddingBottom: spacing.xl,
  },
  headline: {
    ...typography.h3,
    color: colors.text,
    fontWeight: '800',
    textAlign: RTL_LABEL_ALIGN,
  },
  headlineCount: {
    color: colors.textMuted,
    fontWeight: '500',
    fontSize: 14,
  },
  listCard: {
    padding: 0,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  rowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
  },
  rowBody: {
    flex: 1,
    gap: 4,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  name: {
    ...typography.body,
    color: colors.text,
    fontWeight: '700',
    textAlign: RTL_LABEL_ALIGN,
    flexShrink: 1,
  },
  adminBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: colors.primaryLight,
  },
  adminBadgeText: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '700',
    fontSize: 11,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  chipText: {
    ...typography.caption,
    fontWeight: '600',
  },
});
