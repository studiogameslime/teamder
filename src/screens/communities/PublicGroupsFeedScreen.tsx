// Communities tab — premium card-based feed.
//
// Layout (top → bottom, RTL):
//   ① Blue gradient hero ("מועדונים" + subtitle + people-icon disc)
//   ② Search + filter row, floating onto the bottom of the hero
//   ③ Section "המועדונים שלי"   — admin/member cards (admin floats up)
//   ④ Section "ממתינים לאישור" — only when there are pending requests
//   ⑤ Section "מועדונים פתוחים" — discovery (filtered)
//   ⑥ Floating "+" action button on the bottom-left
//
// Logic + data flow are unchanged from the previous version — only the
// visual shell, the row component, and the FAB position are new.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SoccerBallLoader } from '@/components/SoccerBallLoader';
import { RequestsBell } from '@/components/RequestsBell';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useScrollToTop } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { Button } from '@/components/Button';
import { BouncingBall } from '@/components/anim/BouncingBall';
import { LivingIcon } from '@/components/anim/LivingIcon';
import { AppearItem } from '@/components/anim/AppearItem';
import { Breathing } from '@/components/anim/Breathing';
import { toast } from '@/components/Toast';
import {
  CommunityFilterSheet,
  EMPTY_GROUP_FILTERS,
  applyGroupFilters,
  activeGroupFiltersCount,
  type GroupFilters,
} from '@/components/CommunityFilterSheet';
import { CommunitiesHero } from '@/components/community/CommunitiesHero';
import {
  CommunityCard,
  type CommunityCardStatus,
} from '@/components/community/CommunityCard';
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';
import { groupService } from '@/services';
import { GroupJoinRejectedError } from '@/services/groupService';
import { ensureNotGuest } from '@/utils/guestGate';
import { logError, logUnexpected } from '@/services/errorLog';
import { gameService } from '@/services/gameService';
import { GroupPublic } from '@/types';
import { colors, spacing, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import { useUserStore } from '@/store/userStore';
import { useGroupStore } from '@/store/groupStore';
import { resolveNearbyLocation, promptLocationDenied } from '@/utils/nearby';
import type { CommunitiesStackParamList } from '@/navigation/CommunitiesStack';
import type { MapItem } from '@/screens/map/MapScreen';

type Nav = NativeStackNavigationProp<CommunitiesStackParamList, 'CommunitiesFeed'>;

// The discovery feed is windowed: show the top-N most-active communities and
// reveal the long tail of tiny/single-member ones only on demand, so they don't
// clutter the top as "junk". (Fetch is still one cheap query — this is a render
// window, not server pagination; revisit if the collection grows to hundreds.)
const DISCOVERY_PAGE = 8;

export function PublicGroupsFeedScreen() {
  const nav = useNavigation<Nav>();
  const user = useUserStore((s) => s.currentUser);
  const memberGroups = useGroupStore((s) => s.groups);
  const pendingGroups = useGroupStore((s) => s.pendingGroups);
  const requestJoinById = useGroupStore((s) => s.requestJoinById);
  const setCurrentGroup = useGroupStore((s) => s.setCurrentGroup);

  const scrollRef = useRef<ScrollView>(null);
  useScrollToTop(scrollRef as React.RefObject<ScrollView>);

  const [text, setText] = useState('');
  const [items, setItems] = useState<GroupPublic[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  // How many discovery cards are currently revealed (see DISCOVERY_PAGE).
  const [discoveryLimit, setDiscoveryLimit] = useState(DISCOVERY_PAGE);

  const [filters, setFilters] = useState<GroupFilters>(EMPTY_GROUP_FILTERS);
  const [filterOpen, setFilterOpen] = useState(false);
  // `nearbyLoc` carries BOTH a lat/lng (preferred — used for radius)
  // and a city fallback (used for legacy un-geocoded groups). When
  // `nearby` is off we hold null so re-toggling triggers a fresh
  // permission request.
  const [nearbyLoc, setNearbyLoc] = useState<{
    latLng: { lat: number; lng: number } | null;
    city: string | null;
  } | null>(null);
  const [nearbyLoading, setNearbyLoading] = useState(false);

  useEffect(() => {
    if (!filters.nearby) {
      setNearbyLoc(null);
      return;
    }
    let alive = true;
    (async () => {
      setNearbyLoading(true);
      const loc = await resolveNearbyLocation(
        user?.availability?.preferredCity,
      );
      if (!alive) return;
      // Require location permission for "near me" — prompt + turn it off
      // instead of leaving the feed silently empty.
      if (!loc.granted) {
        // Close the filter sheet first — the styled alert is a Modal and
        // can't render over the (also-Modal) sheet on Android.
        setFilterOpen(false);
        setNearbyLoc(null);
        setNearbyLoading(false);
        setFilters((f) => ({ ...f, nearby: false }));
        promptLocationDenied(loc.canAskAgain);
        return;
      }
      setNearbyLoc(loc);
      setNearbyLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [filters.nearby, user?.availability?.preferredCity]);

  const filterCount = activeGroupFiltersCount(filters);

  // Collapse the discovery window back to the first page whenever the query
  // that produces it changes (new search text, filters, or a manual refresh),
  // so an old "expanded" state doesn't carry over to a different result set.
  useEffect(() => {
    setDiscoveryLimit(DISCOVERY_PAGE);
  }, [text, filters, nearbyLoc, refreshTick]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const list =
          text.trim().length === 0
            ? await groupService.listPublicGroups()
            : await groupService.searchPublicGroups(text);
        if (text.trim().length > 0) logEvent(AnalyticsEvent.GroupSearch, { query: text });
        if (alive) setItems(list);
      } catch (err) {
        logError('listPublicGroups', err, {
          screen: 'PublicGroupsFeedScreen',
          query: text.trim() || undefined,
        });
        if (alive) setItems([]);
      } finally {
        if (alive) setLoading(false);
      }
    }, 250);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [text, refreshTick]);

  const memberIds = useMemo(
    () => new Set(memberGroups.map((g) => g.id)),
    [memberGroups]
  );
  const pendingIds = useMemo(
    () => new Set(pendingGroups.map((g) => g.id)),
    [pendingGroups]
  );
  const adminIds = useMemo(() => {
    if (!user) return new Set<string>();
    return new Set(
      memberGroups
        .filter((g) => g.adminIds.includes(user.id))
        .map((g) => g.id)
    );
  }, [memberGroups, user]);

  function statusFor(g: GroupPublic): CommunityCardStatus {
    if (adminIds.has(g.id)) return 'admin';
    if (memberIds.has(g.id)) return 'member';
    if (pendingIds.has(g.id)) return 'pending';
    return 'none';
  }

  function passesDiscoveryFilters(g: GroupPublic): boolean {
    // While the nearby toggle is on, wait for permission + first GPS
    // fix before showing ANY group — otherwise we'd flicker the full
    // list for a frame then collapse to nearby, which reads as a bug.
    if (filters.nearby && (nearbyLoading || !nearbyLoc)) return false;
    if (filters.nearby && nearbyLoc &&
        !nearbyLoc.latLng && !nearbyLoc.city) {
      // Permission denied AND no profile fallback → can't possibly
      // resolve "nearby". The empty-state explains this to the user.
      return false;
    }
    return (
      applyGroupFilters([g], filters, {
        nearbyLatLng: nearbyLoc?.latLng ?? undefined,
        nearbyCityFallback: nearbyLoc?.city ?? undefined,
      }).length > 0
    );
  }

  // ── Section partitions ──
  // המועדונים שלי     — communities I'm a member or admin of (admin floats up)
  // ממתינים לאישור — communities with an outstanding join request
  // מועדונים פתוחים   — discovery, filtered
  const myItems = useMemo(
    () => {
      const list = (items ?? []).filter(
        (g) => memberIds.has(g.id) || adminIds.has(g.id),
      );
      return list.sort((a, b) => {
        const aRank = adminIds.has(a.id) ? 0 : 1;
        const bRank = adminIds.has(b.id) ? 0 : 1;
        return aRank - bRank;
      });
    },
    [items, memberIds, adminIds],
  );
  const pendingItems = useMemo(
    () =>
      (items ?? []).filter(
        (g) =>
          pendingIds.has(g.id) && !memberIds.has(g.id) && !adminIds.has(g.id),
      ),
    [items, memberIds, pendingIds, adminIds],
  );
  const discoveryItems = useMemo(
    () =>
      (items ?? []).filter(
        (g) =>
          // Skip incomplete public projections that have no name — these
          // are partial /groupsPublic docs (e.g. a hidden personal group
          // whose public doc was lazily created by the memberCount-sync
          // CF with no name/city). A nameless discovery card is broken.
          (g.name ?? '').trim().length > 0 &&
          !memberIds.has(g.id) &&
          !adminIds.has(g.id) &&
          !pendingIds.has(g.id) &&
          passesDiscoveryFilters(g)
      )
        // Biggest communities first — more players = more games happening,
        // so the discovery feed leads with the most active clubs. Tie-break
        // by name for a stable, predictable order.
        .sort(
          (a, b) =>
            (b.memberCount ?? 0) - (a.memberCount ?? 0) ||
            (a.name ?? '').localeCompare(b.name ?? '', 'he'),
        ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, memberIds, adminIds, pendingIds, filters, nearbyLoc, nearbyLoading]
  );

  const isSearching = text.trim().length > 0;
  const searchMatches = isSearching
    ? discoveryItems.concat(myItems).concat(pendingItems)
    : [];

  const handleRequest = async (item: GroupPublic) => {
    if (!ensureNotGuest(he.guestRegisterJoinCommunity)) return;
    if (!user) return;
    try {
      const status = await requestJoinById(item.id, user.id);
      // Silent-failure guard: requestJoinById updates the group store in
      // place (pending → adds to pendingGroups; joined → re-hydrates
      // memberGroups). Read the FRESHLY-SET store snapshot via getState()
      // — no new Firestore read — and assert the expected membership/
      // pending state materialised. The reactive store closures captured
      // at render time are stale at this point.
      if (status === 'pending' || status === 'joined') {
        const store = useGroupStore.getState();
        const reflected =
          store.groups.some((g) => g.id === item.id) ||
          store.pendingGroups.some((g) => g.id === item.id);
        if (!reflected) {
          logUnexpected('communityJoinNotReflected', {
            screen: 'PublicGroupsFeedScreen',
            groupId: item.id,
            userId: user.id,
            status,
          });
        }
      }
      if (status === 'pending') {
        logEvent(AnalyticsEvent.GroupJoinRequested, { groupId: item.id });
        toast.success(he.toastJoinRequestSent);
      } else if (status === 'joined') {
        toast.success(he.toastJoinedGroup);
        setRefreshTick((n) => n + 1);
      } else if (status === 'already_member') {
        toast.info(he.groupAlreadyMember);
      }
    } catch (err) {
      if (
        err instanceof GroupJoinRejectedError ||
        (err as Error)?.name === 'GroupJoinRejectedError'
      ) {
        toast.error(he.toastJoinRejected);
        return;
      }
      const code =
        typeof (err as { code?: unknown })?.code === 'string'
          ? ((err as { code: string }).code)
          : '';
      if (code === 'GROUP_FULL') {
        toast.error(he.toastGroupFull);
      } else {
        // Transient/recoverable (offline, timeout, stale App Check token) is
        // not a bug — the user retries. Only log a genuine failure.
        const transient = [
          'unavailable', 'deadline-exceeded', 'cancelled', 'unauthenticated',
          'firebase-app-check-token-is-invalid',
        ].includes(code);
        if (!transient) {
          logError('requestJoinGroup', err, {
            screen: 'PublicGroupsFeedScreen',
            groupId: item.id,
            userId: user.id,
          });
        }
        if (__DEV__) console.warn('[publicFeed] join request failed', err);
        toast.error(he.toastRequestFailed);
      }
    }
  };

  // Creating a community is an account action — guests are prompted to
  // register first.
  const handleCreate = () => {
    if (!ensureNotGuest(he.guestRegisterCreate)) return;
    nav.navigate('CommunitiesCreate');
  };

  const handleEnter = async (item: GroupPublic) => {
    await setCurrentGroup(item.id);
    nav.navigate('CommunityDetails', { groupId: item.id });
  };

  const handleOpenDetails = (item: GroupPublic) => {
    if (memberIds.has(item.id)) {
      nav.navigate('CommunityDetails', { groupId: item.id });
    } else {
      nav.navigate('CommunityDetailsPublic', { groupId: item.id });
    }
  };

  const renderCard = (g: GroupPublic, idx: number) => {
    const status = statusFor(g);
    // Build "city · field · address" but drop the standalone city when
    // the free-text address already mentions it (admins commonly write
    // "הרב קלישר, פתח תקווה" — listing the city twice on a community
    // card looks like a bug).
    const city = (g.city ?? '').trim();
    const fieldName = (g.fieldName ?? '').trim();
    const fieldAddress = (g.fieldAddress ?? '').trim();
    const cityInAddress =
      city.length > 0 && fieldAddress.toLowerCase().includes(city.toLowerCase());
    const locationLine = [
      cityInAddress ? '' : city,
      fieldName,
      fieldAddress,
    ]
      .filter((s) => s.length > 0)
      .join(' · ');
    // The denormalised public count can drift behind /groups.playerIds
    // (client-side direct-joins on open communities can't write to the
    // public doc — rules forbid). For groups the viewer is a member
    // of, prefer the canonical playerIds.length so the card matches
    // the count shown on the details screen.
    const localGroup = memberGroups.find((mg) => mg.id === g.id);
    const memberCount = localGroup?.playerIds?.length ?? g.memberCount;
    return (
      <AppearItem key={g.id} index={idx}>
        <CommunityCard
          name={localGroup?.name ?? g.name}
          locationLine={locationLine}
          description={g.description}
          coverPhotoUrl={g.coverPhotoUrl}
          coverImageId={g.coverImageId}
          memberCount={memberCount}
          status={status}
          onPress={() => {
            // Members enter the full community page; non-members
            // open the public preview where they can act on a join.
            if (status === 'admin' || status === 'member') {
              handleEnter(g);
            } else {
              handleOpenDetails(g);
            }
          }}
          onJoinPress={() => handleRequest(g)}
          // Closed / approval-gated communities (isOpen !== true) ask the
          // user to REQUEST to join rather than promising an instant join.
          // Open communities keep the default "הצטרף למועדון".
          joinLabel={g.isOpen ? he.communitiesCardJoin : he.communityRequestToJoin}
        />
      </AppearItem>
    );
  };

  // ── Render ──

  if (loading && items === null) {
    return (
      <View style={styles.root}>
        <CommunitiesHero />
        <SoccerBallLoader size={40} style={{ marginTop: spacing.xxl }} />
      </View>
    );
  }

  // Note: hero placement (outside the ScrollView, so it stays
  // pinned) lives in the main return block below.

  const totalKnown = (items ?? []).length;

  return (
    <View style={styles.root}>
      {/* Hero pinned at the top. The search/filter row below is
          ALSO pinned (outside the scroll) but uses a negative
          marginTop to float over the hero's bottom edge — z-order:
          row on top of the hero. */}
      <CommunitiesHero />
      <View style={styles.searchRow}>
        {/* White pill search bar. Inside the pill we want the
            placeholder/value on the visual RIGHT and the search
            icon on the visual LEFT — under RTL row, that means
            the TextInput is FIRST (right) and the icon LAST
            (left). */}
        <View style={styles.searchPill}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={he.communitiesCardSearchPlaceholder}
            placeholderTextColor="#94A3B8"
            returnKeyType="search"
            style={styles.searchInput}
          />
          {/* Clear button appears as soon as there's typed text — one
              tap empties the field instead of forcing the user to
              delete character-by-character. Visually replaces the
              search icon while a query is present. */}
          {text.length > 0 ? (
            <Pressable
              onPress={() => setText('')}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="נקה חיפוש"
            >
              <Ionicons name="close-circle" size={20} color="#94A3B8" />
            </Pressable>
          ) : (
            <Ionicons name="search" size={18} color="#94A3B8" />
          )}
        </View>
        {/* Map view — opens the communities map next to the filter. */}
        <Pressable
          onPress={async () => {
            // Mirror the feed on the map: my communities + the discovery
            // list, deduped. A community is shown blue if I'm a member,
            // white if not.
            type N = {
              id: string;
              name: string;
              city?: string;
              field?: string;
              lat?: number;
              lng?: number;
              member: boolean;
              count: number;
            };
            const seen = new Set<string>();
            const norm: N[] = [];
            const push = (
              g: { id: string; name: string; city?: string; fieldName?: string; lat?: number; lng?: number },
              member: boolean,
              count: number,
            ) => {
              if (seen.has(g.id)) return;
              seen.add(g.id);
              norm.push({
                id: g.id, name: g.name, city: g.city, field: g.fieldName,
                lat: g.lat, lng: g.lng, member, count,
              });
            };
            memberGroups.forEach((g) => push(g, true, g.playerIds?.length ?? 0));
            (items ?? []).forEach((g) => push(g, memberIds.has(g.id), g.memberCount));

            // Geocode the cities for any community that lacks coords (cached).
            const { geocodeCity } = await import('@/services/geocodeService');
            const cities = [
              ...new Set(
                norm
                  .filter((g) => !(typeof g.lat === 'number' && typeof g.lng === 'number'))
                  .map((g) => (g.city ?? '').trim())
                  .filter(Boolean),
              ),
            ];
            const coords = new Map<string, { lat: number; lng: number } | null>();
            await Promise.all(
              cities.map(async (c) => coords.set(c, await geocodeCity(c))),
            );
            const mapItems = norm.flatMap((g) => {
              let lat = g.lat;
              let lng = g.lng;
              if (!(typeof lat === 'number' && typeof lng === 'number')) {
                const c = coords.get((g.city ?? '').trim());
                if (c) {
                  lat = c.lat;
                  lng = c.lng;
                }
              }
              if (typeof lat !== 'number' || typeof lng !== 'number') return [];
              return [
                {
                  id: g.id,
                  kind: 'community' as const,
                  lat,
                  lng,
                  // Member = solid blue disc; non-member = white disc, blue ring.
                  fill: g.member ? '#2563EB' : '#FFFFFF',
                  color: g.member ? '#FFFFFF' : '#2563EB',
                  title: g.name,
                  subtitle: g.field ?? g.city ?? '',
                  badge: `${g.count} בסגל`,
                  open: true,
                },
              ];
            });

            // Overlay layer for the "הצג משחקים" toggle — open games
            // (geocoded by city/venue). Without this the toggle never
            // appeared. Best-effort: a fetch failure just omits the layer.
            let overlay: MapItem[] = [];
            try {
              const openGames = await gameService.getOpenGames(
                user?.id ?? '',
                memberGroups.map((mg) => mg.id),
              );
              const gKey = (x: { city?: string; fieldName?: string }) =>
                (x.city || x.fieldName || '').trim();
              const gCities = [
                ...new Set(
                  openGames
                    .filter(
                      (x) => !(typeof x.fieldLat === 'number' && typeof x.fieldLng === 'number'),
                    )
                    .map(gKey)
                    .filter(Boolean),
                ),
              ];
              const gCoords = new Map<string, { lat: number; lng: number } | null>();
              await Promise.all(
                gCities.map(async (c) => gCoords.set(c, await geocodeCity(c))),
              );
              overlay = openGames.flatMap((x) => {
                let glat = x.fieldLat;
                let glng = x.fieldLng;
                if (!(typeof glat === 'number' && typeof glng === 'number')) {
                  const co = gCoords.get(gKey(x));
                  if (co) {
                    glat = co.lat;
                    glng = co.lng;
                  }
                }
                if (typeof glat !== 'number' || typeof glng !== 'number') return [];
                return [
                  {
                    id: x.id,
                    kind: 'game' as const,
                    lat: glat,
                    lng: glng,
                    title: x.title,
                    subtitle: x.fieldName || x.city || '',
                    badge: x.format ? x.format.replace('v', '×') : undefined,
                    open: x.players.length < x.maxPlayers,
                  },
                ];
              });
            } catch (err) {
              logError('communitiesMapGamesOverlay', err, {
                screen: 'PublicGroupsFeedScreen',
              });
            }

            nav.navigate('CommunitiesMap', {
              mode: 'communities',
              items: mapItems,
              overlay,
            });
          }}
          style={({ pressed }) => [
            styles.filterButton,
            pressed && { opacity: 0.85 },
          ]}
          accessibilityRole="button"
          accessibilityLabel={he.mapButtonLabel}
        >
          <Ionicons name="map-outline" size={20} color="#1E40AF" />
        </Pressable>
        <Pressable
          onPress={() => setFilterOpen(true)}
          style={({ pressed }) => [
            styles.filterButton,
            filterCount > 0 && styles.filterButtonActive,
            pressed && { opacity: 0.85 },
          ]}
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
        <RequestsBell bg="#FFFFFF" style={styles.filterButton} />
      </View>
      {totalKnown === 0 && !isSearching ? (
        <View style={styles.emptyAll}>
          {/* Bouncing ball mascot — same energy as the football icon
              but reads as "the app is alive, just nothing here yet". */}
          <BouncingBall size={64} color="#3B82F6" />
          <Text style={styles.emptyAllTitle}>{he.communitiesEmptyAll}</Text>
          <Text style={styles.emptyAllSub}>{he.communitiesEmptyAllSub}</Text>
          <Button
            title={he.communitiesCreateFirst}
            variant="primary"
            size="lg"
            iconLeft="add-circle-outline"
            onPress={handleCreate}
            style={{ marginTop: spacing.lg, alignSelf: 'stretch' }}
            fullWidth
          />
        </View>
      ) : (
        <ScrollView
          ref={scrollRef}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl
              refreshing={loading}
              onRefresh={() => setRefreshTick((n) => n + 1)}
              tintColor="#3B82F6"
              colors={['#3B82F6']}
            />
          }
        >
          {isSearching ? (
            <View style={styles.body}>
              {searchMatches.length === 0 ? (
                <Text style={styles.empty}>{he.communitiesEmpty}</Text>
              ) : (
                <View style={styles.cardsList}>{searchMatches.map(renderCard)}</View>
              )}
            </View>
          ) : (
            <View style={styles.body}>
              <Section title={he.communitiesSectionMember}>
                {myItems.length === 0 ? (
                  <View style={styles.emptyHintCard}>
                    <View style={styles.emptyHintIcon}>
                      <Ionicons
                        name="people-outline"
                        size={26}
                        color={colors.primary}
                      />
                    </View>
                    <Text style={styles.emptyHintTitle}>
                      {he.communitiesEmptyMember}
                    </Text>
                    <Text style={styles.emptyHintBody}>
                      {he.communitiesEmptyMemberSub}
                    </Text>
                    <Button
                      title={he.communitiesCreateFirst}
                      variant="primary"
                      size="md"
                      iconLeft="add-circle-outline"
                      onPress={handleCreate}
                      style={{ marginTop: spacing.md, alignSelf: 'stretch' }}
                      fullWidth
                    />
                  </View>
                ) : (
                  <View style={styles.cardsList}>{myItems.map(renderCard)}</View>
                )}
              </Section>
              {pendingItems.length > 0 ? (
                <Section title={he.communitiesSectionPending}>
                  <View style={styles.cardsList}>
                    {pendingItems.map(renderCard)}
                  </View>
                </Section>
              ) : null}
              <Section title={he.communitiesSectionOpen}>
                {discoveryItems.length === 0 ? (
                  <Text style={styles.sectionEmpty}>
                    {he.communitiesEmptyOpenSection}
                  </Text>
                ) : (
                  <>
                    <View style={styles.cardsList}>
                      {discoveryItems.slice(0, discoveryLimit).map(renderCard)}
                    </View>
                    {discoveryItems.length > discoveryLimit ? (
                      <Button
                        title={he.communitiesShowMore(
                          discoveryItems.length - discoveryLimit,
                        )}
                        variant="outline"
                        size="md"
                        iconLeft="chevron-down"
                        onPress={() =>
                          setDiscoveryLimit((n) => n + DISCOVERY_PAGE)
                        }
                        style={{ marginTop: spacing.md, alignSelf: 'stretch' }}
                        fullWidth
                      />
                    ) : null}
                  </>
                )}
              </Section>
            </View>
          )}
        </ScrollView>
      )}

      {/* Floating "+" action — bottom LEFT under RTL. Using `end`
          (which resolves to the visual LEFT under forceRTL) keeps it
          off the right edge where the chevron-back gesture lives.
          Hidden on the empty state, which already shows a centered
          "create first community" button. */}
      {totalKnown === 0 && !isSearching ? null : (
        <Breathing mode="pulse" amount={0.05} periodMs={2400} style={styles.fab}>
          <Pressable
            style={({ pressed }) => [
              styles.fabInner,
              pressed && { opacity: 0.92, transform: [{ scale: 0.96 }] },
            ]}
            onPress={handleCreate}
            accessibilityRole="button"
            accessibilityLabel={he.communitiesCreateGroup}
          >
            <LivingIcon motion="hop">
              <Ionicons name="add" size={30} color="#FFFFFF" />
            </LivingIcon>
          </Pressable>
        </Breathing>
      )}

      <CommunityFilterSheet
        visible={filterOpen}
        onClose={() => setFilterOpen(false)}
        filters={filters}
        onChange={setFilters}
        nearbyLatLng={nearbyLoc?.latLng ?? undefined}
        nearbyCaption={
          nearbyLoading
            ? undefined
            : nearbyLoc?.latLng
              ? `${filters.nearbyRadiusKm} ק״מ מהמיקום שלך` +
                (nearbyLoc.city ? ` (${nearbyLoc.city})` : '')
              : nearbyLoc?.city ?? undefined
        }
      />
    </View>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionTitleRow}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {/* Small blue indicator under the title — the design's
            "section open" cue. Pinned to the trailing edge of the
            row so it sits under the start of the right-aligned
            Hebrew title. */}
        <View style={styles.sectionUnderline} />
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F8FAFC' },
  scrollContent: {
    paddingBottom: 120,
  },
  // Pinned search/filter row that floats OVER the bottom of the
  // hero. Negative marginTop pulls the row up onto the hero's
  // gradient; zIndex/elevation raise it visually above the hero on
  // both iOS and Android.
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    marginTop: -spacing.xxl,
    zIndex: 2,
    elevation: 2,
  },
  // White pill — search bar of the row. Soft shadow lifts it off
  // the page like the filter button next to it.
  searchPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: '#FFFFFF',
    borderRadius: 999,
    paddingHorizontal: spacing.lg,
    height: 48,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.10,
    shadowRadius: 14,
    elevation: 4,
  },
  searchInput: {
    flex: 1,
    color: '#0F172A',
    fontSize: 14,
    fontWeight: '500',
    // TextInput needs explicit `right` + `writingDirection: 'rtl'`
    // to anchor placeholder/value to the visual right edge on
    // Android. The RTL_LABEL_ALIGN helper that flips to 'left' on
    // Android is correct for <Text>, but EditText (the Android
    // TextInput primitive) doesn't perform the same start/end swap.
    textAlign: 'right',
    writingDirection: 'rtl',
    padding: 0,
  },
  filterButton: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.10,
    shadowRadius: 14,
    elevation: 4,
  },
  filterButtonActive: {
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
    fontWeight: '700',
  },

  body: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    gap: spacing.xl,
  },
  empty: {
    color: '#64748B',
    fontSize: 14,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
  emptyAll: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    gap: spacing.sm,
    marginTop: spacing.xl,
  },
  emptyAllTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0F172A',
    textAlign: 'center',
  },
  emptyAllSub: {
    fontSize: 14,
    color: '#64748B',
    textAlign: 'center',
  },

  section: {
    gap: spacing.md,
  },
  // Under forceRTL `alignItems: 'flex-start'` resolves to the visual
  // RIGHT edge — that's where Hebrew titles want to live so the
  // section header reads naturally from the right edge inward.
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
  // Blue underline indicator — small dash under the title, pinned to
  // the trailing edge of the row (right under RTL) so it sits under
  // the start of the Hebrew title text.
  sectionUnderline: {
    width: 36,
    height: 3,
    borderRadius: 2,
    backgroundColor: '#3B82F6',
  },
  sectionEmpty: {
    color: '#64748B',
    fontSize: 14,
    textAlign: 'center',
    paddingVertical: spacing.lg,
  },
  emptyHintCard: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#EEF2F7',
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
  emptyHintIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(59,130,246,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  emptyHintTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.text,
    textAlign: 'center',
  },
  emptyHintBody: {
    marginTop: spacing.xs,
    fontSize: 14,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 20,
  },
  cardsList: {
    gap: spacing.md,
  },

  // FAB pinned to bottom LEFT under RTL via `end:`. Blue circular,
  // with a heavy shadow so it floats over scrolled content.
  fab: {
    position: 'absolute',
    bottom: spacing.xl,
    end: spacing.lg,
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#3B82F6',
    shadowColor: '#1E40AF',
    shadowOpacity: 0.35,
    shadowRadius: 14,
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
});
