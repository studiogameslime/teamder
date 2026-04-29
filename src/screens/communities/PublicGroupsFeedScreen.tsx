// Communities tab — sectioned feed with filters.
//
// Sections (only one is rendered at a time when the user has typed a search):
//   1. My Communities    — current user is a member or has a pending request
//   2. Nearby             — same city as the user's preferredCity (no geo)
//   3. Open               — everything else, sorted by member count desc
//
// Filters apply to sections 2 + 3 (the discovery half). The "My" section
// always shows everything the user already belongs to so they can switch
// between communities without juggling filters.

import React, { useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SoccerBallLoader } from '@/components/SoccerBallLoader';
import { InputField } from '@/components/InputField';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Badge } from '@/components/Badge';
import { ScreenHeader } from '@/components/ScreenHeader';
import { toast } from '@/components/Toast';
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';
import { groupService } from '@/services';
import { openWhatsApp } from '@/services/whatsappService';
import { GroupPublic } from '@/types';
import { colors, radius, spacing, typography } from '@/theme';
import { he } from '@/i18n/he';
import { useUserStore } from '@/store/userStore';
import { useGroupStore } from '@/store/groupStore';
import type { CommunitiesStackParamList } from '@/navigation/CommunitiesStack';

type Nav = NativeStackNavigationProp<CommunitiesStackParamList, 'CommunitiesFeed'>;

type RowAction = 'enter' | 'pending' | 'joinAuto' | 'requestJoin';

