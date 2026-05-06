// GamesListScreen — Matches tab, redesigned.
//
// Layout (top → bottom, RTL):
//   ① Blue gradient hero with stadium photo, title + subtitle, calendar
//      disc on the right, filter button on the left.
//   ② Pill segmented control: פתוחים (default) / שלי. Floating up onto
//      the bottom of the hero via negative marginTop.
//   ③ Section title with blue underline indicator.
//   ④ List of MatchListCards (premium, with format strip on left).
//   ⑤ MatchEmptyHintCard at the bottom — a static "still didn't find
//      a match?" CTA card that lives below the list, not in place of
//      it. Empty state (no cards at all) replaces the list entirely.
//   ⑥ Floating "+" FAB pinned to the bottom-LEFT.
//
// Logic / data flow / navigation are all unchanged.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  useFocusEffect,
  useNavigation,
  useScrollToTop,
} from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { Button } from '@/components/Button';
import { SoccerBallLoader } from '@/components/SoccerBallLoader';
import { toast } from '@/components/Toast';
import { ConfirmDestructiveModal } from '@/components/ConfirmDestructiveModal';
import {
  MatchListCard,
  type MatchCardCta,
} from '@/components/match/MatchListCard';
import { MatchesHero } from '@/components/match/MatchesHero';
import { MatchSegmentControl } from '@/components/match/MatchSegmentControl';
import { MatchEmptyHintCard } from '@/components/match/MatchEmptyHintCard';
import {
  GameFilterSheet,
  EMPTY_GAME_FILTERS,
  applyGameFilters,
  activeFiltersCount,
  type GameFilters,
} from '@/components/GameFilterSheet';
import { gameService } from '@/services/gameService';
import {
  isVisibleInMyGames,
  isVisibleInOpenGames,
} from '@/services/gameLifecycle';
import { storage } from '@/services/storage';
import { Game } from '@/types';
import { spacing, RTL_LABEL_ALIGN } from '@/theme';
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

  const scrollRef = useRef<ScrollView>(null);
  useScrollToTop(scrollRef);

  // Default to "open" so a freshly-opened app shows discovery first —
  // the spec marks פתוחים as the active tab.
  const [tab, setTab] = useState<Tab>('open');
  const [myGames, setMyGames] = useState<Game[]>([]);
  const [communityGames, setCommunityGames] = useState<Game[]>([]);
  const [openGames, setOpenGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyGameId, setBusyGameId] = useState<string | null>(null);
  // Soft-confirm for cancellations past the cancel-deadline window.
  // Holds the target game so onConfirm knows what to cancel.
  const [lateCancelGame, setLateCancelGame] = useState<Game | null>(null);

  const [filters, setFilters] = useState<GameFilters>(EMPTY_GAME_FILTERS);
  const [filterOpen, setFilterOpen] = useState(false);

  // First-run hint pointing at the FAB. Surfaces once per device,
  // dismissible, never blocks taps on the FAB itself.
  const [hintVisible, setHintVisible] = useState(false);
  useEffect(() => {
    storage.getHintCreateGameSeen().then((seen) => {
      if (!seen) setHintVisible(true);
    });
  }, []);
  const dismissHint = () => {
    setHintVisible(false);
    storage.setHintCreateGameSeen();
  };

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

  // Returns true if "now" is inside the cancel-deadline danger
  // window (e.g. < 12h before kickoff with a 12h deadline). The
  // service no longer hard-blocks late cancels; we ask once.
  const isPastCancelDeadline = (g: Game): boolean => {
    if (!g.cancelDeadlineHours || g.cancelDeadlineHours <= 0) return false;
    if (typeof g.startsAt !== 'number') return false;
    return Date.now() > g.startsAt - g.cancelDeadlineHours * 60 * 60 * 1000;
  };

  const runCancel = async (game: Game) => {
    if (!user) return;
    setBusyGameId(game.id);
    try {
      await gameService.cancelGameV2(game.id, user.id);
      await reload();
    } catch (err) {
      if (__DEV__) console.warn('[gamesList] late-cancel failed', err);
      toast.error(he.error);
    } finally {
      setBusyGameId(null);
    }
  };

  const handleCardPrimary = async (game: Game, cta: MatchCardCta) => {
    if (!user || cta === 'none' || cta === 'pending') return;
    // Soft-confirm late cancellations. Only the cancel CTA goes
    // through the modal — `leaveWaitlist` is harmless, no prompt.
    if (cta === 'cancel' && isPastCancelDeadline(game)) {
      setLateCancelGame(game);
      return;
    }
    setBusyGameId(game.id);
    try {
      if (cta === 'join' || cta === 'waitlist') {
        await gameService.joinGameV2(game.id, user.id);
      } else if (cta === 'cancel' || cta === 'leaveWaitlist') {
        await gameService.cancelGameV2(game.id, user.id);
      }
      await reload();
    } catch (err) {
      const code =
        typeof (err as { code?: unknown })?.code === 'string'
          ? ((err as { code: string }).code)
          : '';
      if (code === 'REGISTRATION_CONFLICT') {
        // The user is already registered to another game in the
        // conflict window. We surface a heads-up toast — it's a
        // warning ("you might want to know"), not an error — and
        // stay on this screen. Navigating into MatchDetails was
        // surprising; the user just tapped "Join" on a card and
        // didn't ask to leave the list.
        toast.info(he.registrationConflictTitle);
      } else if (__DEV__) {
        console.warn('[gamesList] action failed', err);
      }
    } finally {
      setBusyGameId(null);
    }
  };

  const sortByStart = (a: Game, b: Game) => a.startsAt - b.startsAt;

  const visible = useMemo(() => {
    let base: Game[];
    if (tab === 'mine') {
      base = myGames.filter(isVisibleInMyGames);
    } else {
      const set = new Map<string, Game>();
      [...communityGames, ...openGames]
        .filter(isVisibleInOpenGames)
        .forEach((g) => set.set(g.id, g));
      base = Array.from(set.values());
    }
    return applyGameFilters(base, filters).sort(sortByStart);
  }, [tab, myGames, communityGames, openGames, filters]);

  const filterCount = activeFiltersCount(filters);
  const isEmpty = visible.length === 0;

  // Counts shown on the segmented tabs — same numbers used to drive
  // the "switch to other tab" CTA on the empty state.
  const mineCount = myGames.filter(isVisibleInMyGames).length;
  const openCount = useMemo(() => {
    const set = new Set<string>();
    [...communityGames, ...openGames]
      .filter(isVisibleInOpenGames)
      .forEach((g) => set.add(g.id));
    return set.size;
  }, [communityGames, openGames]);

  return (
    <View style={styles.root}>
      {/* Hero pinned at the top of the screen. The controls row
          below it is ALSO pinned (outside the scroll) but uses a
          negative marginTop to float over the hero's bottom edge —
          z-order: controls on top of hero. Same visual as before
          the pinning change, just with the hero no longer scrolling. */}
      <MatchesHero />
      <View style={styles.controlsFloat}>
        <View style={{ flex: 1 }}>
          <MatchSegmentControl
            value={tab}
            onChange={setTab}
            options={[
              {
                value: 'open',
                label: he.matchesTabOpen,
                badge: openCount,
              },
              {
                value: 'mine',
                label: he.matchesTabMine,
                badge: mineCount,
              },
            ]}
          />
        </View>
        <Pressable
          onPress={() => setFilterOpen(true)}
          style={({ pressed }) => [
            styles.filterBtn,
            filterCount > 0 && styles.filterBtnActive,
            pressed && { opacity: 0.85 },
          ]}
          accessibilityRole="button"
          accessibilityLabel={he.gameFiltersButton}
        >
          <Ionicons
            name="options"
            size={20}
            color={filterCount > 0 ? '#FFFFFF' : '#1E40AF'}
          />
          {filterCount > 0 ? (
            <View style={styles.filterBadge}>
              <Text style={styles.filterBadgeText}>{filterCount}</Text>
            </View>
          ) : null}
        </Pressable>
      </View>
      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={reload}
            tintColor="#3B82F6"
            colors={['#3B82F6']}
          />
        }
      >

        <View style={styles.body}>
          <View style={styles.sectionTitleRow}>
            <Text style={styles.sectionTitle}>
              {tab === 'open'
                ? he.matchesSectionOpen
                : he.matchesSectionMine}
            </Text>
            <View style={styles.sectionUnderline} />
          </View>

          {loading && visible.length === 0 ? (
            <View style={styles.loadingWrap}>
              <SoccerBallLoader size={40} />
            </View>
          ) : isEmpty ? (
            <FullEmptyState
              tab={tab}
              hasGamesInOtherTab={
                tab === 'mine' ? openCount > 0 : mineCount > 0
              }
              onCreate={handleCreate}
              onSwitchToOpen={() => setTab('open')}
            />
          ) : (
            <View style={styles.cardsList}>
              {visible.map((g) => (
                <MatchListCard
                  key={g.id}
                  game={g}
                  userId={user?.id ?? ''}
                  busy={busyGameId === g.id}
                  onPrimary={(cta) => handleCardPrimary(g, cta)}
                />
              ))}
              {/* Inviting CTA card after the list — only shown when
                  there are visible cards already. The full empty
                  state above replaces the list entirely. */}
              <MatchEmptyHintCard onPress={handleCreate} />
            </View>
          )}
        </View>
      </ScrollView>

      {/* Floating "+" FAB — pinned to the bottom-LEFT under forceRTL.
          `end: spacing.xl` is the trailing edge under RTL, which is
          the visual LEFT (per spec). */}
      <Pressable
        onPress={() => {
          if (hintVisible) dismissHint();
          handleCreate();
        }}
        style={({ pressed }) => [
          styles.fab,
          pressed && { transform: [{ scale: 0.95 }] },
        ]}
        accessibilityLabel="create-match"
      >
        <Ionicons name="add" size={30} color="#FFFFFF" />
      </Pressable>

      {hintVisible ? (
        <Pressable style={styles.hintBubble} onPress={dismissHint}>
          <Text style={styles.hintText}>{he.hintCreateGame}</Text>
          <View style={styles.hintArrow} />
        </Pressable>
      ) : null}

      <GameFilterSheet
        visible={filterOpen}
        filters={filters}
        onChange={setFilters}
        onClose={() => setFilterOpen(false)}
      />

      <ConfirmDestructiveModal
        visible={!!lateCancelGame}
        title={he.lateCancelTitle}
        body={he.lateCancelBody(lateCancelGame?.cancelDeadlineHours ?? 0)}
        confirmLabel={he.lateCancelConfirm}
        onClose={() => setLateCancelGame(null)}
        onConfirm={async () => {
          const target = lateCancelGame;
          setLateCancelGame(null);
          if (target) await runCancel(target);
        }}
      />
    </View>
  );
}

