// Communities tab — premium card-based feed.
//
// Layout (top → bottom, RTL):
//   ① Blue gradient hero ("קבוצות" + subtitle + people-icon disc)
//   ② Search + filter row, floating onto the bottom of the hero
//   ③ Section "הקבוצות שלי"   — admin/member cards (admin floats up)
//   ④ Section "ממתינות לאישור" — only when there are pending requests
//   ⑤ Section "קבוצות פתוחות" — discovery (filtered)
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
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useScrollToTop } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { Button } from '@/components/Button';
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
import { GroupPublic } from '@/types';
import { colors, spacing, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import { useUserStore } from '@/store/userStore';
import { useGroupStore } from '@/store/groupStore';
import type { CommunitiesStackParamList } from '@/navigation/CommunitiesStack';

type Nav = NativeStackNavigationProp<CommunitiesStackParamList, 'CommunitiesFeed'>;

/**
 * Determine the viewer's current city for the "קרוב אליי" filter.
 *
 * Order of attempts:
 *   1. GPS → reverse-geocode (expo-location)
 *   2. Saved `availability.preferredCity` from the profile
 *   3. null (filter excludes everything until something resolves)
 */
async function resolveNearbyCity(
  fallbackCity: string | undefined,
): Promise<string | null> {
  let Location:
    | typeof import('expo-location')
    | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    Location = require('expo-location');
  } catch {
    Location = null;
  }
  if (Location) {
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.granted) {
        const pos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        const places = await Location.reverseGeocodeAsync({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
        });
        const place = places[0];
        const city =
          place?.city || place?.subregion || place?.region || null;
        if (city && city.trim().length > 0) return city.trim();
      }
    } catch (err) {
      if (__DEV__) {
        // eslint-disable-next-line no-console
        console.warn('[nearby] location resolve failed', err);
      }
    }
  }
  return fallbackCity?.trim() || null;
}

export function PublicGroupsFeedScreen() {
  const nav = useNavigation<Nav>();
  const user = useUserStore((s) => s.currentUser);
  const memberGroups = useGroupStore((s) => s.groups);
  const pendingGroups = useGroupStore((s) => s.pendingGroups);
  const requestJoinById = useGroupStore((s) => s.requestJoinById);
  const setCurrentGroup = useGroupStore((s) => s.setCurrentGroup);

  const scrollRef = useRef<ScrollView>(null);
  useScrollToTop(scrollRef);

  const [text, setText] = useState('');
  const [items, setItems] = useState<GroupPublic[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);

  const [filters, setFilters] = useState<GroupFilters>(EMPTY_GROUP_FILTERS);
  const [filterOpen, setFilterOpen] = useState(false);
  const [nearbyCity, setNearbyCity] = useState<string | null>(null);
  const [nearbyLoading, setNearbyLoading] = useState(false);

  useEffect(() => {
    if (!filters.nearby) {
      setNearbyCity(null);
      return;
    }
    let alive = true;
    (async () => {
      setNearbyLoading(true);
      const city = await resolveNearbyCity(
        user?.availability?.preferredCity,
      );
      if (alive) {
        setNearbyCity(city);
        setNearbyLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [filters.nearby, user?.availability?.preferredCity]);

  const filterCount = activeGroupFiltersCount(filters);

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
      } catch {
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
    if (filters.nearby && (nearbyLoading || !nearbyCity)) return false;
    return (
      applyGroupFilters([g], filters, { nearbyCity: nearbyCity ?? undefined })
        .length > 0
    );
  }

  // ── Section partitions ──
  // הקבוצות שלי     — communities I'm a member or admin of (admin floats up)
  // ממתינות לאישור — communities with an outstanding join request
  // קבוצות פתוחות   — discovery, filtered
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
          !memberIds.has(g.id) &&
          !adminIds.has(g.id) &&
          !pendingIds.has(g.id) &&
          passesDiscoveryFilters(g)
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, memberIds, adminIds, pendingIds, filters, nearbyCity, nearbyLoading]
  );

  const isSearching = text.trim().length > 0;
  const searchMatches = isSearching
    ? discoveryItems.concat(myItems).concat(pendingItems)
    : [];

  const handleRequest = async (item: GroupPublic) => {
    if (!user) return;
    try {
      const status = await requestJoinById(item.id, user.id);
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
      const code =
        typeof (err as { code?: unknown })?.code === 'string'
          ? ((err as { code: string }).code)
          : '';
      if (code === 'GROUP_FULL') {
        toast.error(he.toastGroupFull);
      } else {
        if (__DEV__) console.warn('[publicFeed] join request failed', err);
        toast.error(he.toastRequestFailed);
      }
    }
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

  const renderCard = (g: GroupPublic) => {
    const status = statusFor(g);
    const locationLine = [g.city, g.fieldName, g.fieldAddress]
      .filter((s) => s && s.trim().length > 0)
      .join(' · ');
    // The denormalised public count can drift behind /groups.playerIds
    // (client-side direct-joins on open communities can't write to the
    // public doc — rules forbid). For groups the viewer is a member
    // of, prefer the canonical playerIds.length so the card matches
    // the count shown on the details screen.
    const localGroup = memberGroups.find((mg) => mg.id === g.id);
    const memberCount = localGroup?.playerIds?.length ?? g.memberCount;
    return (
      <CommunityCard
        key={g.id}
        name={g.name}
        locationLine={locationLine}
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
      />
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
          <Ionicons name="search" size={18} color="#94A3B8" />
        </View>
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
      </View>
      {totalKnown === 0 && !isSearching ? (
        <View style={styles.emptyAll}>
          <Ionicons name="globe-outline" size={64} color={colors.textMuted} />
          <Text style={styles.emptyAllTitle}>{he.communitiesEmptyAll}</Text>
          <Text style={styles.emptyAllSub}>{he.communitiesEmptyAllSub}</Text>
          <Button
            title={he.communitiesCreateFirst}
            variant="primary"
            size="lg"
            iconLeft="add-circle-outline"
            onPress={() => nav.navigate('CommunitiesCreate')}
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
                  <Text style={styles.sectionEmpty}>
                    {he.communitiesEmptyMember}
                  </Text>
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
                  <View style={styles.cardsList}>
                    {discoveryItems.map(renderCard)}
                  </View>
                )}
              </Section>
            </View>
          )}
        </ScrollView>
      )}

      {/* Floating "+" action — bottom LEFT under RTL. Using `end`
          (which resolves to the visual LEFT under forceRTL) keeps it
          off the right edge where the chevron-back gesture lives. */}
      <Pressable
        style={({ pressed }) => [
          styles.fab,
          pressed && { opacity: 0.92, transform: [{ scale: 0.96 }] },
        ]}
        onPress={() => nav.navigate('CommunitiesCreate')}
        accessibilityRole="button"
        accessibilityLabel={he.communitiesCreateFirst}
      >
        <Ionicons name="add" size={30} color="#FFFFFF" />
      </Pressable>

      <CommunityFilterSheet
        visible={filterOpen}
        onClose={() => setFilterOpen(false)}
        filters={filters}
        onChange={setFilters}
        nearbyCaption={nearbyLoading ? undefined : nearbyCity ?? undefined}
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
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#1E40AF',
    shadowOpacity: 0.35,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
});
