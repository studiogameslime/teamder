// GamesListScreen — Matches tab.
//
// Goal of this redesign: a fast-scanning vertical list of compact match
// cards with two segmented tabs at the top — "שלי" (my games) and
// "פתוחים" (everything else, i.e. community + open public games).
//
//   ┌─────────────────────────────────────┐
//   │  משחקים                              │  header
//   │  [ שלי ]  [ פתוחים ]                  │  segmented tabs
//   ├─────────────────────────────────────┤
//   │  [ MatchCard ]                       │
//   │  [ MatchCard ]                       │
//   │  …                                   │
//   ├─────────────────────────────────────┤
//   │                              ⊕      │  floating "+" FAB
//   └─────────────────────────────────────┘
//
// Tapping a card → MatchDetails (NOT the live-match screen). Card has
// its own small action pill (join / leave) that handles the bucket
// logic without leaving the list.

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
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { ScreenHeader } from '@/components/ScreenHeader';
import { Button } from '@/components/Button';
import { SoccerBallLoader } from '@/components/SoccerBallLoader';
import { MatchCard, MatchCardCta } from '@/components/MatchCard';
import { gameService } from '@/services/gameService';
import { Game } from '@/types';
import { colors, radius, shadows, spacing, typography } from '@/theme';
import { he } from '@/i18n/he';
import { useUserStore } from '@/store/userStore';
import { useGroupStore } from '@/store/groupStore';
import { useGameStore } from '@/store/gameStore';
import type { GameStackParamList } from '@/navigation/GameStack';

type Nav = NativeStackNavigationProp<GameStackParamList, 'GamesList'>;

type Tab = 'mine' | 'open';

export function GamesListScreen() {
  const nav = useNavigation<Nav>();
  const user = useUserStore((s) => s.currentUser);
  const myCommunities = useGroupStore((s) => s.groups);
  const hydratePlayers = useGameStore((s) => s.hydratePlayers);

  const [tab, setTab] = useState<Tab>('mine');
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
      const uids = Array.from(
        new Set(
          [...a, ...b, ...c].flatMap((g) => [
            ...g.players,
            ...g.waitlist,
            ...(g.pending ?? []),
          ]),
        ),
      );
      if (uids.length > 0) hydratePlayers(uids);
    } catch (err) {
      if (__DEV__) console.warn('[gamesList] reload failed', err);
    } finally {
      setLoading(false);
    }
  }, [user, myCommunities, hydratePlayers]);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );
  useEffect(() => {
    reload();
  }, [reload]);

  const handleCreate = () => nav.navigate('GameCreate');

  const handleCardPrimary = async (game: Game, cta: MatchCardCta) => {
    if (!user || cta === 'none' || cta === 'pending') return;
    setBusyGameId(game.id);
    try {
      if (cta === 'join' || cta === 'waitlist') {
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

  // Sort upcoming games first by start time, ascending. Old games
  // shouldn't dominate the list.
  const sortByStart = (a: Game, b: Game) => a.startsAt - b.startsAt;

  const visible = useMemo(() => {
    if (tab === 'mine') return [...myGames].sort(sortByStart);
    // "פתוחים" tab — everything that's not strictly "mine". We
    // de-dupe across the community + open buckets in case a game
    // appears in both.
    const set = new Map<string, Game>();
    [...communityGames, ...openGames].forEach((g) => set.set(g.id, g));
    return Array.from(set.values()).sort(sortByStart);
  }, [tab, myGames, communityGames, openGames]);

  const isEmpty = visible.length === 0;

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScreenHeader title={he.gamesListTitle} showBack={false} />

      {/* Segmented tabs */}
      <View style={styles.tabsWrap}>
        <SegmentedTabs
          value={tab}
          onChange={setTab}
          options={[
            { value: 'mine', label: he.matchesTabMine, badge: myGames.length },
            {
              value: 'open',
              label: he.matchesTabOpen,
              badge: communityGames.length + openGames.length,
            },
          ]}
        />
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <SoccerBallLoader size={40} />
        </View>
      ) : isEmpty ? (
        <View style={styles.emptyWrap}>
          <View style={styles.emptyIcon}>
            <Ionicons name="football-outline" size={56} color={colors.primary} />
          </View>
          <Text style={styles.emptyTitle}>
            {tab === 'mine' ? he.matchesEmptyMine : he.matchesEmptyOpen}
          </Text>
          {tab === 'mine' ? (
            <Button
              title={he.gamesCreate}
              variant="primary"
              size="md"
              iconLeft="add-circle-outline"
              onPress={handleCreate}
              style={{ marginTop: spacing.lg, alignSelf: 'stretch' }}
              fullWidth
            />
          ) : null}
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
        >
          {visible.map((g) => (
            <MatchCard
              key={g.id}
              game={g}
              userId={user?.id ?? ''}
              busy={busyGameId === g.id}
              onPrimary={(cta) => handleCardPrimary(g, cta)}
            />
          ))}
        </ScrollView>
      )}

      {/* Floating "+" — always visible while the user has any matches OR
          is on the "mine" tab (so first-time users still see a creation
          shortcut even though the empty state already has one). */}
      <Pressable
        onPress={handleCreate}
        style={({ pressed }) => [
          styles.fab,
          pressed && { transform: [{ scale: 0.95 }] },
        ]}
        accessibilityLabel="create-match"
      >
        <Ionicons name="add" size={28} color="#fff" />
      </Pressable>
    </SafeAreaView>
  );
}

// ─── SegmentedTabs ─────────────────────────────────────────────────────

function SegmentedTabs<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string; badge?: number }>;
}) {
  return (
    <View style={tabStyles.wrap}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => onChange(opt.value)}
            style={[tabStyles.tab, active && tabStyles.tabActive]}
          >
            <Text
              style={[tabStyles.label, active && tabStyles.labelActive]}
              numberOfLines={1}
            >
              {opt.label}
            </Text>
            {opt.badge !== undefined && opt.badge > 0 ? (
              <View
                style={[
                  tabStyles.badge,
                  active && tabStyles.badgeActive,
                ]}
              >
                <Text
                  style={[
                    tabStyles.badgeText,
                    active && tabStyles.badgeTextActive,
                  ]}
                >
                  {opt.badge}
                </Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const tabStyles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.pill,
    padding: 4,
    gap: 4,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  tabActive: {
    backgroundColor: '#fff',
    ...shadows.card,
  },
  label: {
    ...typography.label,
    color: colors.textMuted,
    fontWeight: '600',
  },
  labelActive: {
    color: colors.text,
    fontWeight: '700',
  },
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    minWidth: 20,
    alignItems: 'center',
  },
  badgeActive: {
    backgroundColor: colors.primaryLight,
  },
  badgeText: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '700',
    fontSize: 11,
  },
  badgeTextActive: {
    color: colors.primary,
  },
});

// ─── Screen styles ──────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },

  tabsWrap: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },

  list: {
    paddingHorizontal: spacing.lg,
    paddingBottom: 120,
    gap: spacing.md,
  },

  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xxl,
    gap: spacing.md,
  },
  emptyIcon: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: {
    ...typography.h3,
    color: colors.text,
    textAlign: 'center',
    fontWeight: '700',
  },

  fab: {
    position: 'absolute',
    bottom: spacing.xxl,
    end: spacing.xl,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.raised,
  },
});