// ─── Empty state (no cards in the active tab) ───────────────────────────

function FullEmptyState({
  tab,
  hasGamesInOtherTab,
  onCreate,
  onSwitchToOpen,
}: {
  tab: Tab;
  hasGamesInOtherTab: boolean;
  onCreate: () => void;
  onSwitchToOpen: () => void;
}) {
  return (
    <View style={emptyStyles.wrap}>
      <View style={emptyStyles.icon}>
        <Ionicons name="football-outline" size={56} color="#3B82F6" />
      </View>
      <Text style={emptyStyles.body}>
        {hasGamesInOtherTab
          ? he.emptyHomeBody
          : he.emptyHomeNoGamesAnywhere}
      </Text>
      <View style={emptyStyles.actions}>
        <Button
          title={he.emptyHomePrimary}
          variant="primary"
          size="lg"
          iconLeft="add-circle-outline"
          onPress={onCreate}
          fullWidth
        />
        {hasGamesInOtherTab && tab === 'mine' ? (
          <Button
            title={he.emptyHomeSecondary}
            variant="outline"
            size="lg"
            iconLeft="search-outline"
            onPress={onSwitchToOpen}
            fullWidth
          />
        ) : null}
      </View>
    </View>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F8FAFC' },
  scroll: {
    paddingBottom: 120,
  },
  // Pinned controls row that floats OVER the bottom edge of the
  // hero. Negative marginTop pulls it up so the row sits on the
  // hero's gradient instead of starting below it. zIndex/elevation
  // raised so it visually layers on top of the hero across both
  // platforms.
  controlsFloat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    marginTop: -spacing.xxl,
    zIndex: 2,
    elevation: 2,
  },
  filterBtn: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.10,
    shadowRadius: 14,
    elevation: 4,
  },
  filterBtnActive: {
    backgroundColor: '#1E40AF',
  },
  filterBadge: {
    position: 'absolute',
    top: -4,
    end: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: '#EF4444',
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
  },
  body: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    gap: spacing.lg,
  },
  // Section title row + blue underline indicator. `alignItems:
  // 'flex-start'` resolves to the visual RIGHT under forceRTL — the
  // same trick used on the Communities screen.
  sectionTitleRow: {
    paddingHorizontal: spacing.xs,
    alignItems: 'flex-start',
    gap: 4,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0F172A',
    textAlign: RTL_LABEL_ALIGN,
  },
  sectionUnderline: {
    width: 36,
    height: 3,
    borderRadius: 2,
    backgroundColor: '#3B82F6',
  },
  cardsList: {
    gap: spacing.md,
  },
  loadingWrap: {
    paddingVertical: spacing.xxl,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Floating action button — bottom LEFT under forceRTL.
  fab: {
    position: 'absolute',
    bottom: spacing.xxl,
    end: spacing.xl,
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#3B82F6',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#1E40AF',
    shadowOpacity: 0.32,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },

  // First-run hint bubble pointing at the FAB.
  hintBubble: {
    position: 'absolute',
    bottom: spacing.xxl + 60 + 12,
    end: spacing.xl,
    backgroundColor: '#0F172A',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 14,
    maxWidth: 220,
  },
  hintText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
    textAlign: RTL_LABEL_ALIGN,
  },
  hintArrow: {
    position: 'absolute',
    bottom: -6,
    end: 24,
    width: 12,
    height: 12,
    backgroundColor: '#0F172A',
    transform: [{ rotate: '45deg' }],
  },
});

const emptyStyles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    paddingVertical: spacing.xxxl,
    paddingHorizontal: spacing.xl,
    gap: spacing.md,
  },
  icon: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: 'rgba(59,130,246,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    fontSize: 14,
    color: '#64748B',
    textAlign: 'center',
    maxWidth: 280,
  },
  actions: {
    alignSelf: 'stretch',
    marginTop: spacing.lg,
    gap: spacing.sm,
  },
});