/** Treat two free-text city strings as a match (Hebrew, case/space tolerant). */
function citiesMatch(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** A community has open spots if it caps `maxMembers` and isn't there yet. */
function hasOpenSpot(g: GroupPublic): boolean {
  if (typeof g.maxMembers !== 'number') return true; // no cap → always open
  return g.memberCount < g.maxMembers;
}

/**
 * Determine the viewer's current city for the "קרוב אליי" filter.
 *
 * Order of attempts:
 *   1. GPS → reverse-geocode (expo-location)
 *   2. Saved `availability.preferredCity` from the profile
 *   3. null (filter excludes everything until something resolves)
 *
 * Lazy-required so the bundle still loads in environments where
 * expo-location isn't linked (Expo Go, fresh dev clients).
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

  const [text, setText] = useState('');
  const [items, setItems] = useState<GroupPublic[] | null>(null);
  const [loading, setLoading] = useState(false);

  // Filters — two independent toggles. "hasRoom" filters communities
  // that aren't at their member cap; "nearby" derives the viewer's
  // current city from GPS (reverse-geocoded once per toggle) and
  // matches it against the community's `city`. Falls back to the
  // user's saved `availability.preferredCity` if location permission
  // is denied or expo-location can't resolve a city.
  const [hasRoom, setHasRoom] = useState(false);
  const [nearby, setNearby] = useState(false);
  const [nearbyCity, setNearbyCity] = useState<string | null>(null);
  const [nearbyLoading, setNearbyLoading] = useState(false);

  // Resolve the "nearby" city the moment the toggle flips ON.
  useEffect(() => {
    if (!nearby) {
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
  }, [nearby, user?.availability?.preferredCity]);

  // Initial load + debounced search.
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
  }, [text]);

  const memberIds = useMemo(
    () => new Set(memberGroups.map((g) => g.id)),
    [memberGroups]
  );
  const pendingIds = useMemo(
    () => new Set(pendingGroups.map((g) => g.id)),
    [pendingGroups]
  );
  // Communities the current user is an admin of — taken from the
  // private-groups list in groupStore (memberGroups is everything the
  // user reads from /groups, including ones where they're admin).
  const adminIds = useMemo(() => {
    if (!user) return new Set<string>();
    return new Set(
      memberGroups
        .filter((g) => g.adminIds.includes(user.id))
        .map((g) => g.id)
    );
  }, [memberGroups, user]);

  function actionFor(g: GroupPublic): RowAction {
    if (memberIds.has(g.id)) return 'enter';
    if (pendingIds.has(g.id)) return 'pending';
    return g.isOpen ? 'joinAuto' : 'requestJoin';
  }

  function passesDiscoveryFilters(g: GroupPublic): boolean {
    if (hasRoom && !hasOpenSpot(g)) return false;
    if (nearby) {
      // While we're still resolving GPS / reverse-geocode, hide
      // discovery results so the list doesn't briefly show
      // unfiltered groups before snapping to the filtered set.
      if (nearbyLoading || !nearbyCity) return false;
      if (!citiesMatch(g.city, nearbyCity)) return false;
    }
    return true;
  }

  // Partition into 2 sections per spec:
  //   הקבוצות שלי     — anywhere I'm a member, admin, or have a pending
  //                      request. Coach communities are flagged inline
  //                      with a "מאמן" badge instead of a separate
  //                      section, so the user has one home for "all
  //                      the communities I'm in".
  //   קבוצות פתוחות   — discovery (everything else, with filters applied)
  const myItems = useMemo(
    () => {
      const list = (items ?? []).filter(
        (g) =>
          memberIds.has(g.id) ||
          pendingIds.has(g.id) ||
          adminIds.has(g.id),
      );
      // Coach-of communities float to the top so the user sees what
      // they manage first; member-only and pending follow.
      return list.sort((a, b) => {
        const aRank = adminIds.has(a.id) ? 0 : 1;
        const bRank = adminIds.has(b.id) ? 0 : 1;
        return aRank - bRank;
      });
    },
    [items, memberIds, pendingIds, adminIds],
  );
  const discoveryItems = useMemo(
    () =>
      (items ?? []).filter(
        (g) =>
          !memberIds.has(g.id) &&
          !pendingIds.has(g.id) &&
          passesDiscoveryFilters(g)
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, memberIds, pendingIds, hasRoom, nearby, nearbyCity, nearbyLoading]
  );

  // When the user is searching, collapse into a single result list — the
  // section breakdown is noise relative to "did my query match anything".
  const isSearching = text.trim().length > 0;
  const searchMatches = isSearching
    ? discoveryItems.concat(myItems)
    : [];

  const handleRequest = async (item: GroupPublic) => {
    if (!user) return;
    try {
      const status = await requestJoinById(item.id, user.id);
      if (status === 'pending') {
        logEvent(AnalyticsEvent.GroupJoinRequested, { groupId: item.id });
        toast.success(he.toastJoinRequestSent);
      } else if (status === 'already_member') {
        toast.info(he.groupAlreadyMember);
      }
    } catch (err) {
      if (__DEV__) console.warn('[publicFeed] join request failed', err);
      toast.error(he.toastRequestFailed);
    }
  };

  const handleEnter = async (item: GroupPublic) => {
    // For an existing member, "enter" navigates to the community details
    // page rather than just setting the current group — the user can read
    // about the community there and access actions (invite, leave, etc.).
    await setCurrentGroup(item.id);
    nav.navigate('CommunityDetails', { groupId: item.id });
  };

  const handleOpenDetails = (item: GroupPublic) => {
    // Route based on membership so we read the right Firestore doc:
    //   member/admin → /groups/{id} (CommunityDetails — full view)
    //   non-member   → /groupsPublic/{id} (CommunityDetailsPublic)
    // Firestore rules deny non-members reading /groups/{id}, so this
    // split is what keeps the public preview working.
    if (memberIds.has(item.id)) {
      nav.navigate('CommunityDetails', { groupId: item.id });
    } else {
      nav.navigate('CommunityDetailsPublic', { groupId: item.id });
    }
  };

  const renderRow = (g: GroupPublic) => (
    <FeedRow
      key={g.id}
      g={g}
      action={actionFor(g)}
      isCoach={adminIds.has(g.id)}
      onPrimary={() => {
        const a = actionFor(g);
        if (a === 'enter') return handleEnter(g);
        if (a === 'requestJoin' || a === 'joinAuto') return handleRequest(g);
      }}
      onOpen={() => handleOpenDetails(g)}
    />
  );

  // ── Render ────────────────────────────────────────────────────────────

  if (loading && items === null) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <ScreenHeader title={he.communitiesTitle} showBack={false} />
        <SoccerBallLoader size={40} style={{ marginTop: spacing.lg }} />
      </SafeAreaView>
    );
  }

  const totalKnown = (items ?? []).length;

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScreenHeader title={he.communitiesTitle} showBack={false} />

      <View style={styles.searchWrap}>
        <InputField
          value={text}
          onChangeText={setText}
          placeholder={he.communitiesSearchPlaceholder}
          icon="search-outline"
          returnKeyType="search"
        />
      </View>

      {/* Filter pills — wrap-row instead of horizontal scroll so RTL
          doesn't clip the rightmost pill on Android. With three short
          toggles they fit on one row at typical widths anyway. */}
      <View style={styles.filterRow}>
        <FilterPill
          label={he.filterHasRoom}
          active={hasRoom}
          onPress={() => setHasRoom((v) => !v)}
        />
        <FilterPill
          label={he.filterNearby}
          active={nearby}
          onPress={() => setNearby((v) => !v)}
        />
      </View>

      {totalKnown === 0 ? (
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
      ) : isSearching ? (
        <ScrollView contentContainerStyle={styles.listContent}>
          {searchMatches.length === 0 ? (
            <Text style={styles.empty}>{he.communitiesEmpty}</Text>
          ) : (
            searchMatches.map(renderRow)
          )}
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={styles.listContent}>
          <Section
            title={he.communitiesSectionMember}
            items={myItems}
            emptyText={he.communitiesEmptyMember}
            renderRow={renderRow}
          />
          <Section
            title={he.communitiesSectionOpen}
            items={discoveryItems}
            emptyText={he.communitiesEmptyOpenSection}
            renderRow={renderRow}
          />
        </ScrollView>
      )}

      <Pressable
        style={styles.fab}
        onPress={() => nav.navigate('CommunitiesCreate')}
      >
        <Ionicons name="add" size={28} color="#fff" />
      </Pressable>
    </SafeAreaView>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────

