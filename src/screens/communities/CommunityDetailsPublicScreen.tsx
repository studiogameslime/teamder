// CommunityDetailsPublicScreen — non-member preview of a community.
//
// Reads /groupsPublic/{id} ONLY. Never touches /groups/{id} (which is
// read-restricted to members + admins by Firestore rules). The fields we
// show match what's serialized into GroupPublic by groupPublicConverter:
//   name, city, fieldName, fieldAddress, description,
//   preferredDays, preferredHour, costPerGame,
//   memberCount, isOpen, contactPhone.
//
// Hidden by design: members list, admin list, pendingPlayerIds — anything
// that would expose private community membership. Once the user joins,
// PublicGroupsFeedScreen will navigate to the private CommunityDetails
// instead, which has the full member roster.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SoccerBallLoader } from '@/components/SoccerBallLoader';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  RouteProp,
  useFocusEffect,
  useNavigation,
  useRoute,
} from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { ScreenHeader } from '@/components/ScreenHeader';
import { toast } from '@/components/Toast';
import { groupService } from '@/services';
import { gameService } from '@/services/gameService';
import { logError, logUnexpected } from '@/services/errorLog';
import {
  isValidIsraeliPhone,
  openWhatsApp,
} from '@/services/whatsappService';
import { Game, GroupPublic, WeekdayIndex } from '@/types';
import { colors, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import { useUserStore } from '@/store/userStore';
import { useGroupStore } from '@/store/groupStore';
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';
import type { CommunitiesStackParamList } from '@/navigation/CommunitiesStack';

type Nav = NativeStackNavigationProp<
  CommunitiesStackParamList,
  'CommunityDetailsPublic'
>;
type Params = RouteProp<CommunitiesStackParamList, 'CommunityDetailsPublic'>;

function formatDays(days: WeekdayIndex[] | undefined): string {
  if (!days || days.length === 0) return '';
  return days
    .slice()
    .sort()
    .map((d) => he.availabilityDayShort[d])
    .join(', ');
}

export function CommunityDetailsPublicScreen() {
  const nav = useNavigation<Nav>();
  const { groupId } = useRoute<Params>().params;
  const me = useUserStore((s) => s.currentUser);
  const pendingGroups = useGroupStore((s) => s.pendingGroups);
  const memberGroups = useGroupStore((s) => s.groups);
  const requestJoinById = useGroupStore((s) => s.requestJoinById);

  const [group, setGroup] = useState<GroupPublic | null>(null);
  // Upcoming public games drive the dynamic "ימי משחק" / "שעת משחק"
  // derivation below — replacing the legacy `group.preferredDays` /
  // `group.preferredHour` MetaRows that no longer exist on the
  // create/edit form.
  const [upcomingGames, setUpcomingGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyJoin, setBusyJoin] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [g, games] = await Promise.all([
        groupService.getPublic(groupId),
        gameService
          .getUpcomingPublicGamesForGroup(groupId)
          .catch(() => [] as Game[]),
      ]);
      setGroup(g);
      setUpcomingGames(games);
    } catch (err) {
      logError('communityPublicReload', err, {
        screen: 'CommunityDetailsPublicScreen',
        groupId,
      });
      if (__DEV__) console.warn('[communityPublic] reload failed', err);
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload])
  );
  useEffect(() => {
    reload();
  }, [reload]);

  // If the user is already a member, bounce to the private full screen.
  // (They might land here via a shared link or after backgrounding the
  // app at the moment they got approved.)
  useEffect(() => {
    if (memberGroups.some((g) => g.id === groupId)) {
      nav.replace('CommunityDetails', { groupId });
    }
  }, [memberGroups, groupId, nav]);

  // Derive the community's day/hour pattern from its actual upcoming
  // games rather than the legacy `preferredDays` / `preferredHour`
  // fields on /groupsPublic. New groups stop writing those, so the
  // derivation here keeps the public preview honest as long as the
  // admin schedules at least one upcoming public game.
  // MUST sit above the loading/!group early returns — otherwise the
  // hook order changes between the first (loading) render and the
  // loaded render, crashing with "rendered more hooks".
  const derivedDaysList = useMemo<WeekdayIndex[]>(() => {
    if (upcomingGames.length === 0) return [];
    const set = new Set<WeekdayIndex>();
    upcomingGames.forEach((g) => {
      const d = new Date(g.startsAt);
      set.add(d.getDay() as WeekdayIndex);
    });
    return Array.from(set).sort();
  }, [upcomingGames]);
  const derivedDays = formatDays(derivedDaysList);
  const derivedHour = useMemo<string>(() => {
    if (upcomingGames.length === 0) return '';
    // Most-common HH:MM among upcoming games. Ties resolved by
    // earliest game's hour (which the sort by startsAt above gave us).
    const counts = new Map<string, number>();
    upcomingGames.forEach((g) => {
      const d = new Date(g.startsAt);
      const k = `${String(d.getHours()).padStart(2, '0')}:${String(
        d.getMinutes(),
      ).padStart(2, '0')}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    });
    let best = '';
    let bestN = 0;
    counts.forEach((n, k) => {
      if (n > bestN) {
        best = k;
        bestN = n;
      }
    });
    return best;
  }, [upcomingGames]);

  if (loading) {
    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <ScreenHeader title={he.loading} />
        <SoccerBallLoader size={40} style={{ marginTop: spacing.lg }} />
      </SafeAreaView>
    );
  }

  if (!group) {
    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <ScreenHeader title={he.loading} />
        <View style={styles.empty}>
          <Text style={styles.emptyText}>{he.communitiesEmpty}</Text>
        </View>
      </SafeAreaView>
    );
  }

  const isPending = pendingGroups.some((g) => g.id === group.id);
  const phoneValid =
    !!group.contactPhone && isValidIsraeliPhone(group.contactPhone);

  const handleJoin = async () => {
    if (!me || isPending) return;
    setBusyJoin(true);
    try {
      const status = await requestJoinById(group.id, me.id);
      // Silent-failure guard: requestJoinById updates the group store in
      // place (pending → adds to pendingGroups; joined → re-hydrates
      // memberGroups). Read the FRESHLY-SET store snapshot via getState()
      // — no new Firestore read — and assert the expected membership/
      // pending state materialised. The reactive `pendingGroups`/
      // `memberGroups` closures captured at render time are stale here.
      if (status === 'pending' || status === 'joined') {
        const store = useGroupStore.getState();
        const reflected =
          store.groups.some((g) => g.id === group.id) ||
          store.pendingGroups.some((g) => g.id === group.id);
        if (!reflected) {
          logUnexpected('communityJoinNotReflected', {
            screen: 'CommunityDetailsPublicScreen',
            groupId: group.id,
            userId: me.id,
            status,
          });
        }
      }
      if (status === 'pending') {
        logEvent(AnalyticsEvent.GroupJoinRequested, { groupId: group.id });
        toast.success(he.toastJoinRequestSent);
        nav.goBack();
      } else if (status === 'joined') {
        toast.success(he.toastJoinedGroup);
        nav.goBack();
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
        const transient = [
          'unavailable', 'deadline-exceeded', 'cancelled', 'unauthenticated',
          'firebase-app-check-token-is-invalid',
        ].includes(code);
        if (!transient) {
          logError('requestJoinGroup', err, {
            screen: 'CommunityDetailsPublicScreen',
            groupId: group.id,
            userId: me?.id,
          });
        }
        if (__DEV__) console.warn('[communityPublic] join failed', err);
        toast.error(he.toastRequestFailed);
      }
    } finally {
      setBusyJoin(false);
    }
  };

  // CTA label depends on `isOpen` — auto-join vs admin approval.
  const cta = group.isOpen ? he.communityJoinAuto : he.communityRequestToJoin;
  const ctaDisabled = isPending || busyJoin;

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <ScreenHeader title={group.name} />
      <ScrollView contentContainerStyle={styles.content}>
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>{he.communityDetailsAbout}</Text>
          {group.description ? (
            <Text style={styles.bodyText}>{group.description}</Text>
          ) : null}
          <MetaRow
            icon="location-outline"
            label={he.communityDetailsCity}
            value={Array.from(
              new Set([group.city, group.fieldAddress].filter(Boolean)),
            ).join(', ')}
          />
          {group.fieldName ? (
            <MetaRow
              icon="football-outline"
              label={he.communityDetailsField}
              value={group.fieldName}
            />
          ) : null}
          {derivedDays ? (
            <MetaRow
              icon="calendar-outline"
              label={he.communityDetailsPreferredDays}
              value={derivedDays}
            />
          ) : null}
          {derivedHour ? (
            <MetaRow
              icon="time-outline"
              label={he.communityDetailsPreferredHour}
              value={derivedHour}
            />
          ) : null}
          <MetaRow
            icon="people-outline"
            label={he.communityDetailsMembers}
            value={he.communityMembersCount(group.memberCount)}
          />
        </Card>

        {phoneValid ? (
          <Button
            title={he.communityDetailsContactAdmin}
            variant="outline"
            size="lg"
            fullWidth
            iconLeft="logo-whatsapp"
            onPress={() => openWhatsApp(group.contactPhone)}
          />
        ) : null}

        <Button
          title={isPending ? he.groupsActionPending : cta}
          variant="primary"
          size="lg"
          fullWidth
          loading={busyJoin}
          disabled={ctaDisabled}
          onPress={handleJoin}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

function MetaRow({
  icon,
  label,
  value,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
}) {
  if (!value) return null;
  return (
    <View style={styles.metaRow}>
      <Ionicons name={icon} size={14} color={colors.textMuted} />
      <Text style={styles.metaLabel}>{label}:</Text>
      <Text style={styles.metaValue} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xl },
  section: { gap: spacing.xs },
  sectionTitle: {
    ...typography.h3,
    color: colors.text,
    textAlign: RTL_LABEL_ALIGN,
    marginBottom: spacing.xs,
  },
  bodyText: {
    ...typography.body,
    color: colors.text,
    textAlign: RTL_LABEL_ALIGN,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  metaLabel: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
  },
  metaValue: {
    ...typography.caption,
    color: colors.text,
    flex: 1,
    textAlign: RTL_LABEL_ALIGN,
  },
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
