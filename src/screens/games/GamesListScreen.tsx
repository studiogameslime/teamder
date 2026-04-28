// Games tab — sectioned list (Phase 4 wiring).
//
// Sections (each loaded independently):
//   1. My Games               — games the user joined / waitlisted / pending
//   2. From My Communities    — games in their communities they haven't joined
//   3. Open Games             — public games from any community
//
// Empty state: when ALL three sections are empty we show a single centered
// CTA instead of three empty cards. The FAB only appears once at least one
// section has games — otherwise the centered CTA carries the "create"
// affordance and a FAB on top of it would be redundant.

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { ScreenHeader } from '@/components/ScreenHeader';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { GameCard, GameCardCta } from '@/components/GameCard';
import { gameService } from '@/services/gameService';
import { Game } from '@/types';
import { colors, spacing, typography } from '@/theme';
import { he } from '@/i18n/he';
import { useUserStore } from '@/store/userStore';
import { useGroupStore } from '@/store/groupStore';
import { useGameStore } from '@/store/gameStore';
import type { GameStackParamList } from '@/navigation/GameStack';

type Nav = NativeStackNavigationProp<GameStackParamList, 'GamesList'>;

export function GamesListScreen() {
  const nav = useNavigation<Nav>();
  const user = useUserStore((s) => s.currentUser);
  const myCommunities = useGroupStore((s) => s.groups);
  const hydratePlayers = useGameStore((s) => s.hydratePlayers);

  const [myGames, setMyGames] = useState<Game[]>([]);
  const [communityGames, setCommunityGames] = useState<Game[]>([]);
  const [openGames, setOpenGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyGameId, setBusyGameId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const myCommunityIds = myCommunities.map((g) => g.id);
      const [a, b, c] = await Promise.all([
        gameService.getMyGames(user.id),
        gameService.getCommunityGames(user.id, myCommunityIds),
        gameService.getOpenGames(user.id, myCommunityIds),
      ]);
      setMyGames(a);
      setCommunityGames(b);
      setOpenGames(c);
      // Hydrate players' avatars/names so the GameCard's avatar strip
      // shows real users instead of initials. Cheap — gameStore caches
      // and only fetches uids it doesn't already have.
      const uids = Array.from(
        new Set(
          [...a, ...b, ...c].flatMap((g) => [
            ...g.players,
            ...g.waitlist,
            ...(g.pending ?? []),
          ])
        )
      );
      if (uids.length > 0) {
        hydratePlayers(uids);
      }
    } catch (err) {
      if (__DEV__) console.warn('[gamesList] reload failed', err);
    } finally {
      setLoading(false);
    }
  }, [user, myCommunities, hydratePlayers]);

  // Refresh whenever the tab regains focus so a join/cancel done elsewhere
  // (or a new game created via FAB) shows up immediately.
  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload])
  );

  useEffect(() => {
    reload();
  }, [reload]);

  const handleCreate = () => nav.navigate('GameCreate');

  const handleCardPrimary = async (game: Game, cta: GameCardCta) => {
    if (!user) return;
    setBusyGameId(game.id);
    try {
      if (cta === 'join' || cta === 'joinWaitlist' || cta === 'requestJoin') {
        await gameService.joinGameV2(game.id, user.id);
      } else if (cta === 'cancel' || cta === 'leaveWaitlist') {
        await gameService.cancelGameV2(game.id, user.id);
      }
      await reload();
    } catch (err) {
      if (__DEV__) console.warn('[gamesList] action failed', err);
    } finally {
      setBusyGameId(null);
    }
  };

  const isEmpty =
    myGames.length === 0 &&
    communityGames.length === 0 &&
    openGames.length === 0;

  if (loading && isEmpty) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <ScreenHeader title={he.gamesListTitle} showBack={false} />
        <ActivityIndicator
          size="small"
          color={colors.primary}
          style={{ marginTop: spacing.lg }}
        />
      </SafeAreaView>
    );
  }

  if (isEmpty) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <ScreenHeader title={he.gamesListTitle} showBack={false} />
        <View style={styles.emptyAll}>
          <View style={styles.emptyIcon}>
            <Ionicons name="football-outline" size={64} color={colors.primary} />
          </View>
          <Text style={styles.emptyTitle}>{he.gamesEmptyAllTitle}</Text>
          <Text style={styles.emptySub}>{he.gamesEmptyAllSub}</Text>
          <Button
            title={he.gamesCreate}
            variant="primary"
            size="lg"
            iconLeft="add-circle-outline"
            onPress={handleCreate}
            style={{ marginTop: spacing.lg, alignSelf: 'stretch' }}
            fullWidth
          />
        </View>
      </SafeAreaView>
    );
  }

  const renderGame = (g: Game) => {
    const adminCommunity = myCommunities.find((c) => c.id === g.groupId);
    const isAdmin =
      !!user &&
      (g.createdBy === user.id ||
        (!!adminCommunity && adminCommunity.adminIds.includes(user.id)));
    return (
      <GameCard
        key={g.id}
        game={g}
        userId={user?.id ?? ''}
        busy={busyGameId === g.id}
        onPrimary={(cta) => handleCardPrimary(g, cta)}
        isAdmin={isAdmin}
        onManage={() => nav.navigate('LiveMatch', { gameId: g.id })}
      />
    );
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScreenHeader title={he.gamesListTitle} showBack={false} />
      <ScrollView contentContainerStyle={styles.content}>
        <Section
          title={he.gamesSectionMy}
          empty={he.gamesEmptyMy}
          items={myGames}
          render={renderGame}
        />
        <Section
          title={he.gamesSectionFromCommunities}
          empty={he.gamesEmptyFromCommunities}
          items={communityGames}
          render={renderGame}
        />
        <Section
          title={he.gamesSectionOpen}
          empty={he.gamesEmptyOpen}
          items={openGames}
          render={renderGame}
        />
      </ScrollView>

      <Pressable
        style={styles.fab}
        onPress={handleCreate}
        accessibilityLabel="create-game"
      >
        <Ionicons name="add" size={28} color="#fff" />
      </Pressable>
    </SafeAreaView>
  );
}

function Section<T>({
  title,
  empty,
  items,
  render,
}: {
  title: string;
  empty: string;
  items: T[];
  render: (item: T) => React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {items.length === 0 ? (
        <Card style={styles.emptyCard}>
          <Text style={styles.emptyText}>{empty}</Text>
        </Card>
      ) : (
        items.map((it) => render(it))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: 120 },

  emptyAll: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    gap: spacing.sm,
  },
  emptyIcon: {
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  emptyTitle: { ...typography.h2, color: colors.text, textAlign: 'center' },
  emptySub: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
  },

  section: { gap: spacing.sm },
  sectionTitle: {
    ...typography.h3,
    color: colors.text,
    textAlign: 'right',
  },
  emptyCard: {
    alignItems: 'center',
    paddingVertical: spacing.lg,
  },
  emptyText: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
  },

  fab: {
    position: 'absolute',
    bottom: spacing.lg,
    left: spacing.lg,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
});