function Section({
  title,
  items,
  emptyText,
  renderRow,
}: {
  title: string;
  items: GroupPublic[];
  emptyText: string;
  renderRow: (g: GroupPublic) => React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {items.length === 0 ? (
        <Card style={styles.sectionEmpty}>
          <Text style={styles.sectionEmptyText}>{emptyText}</Text>
        </Card>
      ) : (
        items.map(renderRow)
      )}
    </View>
  );
}

function FilterPill({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.filterPill,
        active && styles.filterPillActive,
        pressed && { opacity: 0.85 },
      ]}
    >
      <Text
        style={[
          styles.filterPillText,
          active && { color: colors.primary, fontWeight: '600' },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function FeedRow({
  g,
  action,
  isCoach,
  onPrimary,
  onOpen,
}: {
  g: GroupPublic;
  action: RowAction;
  isCoach: boolean;
  onPrimary: () => void;
  onOpen: () => void;
}) {
  const locationLine = [g.city, g.fieldName, g.fieldAddress]
    .filter((s) => s && s.trim().length > 0)
    .join(' · ');

  return (
    <Card style={styles.row} onPress={onOpen}>
      <View style={{ flex: 1 }}>
        <View style={styles.rowHeader}>
          <Text style={styles.name} numberOfLines={1}>
            {g.name}
          </Text>
          {isCoach ? (
            <Badge
              label={he.communityDetailsAdminBadge}
              tone="primary"
              icon="star"
            />
          ) : (
            <StatusPill action={action} />
          )}
        </View>
        {locationLine ? (
          <View style={styles.meta}>
            <Ionicons name="location-outline" size={14} color={colors.textMuted} />
            <Text style={styles.metaText} numberOfLines={1}>
              {locationLine}
            </Text>
          </View>
        ) : null}
        {g.description ? (
          <Text style={styles.desc} numberOfLines={2}>
            {g.description}
          </Text>
        ) : null}
        <View style={styles.metaRow}>
          <View style={styles.meta}>
            <Ionicons name="people-outline" size={14} color={colors.primary} />
            <Text style={[styles.metaText, { color: colors.primary }]}>
              {he.groupsSearchMembers(g.memberCount)}
            </Text>
          </View>
          {g.contactPhone ? (
            <Pressable
              onPress={() => openWhatsApp(g.contactPhone)}
              style={styles.waBtn}
              accessibilityLabel="open-whatsapp"
            >
              <Ionicons name="logo-whatsapp" size={14} color="#25D366" />
              <Text style={styles.waText}>{he.communityWhatsApp}</Text>
            </Pressable>
          ) : null}
        </View>
        <View style={{ marginTop: spacing.sm }}>
          <PrimaryAction action={action} onPress={onPrimary} />
        </View>
      </View>
    </Card>
  );
}

function StatusPill({ action }: { action: RowAction }) {
  // Reuse the design-system Badge so community statuses render with
  // identical pixels to game / rating / approval statuses elsewhere.
  if (action === 'enter') {
    return <Badge label={he.groupsActionMember} tone="primary" icon="checkmark-circle" />;
  }
  if (action === 'pending') {
    return <Badge label={he.groupsActionPending} tone="neutral" icon="hourglass-outline" />;
  }
  return null;
}

function PrimaryAction({
  action,
  onPress,
}: {
  action: RowAction;
  onPress: () => void;
}) {
  // 'enter' — user is already a member. We deliberately render NO
  // button: the "כבר חבר" badge in the card header already conveys the
  // status, and tapping the card itself opens the community details
  // where they can do anything member-related. A "כניסה לקבוצה" CTA
  // here was just visual noise on a list of cards the user mostly
  // scans for NEW communities to join.
  if (action === 'enter') return null;
  if (action === 'joinAuto') {
    return (
      <Button
        title={he.communityJoinAuto}
        variant="primary"
        size="sm"
        onPress={onPress}
        fullWidth
      />
    );
  }
  if (action === 'requestJoin') {
    return (
      <Button
        title={he.communityRequestToJoin}
        variant="outline"
        size="sm"
        onPress={onPress}
        fullWidth
      />
    );
  }
  // pending / closed: no primary action — the status pill conveys state.
  return null;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  searchWrap: {
    paddingHorizontal: spacing.lg,
    marginTop: spacing.md,
  },

  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  filterPill: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  filterPillActive: {
    backgroundColor: colors.primaryLight,
    borderColor: colors.primary,
  },
  filterPillText: {
    ...typography.caption,
    color: colors.textMuted,
  },

  listContent: {
    padding: spacing.lg,
    gap: spacing.lg,
    paddingBottom: 120,
  },
  section: { gap: spacing.sm },
  sectionTitle: {
    ...typography.h3,
    color: colors.text,
    textAlign: 'right',
  },
  sectionEmpty: { alignItems: 'center', paddingVertical: spacing.lg },
  sectionEmptyText: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
  },

  empty: {
    ...typography.body,
    color: colors.textMuted,
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
    ...typography.h2,
    color: colors.text,
    textAlign: 'center',
  },
  emptyAllSub: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
  },

  row: {
    padding: spacing.md,
  },
  rowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  name: { ...typography.bodyBold, color: colors.text, flex: 1 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: 2 },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginTop: spacing.xs,
  },
  metaText: { ...typography.caption, color: colors.textMuted },
  desc: { ...typography.caption, color: colors.text, marginTop: spacing.xs },
  pill: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
  },
  pillText: { ...typography.caption, fontWeight: '600' },
  waBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: '#E7F8EE',
  },
  waText: {
    ...typography.caption,
    color: '#1FAA59',
    fontWeight: '600',
  },
  fab: {
    position: 'absolute',
    bottom: spacing.xl,
    end: spacing.lg,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
});
