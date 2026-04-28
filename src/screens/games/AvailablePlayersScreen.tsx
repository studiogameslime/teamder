// AvailablePlayersScreen — coach-only "find invitable players for this
// game" surface. Pulls users whose availability matches the game's
// weekday + city + hour and that aren't already in the game, then lets
// the coach send the existing inviteToGame notification per row.
//
// Filters live in `userService.findAvailablePlayers`. This screen is a
// thin presentation layer.

import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RouteProp, useRoute } from '@react-navigation/native';

import { ScreenHeader } from '@/components/ScreenHeader';
import { PlayerIdentity } from '@/components/PlayerIdentity';
import { Button } from '@/components/Button';
import { userService } from '@/services';
import { gameService } from '@/services/gameService';
import { notificationsService } from '@/services/notificationsService';
import { achievementsService } from '@/services/achievementsService';
import type { Game, User } from '@/types';
import { colors, radius, spacing, typography } from '@/theme';
import { he } from '@/i18n/he';
import { useUserStore } from '@/store/userStore';
import { useGroupStore } from '@/store/groupStore';

type RouteParams = { AvailablePlayers: { gameId: string } };

export function AvailablePlayersScreen() {
  const route = useRoute<RouteProp<RouteParams, 'AvailablePlayers'>>();
  const { gameId } = route.params;
  const me = useUserStore((s) => s.currentUser);
  const myCommunities = useGroupStore((s) => s.groups);

  const [game, setGame] = useState<Game | null>(null);
  const [candidates, setCandidates] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [invitingId, setInvitingId] = useState<string | null>(null);
  const [invitedIds, setInvitedIds] = useState<Set<string>>(new Set());

  // Resolve the city for filtering: prefer the community's city.
  const city = useMemo(() => {
    if (!game) return undefined;
    const g = myCommunities.find((c) => c.id === game.groupId);
    return g?.city || undefined;
  }, [game, myCommunities]);

  useEffect(() => {
    if (!gameId || !me) return;
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const myCommunityIds = myCommunities.map((g) => g.id);
        const [mine, community] = await Promise.all([
          gameService.getMyGames(me.id).catch(() => [] as Game[]),
          gameService
            .getCommunityGames(me.id, myCommunityIds)
            .catch(() => [] as Game[]),
        ]);
        const g =
          mine.find((x) => x.id === gameId) ??
          community.find((x) => x.id === gameId) ??
          null;
        if (!alive) return;
        setGame(g);
        if (!g) {
          setCandidates([]);
          return;
        }
        const day = new Date(g.startsAt).getDay();
        const hour = formatHour(g.startsAt);
        const exclude = [
          ...(g.players ?? []),
          ...(g.waitlist ?? []),
          ...(g.pending ?? []),
        ];
        const list = await userService.findAvailablePlayers({
          day,
          hour,
          city,
          excludeIds: exclude,
        });
        if (alive) setCandidates(list);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [gameId, me, myCommunities, city]);

  const invite = async (target: User) => {
    if (!game || !me || invitingId) return;
    setInvitingId(target.id);
    try {
      await notificationsService.inviteToGame({
        recipientId: target.id,
        gameId: game.id,
        gameTitle: game.title,
        inviterName: me.name,
        startsAt: game.startsAt,
      });
      achievementsService.bump(me.id, 'invitesSent', 1);
      setInvitedIds((s) => new Set([...s, target.id]));
    } catch (e) {
      Alert.alert(he.error, String((e as Error).message ?? e));
    } finally {
      setInvitingId(null);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <ScreenHeader title={he.availablePlayersTitle} />
      {loading ? (
        <ActivityIndicator
          size="small"
          color={colors.primary}
          style={{ marginTop: spacing.lg }}
        />
      ) : !game ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>{he.gameLoadError}</Text>
        </View>
      ) : candidates.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>{he.availablePlayersEmpty}</Text>
        </View>
      ) : (
        <FlatList
          contentContainerStyle={styles.list}
          data={candidates}
          keyExtractor={(u) => u.id}
          renderItem={({ item }) => {
            const sent = invitedIds.has(item.id);
            return (
              <View style={styles.row}>
                <PlayerIdentity user={item} size={44} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.name} numberOfLines={1}>
                    {item.name}
                  </Text>
                  {item.availability?.preferredCity ? (
                    <Text style={styles.sub} numberOfLines={1}>
                      {item.availability.preferredCity}
                    </Text>
                  ) : null}
                </View>
                <Button
                  title={
                    sent ? he.playerCardInviteSent : he.playerCardInvite
                  }
                  variant={sent ? 'outline' : 'primary'}
                  size="sm"
                  loading={invitingId === item.id}
                  disabled={sent || invitingId === item.id}
                  onPress={() => invite(item)}
                />
              </View>
            );
          }}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
        />
      )}
    </SafeAreaView>
  );
}

function formatHour(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  list: { padding: spacing.lg, gap: 0 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  sep: { height: 1, backgroundColor: colors.divider, marginVertical: 4 },
  name: { ...typography.bodyBold, color: colors.text },
  sub: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  emptyText: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
  },
});
