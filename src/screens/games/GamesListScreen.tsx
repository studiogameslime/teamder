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
  Alert,
  Modal,
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
import { MatchCardSkeleton } from '@/components/anim/MatchCardSkeleton';
import { AppearItem } from '@/components/anim/AppearItem';
import { Breathing } from '@/components/anim/Breathing';
import { joinLocation } from '@/utils/format';
import { BouncingBall } from '@/components/anim/BouncingBall';
import { toast } from '@/components/Toast';
import { ConfirmDestructiveModal } from '@/components/ConfirmDestructiveModal';
import {
  MatchListCard,
  type MatchCardCta,
} from '@/components/match/MatchListCard';
import { MatchesHero } from '@/components/match/MatchesHero';
import { MatchEmptyHintCard } from '@/components/match/MatchEmptyHintCard';
import {
  GameFilterSheet,
  EMPTY_GAME_FILTERS,
  applyGameFilters,
  activeFiltersCount,
  type GameFilters,
} from '@/components/GameFilterSheet';
import { gameService } from '@/services/gameService';
import { logError, logUnexpected } from '@/services/errorLog';
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';
import { rcBool, useRemoteConfig } from '@/services/remoteConfigService';
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
  useRemoteConfig(); // re-render when feature flags activate
  const nav = useNavigation<Nav>();
  const user = useUserStore((s) => s.currentUser);
  const myCommunities = useGroupStore((s) => s.groups);
  const hydratePlayers = useGameStore((s) => s.hydratePlayers);

  const scrollRef = useRef<ScrollView>(null);
  // React 19's useRef returns RefObject<T|null>; useScrollToTop's older
  // type signature expects non-null. Safe to cast — the hook itself
  // null-checks before calling .scrollTo(). Drops when React Navigation
  // updates its types for React 19.
  useScrollToTop(scrollRef as React.RefObject<ScrollView>);

  const [myGames, setMyGames] = useState<Game[]>([]);
  const [communityGames, setCommunityGames] = useState<Game[]>([]);
  const [openGames, setOpenGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);
  // Tracks pull-to-refresh ONLY. The native RefreshControl spinner
  // and our SoccerBallLoader used to share `loading`, which made
  // both show simultaneously on initial load (the screenshot bug).
  // Splitting the two states keeps them mutually exclusive: native
  // spinner only when the user pulls down, custom loader only on
  // first load / re-load with empty list.
  const [refreshing, setRefreshing] = useState(false);
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

  const reload = useCallback(
    async (opts: { pullToRefresh?: boolean } = {}) => {
      if (!user) return;
      if (opts.pullToRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
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
        return { mine: a, community: b, open: c };
      } catch (err) {
        logError('reloadGamesList', err, {
          screen: 'GamesListScreen',
          userId: user.id,
          pullToRefresh: !!opts.pullToRefresh,
        });
        if (__DEV__) console.warn('[gamesList] reload failed', err);
        return undefined;
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [user, myCommunities, hydratePlayers],
  );

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );
  useEffect(() => {
    reload();
  }, [reload]);

  // The "+" offers a quick (no-community) game as the primary path, with
  // the community game as the secondary choice. Quick is the headline:
  // create + play without setting up a community.
  //
  // We used to open Alert.alert here, but that surfaced as a native
  // OS dialog with three flat buttons — felt like an error / off-
  // brand. The replacement is a centred modal with two big tappable
  // cards that double as the choice + the explanation, matching the
  // visual language of the onboarding cards.
  const [createSheetVisible, setCreateSheetVisible] = useState(false);
  const handleCreate = () => setCreateSheetVisible(true);

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
      const fresh = await reload();
      // Silent-failure guard: a successful join MUST leave the game visible
      // somewhere the user can reach it (it moves into "שלי"). If it's in no
      // list at all, it silently vanished — the exact orphan/personal-group
      // case — so record it with full context even though nothing threw.
      if ((cta === 'join' || cta === 'waitlist') && fresh) {
        const visible =
          fresh.mine.some((g) => g.id === game.id) ||
          fresh.community.some((g) => g.id === game.id) ||
          fresh.open.some((g) => g.id === game.id);
        if (!visible) {
          logUnexpected('gameVanishedAfterJoin', {
            screen: 'GamesListScreen',
            gameId: game.id,
            isOrphanContext: game.isOrphanContext ?? false,
            visibility: game.visibility,
            status: game.status,
            groupId: game.groupId,
            userId: user.id,
            cta,
          });
        }
      }
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
      } else {
        // Non-conflict failure. The underlying service (joinGameV2 /
        // cancelGameV2) self-logs the op, but capture the SCREEN
        // context (which card + cta) so the admin panel ties the
        // failure to this list interaction.
        logError('gamesListAction', err, {
          screen: 'GamesListScreen',
          cta,
          gameId: game.id,
          userId: user.id,
        });
        if (__DEV__) console.warn('[gamesList] action failed', err);
      }
    } finally {
      setBusyGameId(null);
    }
  };

  const sortByStart = (a: Game, b: Game) => a.startsAt - b.startsAt;

  // Single sectioned list (like Communities): the games I'm registered to on
  // top, everything else below — no tabs.
  const mineList = useMemo(
    () => applyGameFilters(myGames.filter(isVisibleInMyGames), filters).sort(sortByStart),
    [myGames, filters],
  );
  const restList = useMemo(() => {
    const mineIds = new Set(mineList.map((g) => g.id));
    const set = new Map<string, Game>();
    [...communityGames, ...openGames]
      .filter(isVisibleInOpenGames)
      .forEach((g) => {
        if (!mineIds.has(g.id)) set.set(g.id, g);
      });
    return applyGameFilters(Array.from(set.values()), filters).sort(sortByStart);
  }, [communityGames, openGames, filters, mineList]);

  const filterCount = activeFiltersCount(filters);
  const isEmpty = mineList.length === 0 && restList.length === 0;

  return (
    <View style={styles.root}>
      {/* Hero pinned at the top of the screen. The controls row
          below it is ALSO pinned (outside the scroll) but uses a
          negative marginTop to float over the hero's bottom edge —
          z-order: controls on top of hero. Same visual as before
          the pinning change, just with the hero no longer scrolling. */}
      <MatchesHero />
      <View style={styles.controlsFloat}>
        {/* Tabs removed — the list is one sectioned scroll now. Spacer keeps
            the filter button on the trailing edge. */}
        <View style={{ flex: 1 }} />
        {/* Map view — hidden for this release (feature not shipped yet). */}
        {false && (
        <Pressable
          onPress={() => {
            const now = new Date();
            const sameDay = (a: Date, b: Date) =>
              a.getFullYear() === b.getFullYear() &&
              a.getMonth() === b.getMonth() &&
              a.getDate() === b.getDate();
            const tomorrow = new Date(now);
            tomorrow.setDate(now.getDate() + 1);
            const BUCKET = {
              today: '#2563EB',
              tomorrow: '#16A34A',
              weekend: '#EA580C',
              other: '#6B7280',
            } as const;
            const items = openGames
              .filter(
                (g) =>
                  typeof g.fieldLat === 'number' &&
                  typeof g.fieldLng === 'number',
              )
              .map((g) => {
                const d = new Date(g.startsAt);
                const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(
                  d.getMinutes(),
                ).padStart(2, '0')}`;
                const diffDays = (d.getTime() - now.getTime()) / 86_400_000;
                const dow = d.getDay();
                let bucket: 'today' | 'tomorrow' | 'weekend' | 'other' =
                  'other';
                let dayLabel = `${d.getDate()}.${d.getMonth() + 1}`;
                if (sameDay(d, now)) {
                  bucket = 'today';
                  dayLabel = he.mapLegendToday;
                } else if (sameDay(d, tomorrow)) {
                  bucket = 'tomorrow';
                  dayLabel = he.mapLegendTomorrow;
                } else if (
                  (dow === 5 || dow === 6) &&
                  diffDays >= 0 &&
                  diffDays <= 7
                ) {
                  bucket = 'weekend';
                }
                return {
                  id: g.id,
                  lat: g.fieldLat as number,
                  lng: g.fieldLng as number,
                  color: BUCKET[bucket],
                  dateBucket: bucket,
                  timeLabel: `${dayLabel} · ${hhmm}`,
                  title: g.title,
                  subtitle: joinLocation(g.fieldName, g.city),
                  badge: g.format
                    ? g.format.replace('v', '×')
                    : `${g.players.length}/${g.maxPlayers}`,
                  open: g.players.length < g.maxPlayers,
                };
              });
            nav.navigate('GamesMap', { mode: 'games', items });
          }}
          style={({ pressed }) => [
            styles.filterBtn,
            pressed && { opacity: 0.85 },
          ]}
          accessibilityRole="button"
          accessibilityLabel={he.mapButtonLabel}
        >
          <Ionicons name="map-outline" size={20} color="#1E40AF" />
        </Pressable>
        )}
        <Pressable
          onPress={() => {
            logEvent(AnalyticsEvent.GameFilterSheetOpened);
            setFilterOpen(true);
          }}
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
            refreshing={refreshing}
            onRefresh={() => reload({ pullToRefresh: true })}
            tintColor="#3B82F6"
            colors={['#3B82F6']}
          />
        }
      >

        <View style={styles.body}>
          {loading && isEmpty ? (
            // Skeleton placeholder cards — shape-accurate so the
            // layout doesn't shove when the real cards land.
            <MatchCardSkeleton count={3} />
          ) : isEmpty ? (
            <FullEmptyState
              tab="open"
              hasGamesInOtherTab={false}
              hasActiveFilters={filterCount > 0}
              onCreate={handleCreate}
              onSwitchToOpen={handleCreate}
              onClearFilters={() => setFilters(EMPTY_GAME_FILTERS)}
            />
          ) : (
            <>
              {/* Section 1 — games I'm registered to (top). */}
              {mineList.length > 0 ? (
                <>
                  <View style={styles.sectionTitleRow}>
                    <Text style={styles.sectionTitle}>{he.matchesSectionMine}</Text>
                    <View style={styles.sectionUnderline} />
                  </View>
                  <View style={styles.cardsList}>
                    {mineList.map((g, idx) => (
                      <AppearItem key={g.id} index={idx}>
                        <MatchListCard
                          game={g}
                          userId={user?.id ?? ''}
                          busy={busyGameId === g.id}
                          onPrimary={(cta) => handleCardPrimary(g, cta)}
                        />
                      </AppearItem>
                    ))}
                  </View>
                </>
              ) : null}

              {/* Section 2 — everything else (below). */}
              {restList.length > 0 ? (
                <>
                  <View style={[styles.sectionTitleRow, mineList.length > 0 && { marginTop: spacing.lg }]}>
                    <Text style={styles.sectionTitle}>{he.matchesSectionOpen}</Text>
                    <View style={styles.sectionUnderline} />
                  </View>
                  <View style={styles.cardsList}>
                    {restList.map((g, idx) => (
                      <AppearItem key={g.id} index={idx}>
                        <MatchListCard
                          game={g}
                          userId={user?.id ?? ''}
                          busy={busyGameId === g.id}
                          onPrimary={(cta) => handleCardPrimary(g, cta)}
                        />
                      </AppearItem>
                    ))}
                    <MatchEmptyHintCard onPress={handleCreate} />
                  </View>
                </>
              ) : null}
            </>
          )}
        </View>
      </ScrollView>

      {/* Floating "+" FAB — pinned to the bottom-LEFT under forceRTL.
          `end: spacing.xl` is the trailing edge under RTL, which is
          the visual LEFT (per spec). */}
      <Breathing mode="pulse" amount={0.05} periodMs={2400} style={styles.fab}>
        <Pressable
          onPress={() => {
            if (hintVisible) dismissHint();
            handleCreate();
          }}
          style={({ pressed }) => [
            styles.fabInner,
            pressed && { transform: [{ scale: 0.95 }] },
          ]}
          accessibilityRole="button"
          accessibilityLabel={he.matchesCreateFab}
        >
          <Ionicons name="add" size={30} color="#FFFFFF" />
        </Pressable>
      </Breathing>

      {hintVisible ? (
        <Pressable style={styles.hintBubble} onPress={dismissHint}>
          <Text style={styles.hintText}>{he.hintCreateGame}</Text>
          <View style={styles.hintArrow} />
        </Pressable>
      ) : null}

      <GameFilterSheet
        visible={filterOpen}
        filters={filters}
        matchCount={mineList.length + restList.length}
        onChange={(next) => {
          // Compare before/after counts so we can differentiate
          // applying a filter from clearing one.
          const before = activeFiltersCount(filters);
          const after = activeFiltersCount(next);
          if (after > before) {
            logEvent(AnalyticsEvent.GameFilterApplied, { count: after });
          } else if (after === 0 && before > 0) {
            logEvent(AnalyticsEvent.GameFilterCleared);
          }
          setFilters(next);
        }}
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

      {/* Custom create-game chooser. Replaces the native Alert with
          two big tappable cards — each describes its mode so the user
          picks confidently without dismissing the chooser to read the
          wizard. Same z-stack & dismiss semantics as a Modal. */}
      <Modal
        visible={createSheetVisible}
        animationType="fade"
        transparent
        onRequestClose={() => setCreateSheetVisible(false)}
      >
        <Pressable
          style={createSheetStyles.backdrop}
          onPress={() => setCreateSheetVisible(false)}
        >
          <Pressable style={createSheetStyles.card} onPress={() => undefined}>
            <Text style={createSheetStyles.title}>
              {he.createGameChooseTitle}
            </Text>
            {rcBool('feature_quick_games') ? (
              <Pressable
                style={({ pressed }) => [
                  createSheetStyles.choice,
                  pressed && { opacity: 0.92, transform: [{ scale: 0.99 }] },
                ]}
                onPress={() => {
                  setCreateSheetVisible(false);
                  nav.navigate('GameCreate', { quick: true });
                }}
              >
                <View style={createSheetStyles.choiceIcon}>
                  <Ionicons name="flash" size={22} color="#1E40AF" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={createSheetStyles.choiceTitle}>
                    {he.createGameChooseQuickTitle}
                  </Text>
                  <Text style={createSheetStyles.choiceBody}>
                    {he.createGameChooseQuickBody}
                  </Text>
                </View>
              </Pressable>
            ) : null}
            <Pressable
              style={({ pressed }) => [
                createSheetStyles.choice,
                pressed && { opacity: 0.92, transform: [{ scale: 0.99 }] },
              ]}
              onPress={() => {
                setCreateSheetVisible(false);
                nav.navigate('GameCreate');
              }}
            >
              <View style={createSheetStyles.choiceIcon}>
                <Ionicons name="people" size={22} color="#1E40AF" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={createSheetStyles.choiceTitle}>
                  {he.createGameChooseCommunityTitle}
                </Text>
                <Text style={createSheetStyles.choiceBody}>
                  {he.createGameChooseCommunityBody}
                </Text>
              </View>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                createSheetStyles.cancelBtn,
                pressed && { opacity: 0.7 },
              ]}
              onPress={() => setCreateSheetVisible(false)}
            >
              <Text style={createSheetStyles.cancelText}>{he.cancel}</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const createSheetStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.55)',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: spacing.lg,
    gap: spacing.md,
  },
  title: {
    fontSize: 19,
    fontWeight: '800',
    color: '#0F172A',
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
  },
  choiceIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(59,130,246,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  choiceTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
    textAlign: RTL_LABEL_ALIGN,
    marginBottom: 2,
  },
  choiceBody: {
    fontSize: 13,
    color: '#64748B',
    lineHeight: 18,
    textAlign: RTL_LABEL_ALIGN,
  },
  cancelBtn: {
    alignSelf: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  cancelText: {
    color: '#64748B',
    fontSize: 14,
    fontWeight: '700',
  },
});

// ─── Empty state (no cards in the active tab) ───────────────────────────

function FullEmptyState({
  tab,
  hasGamesInOtherTab,
  hasActiveFilters,
  onCreate,
  onSwitchToOpen,
  onClearFilters,
}: {
  tab: Tab;
  hasGamesInOtherTab: boolean;
  /** True when a filter is hiding games that actually exist. */
  hasActiveFilters?: boolean;
  onCreate: () => void;
  onSwitchToOpen: () => void;
  onClearFilters?: () => void;
}) {
  return (
    <View style={emptyStyles.wrap}>
      <View style={emptyStyles.icon}>
        {/* Bouncing ball reads as "the app is alive, just nothing
            here yet" — much better than a static football icon. */}
        <BouncingBall size={64} color="#3B82F6" />
      </View>
      <Text style={emptyStyles.body}>
        {hasActiveFilters
          ? he.emptyHomeFilteredBody
          : hasGamesInOtherTab
            ? he.emptyHomeBody
            : he.emptyHomeNoGamesAnywhere}
      </Text>
      <View style={emptyStyles.actions}>
        {hasActiveFilters ? (
          // Filter is the cause — offer to clear it, not "create a game".
          <Button
            title={he.emptyHomeClearFilters}
            variant="primary"
            size="lg"
            iconLeft="close-circle-outline"
            onPress={onClearFilters}
            fullWidth
          />
        ) : (
          <>
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
          </>
        )}
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
    // Push the loader well down the screen so it lands roughly in
    // the visible empty area (below the hero + tabs + section title).
    // Full vertical centering is hard inside a ScrollView with a
    // sticky header above; this fixed offset gets us "looks
    // centered" on phones in the 6"–6.5" range.
    minHeight: 360,
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
    shadowColor: '#1E40AF',
    shadowOpacity: 0.32,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  fabInner: {
    width: '100%',
    height: '100%',
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
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
