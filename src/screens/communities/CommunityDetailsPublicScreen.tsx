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

import React, { useCallback, useRef, useState } from 'react';
import {
  Keyboard,
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
import { CommunityStadiumHero } from '@/components/community/CommunityStadiumHero';
import { ClubTabs } from '@/components/club/ClubTabs';
import { resolveRoundCover } from '@/data/roundCover';
import { NextGameCard } from '@/components/community/NextGameCard';
import { toast } from '@/components/Toast';
import { successHaptic } from '@/utils/haptics';
import { groupService } from '@/services';
import { GroupJoinRejectedError } from '@/services/groupService';
import { ensureNotGuest } from '@/utils/guestGate';
import {
  useAuthenticatedAction,
  useIsGuest,
} from '@/hooks/useAuthenticatedAction';
import { gameService } from '@/services/gameService';
import { logError, logUnexpected } from '@/services/errorLog';
import {
  isValidIsraeliPhone,
  openWhatsApp,
} from '@/services/whatsappService';
import { Game, GroupPublic } from '@/types';
import { RTL_LABEL_ALIGN, clubAccent, clubSurface, colors, spacing, typography } from '@/theme';
import { he } from '@/i18n/he';
import { useUserStore } from '@/store/userStore';
import { useGroupStore } from '@/store/groupStore';
import { receivedInvitationsService } from '@/services/receivedInvitationsService';
import { hasClubInvitation } from '@/utils/receivedInvitations';
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';
import type { CommunitiesStackParamList } from '@/navigation/CommunitiesStack';

type Nav = NativeStackNavigationProp<
  CommunitiesStackParamList,
  'CommunityDetailsPublic'
>;
type Params = RouteProp<CommunitiesStackParamList, 'CommunityDetailsPublic'>;

export function CommunityDetailsPublicScreen() {
  const nav = useNavigation<Nav>();
  const { groupId } = useRoute<Params>().params;
  const me = useUserStore((s) => s.currentUser);
  const isGuest = useIsGuest();
  const authAction = useAuthenticatedAction();
  const pendingGroups = useGroupStore((s) => s.pendingGroups);
  const memberGroups = useGroupStore((s) => s.groups);
  const requestJoinById = useGroupStore((s) => s.requestJoinById);
  const cancelJoinById = useGroupStore((s) => s.cancelJoinById);

  const [group, setGroup] = useState<GroupPublic | null>(null);
  const [upcomingGames, setUpcomingGames] = useState<Game[]>([]);
  const [failedCover, setFailedCover] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busyJoin, setBusyJoin] = useState(false);
  const loadGeneration = useRef(0);
  const joinInFlight = useRef(false);
  const memberNavigation = useRef<string | null>(null);
  const openMemberView = useCallback(() => {
    const key = `${me?.id}:${groupId}`;
    if (!nav.isFocused() || memberNavigation.current === key) return;
    memberNavigation.current = key;
    nav.replace('CommunityDetails', {groupId});
  }, [nav, me?.id, groupId]);
  const [invitation, setInvitation] = useState<{uid: string; groupId: string; available: boolean} | null>(null);
  const fromInvitation = invitation?.uid === me?.id && invitation?.groupId === groupId && invitation.available;

  useFocusEffect(useCallback(() => {
    let active = true;
    setInvitation(null);
    if (!me || me.isGuest) return;
    receivedInvitationsService.listInbox(me.id).then(items => {
      if (active) setInvitation({uid: me.id, groupId, available: hasClubInvitation(items, groupId)});
    }).catch(error => {
      if (active) {
        setInvitation({uid: me.id, groupId, available: false});
        logError('communityInvitationLookup', error, {groupId});
      }
    });
    return () => { active = false; };
  }, [me?.id, me?.isGuest, groupId]));

  const reload = useCallback(async () => {
    const generation = ++loadGeneration.current;
    setLoading(true);
    setLoadFailed(false);
    try {
      const [g, games] = await Promise.all([
        groupService.getPublic(groupId),
        gameService
          .getUpcomingPublicGamesForGroup(groupId)
          .catch(() => [] as Game[]),
      ]);
      if (generation !== loadGeneration.current) return;
      setGroup(g);
      setUpcomingGames(games);
    } catch (err) {
      if (generation !== loadGeneration.current) return;
      setLoadFailed(true);
      logError('communityPublicReload', err, {
        screen: 'CommunityDetailsPublicScreen',
        groupId,
      });
      if (__DEV__) console.warn('[communityPublic] reload failed', err);
    } finally {
      if (generation === loadGeneration.current) setLoading(false);
    }
  }, [groupId]);

  // Single load path — useFocusEffect handles both initial focus and return;
  // a separate useEffect(reload) double-loaded on open.
  //
  // The dismiss is the second half of the dead-taps fix on the ScrollView
  // below, and it is here for the same reason it is on the members' screen:
  // this page is the OTHER destination of the very same feed row (a club the
  // user is not in opens here instead), so it is reached the same way — by
  // tapping a search result while the search box still holds focus — and its
  // taps are the join/request buttons, the ones it costs the most to eat.
  useFocusEffect(
    useCallback(() => {
      Keyboard.dismiss();
      reload();
      return () => { loadGeneration.current += 1; };
    }, [reload])
  );

  // If the user is already a member, bounce to the private full screen.
  // (They might land here via a shared link or after backgrounding the
  // app at the moment they got approved.)
  useFocusEffect(useCallback(() => {
    if (memberGroups.some((g) => g.id === groupId)) {
      openMemberView();
    }
  }, [memberGroups, groupId, openMemberView]));

  if (loadFailed && !loading) {
    return <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <ScreenHeader title="פרטי המועדון" />
      <View style={styles.empty}>
        <Text style={styles.emptyText}>לא הצלחנו לטעון את המועדון. אפשר לנסות שוב.</Text>
        <Button title="נסה שוב" onPress={reload} />
      </View>
    </SafeAreaView>;
  }

  if (loading || (group !== null && group.id !== groupId)) {
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
    if (joinInFlight.current) return;
    // Come back to THIS club after signing up — see the note in guestGate.
    if (isGuest) {
      // Same contract as joining a game: the intent is persisted and the
      // sheet opens in place. The resumer re-asks the server afterwards, so
      // an approval state that changed while they were authenticating is the
      // one that counts.
      void authAction.request({
        kind: 'join_club',
        targetId: group.id,
        origin: 'in_app',
        // Never called: this branch only runs for a guest, and the coordinator
        // parks rather than executing. The real work is the registered resumer,
        // which asks the server fresh after authentication. Throwing makes a
        // future mistake loud instead of silently reporting success.
        execute: async () => {
          throw new Error('unreachable: guest actions resume via their resumer');
        },
      });
      return;
    }
    if (!me || (isPending && !fromInvitation)) return;
    joinInFlight.current = true;
    setBusyJoin(true);
    try {
      const status = await requestJoinById(group.id, me.id);
      if (useUserStore.getState().currentUser?.id !== me.id) return;
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
        successHaptic();
        toast.success(he.toastJoinRequestSent);
        if (nav.isFocused()) nav.goBack();
      } else if (status === 'joined') {
        successHaptic();
        toast.success(he.toastJoinedGroup);
        openMemberView();
      } else if (status === 'already_member') {
        toast.info(he.groupAlreadyMember);
        openMemberView();
      }
    } catch (err) {
      logEvent(AnalyticsEvent.GroupJoinFailed, {
        groupId: group.id,
        reason:
          typeof (err as { code?: unknown })?.code === 'string'
            ? (err as { code: string }).code
            : (err as Error)?.name ?? 'unknown',
      });
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
      joinInFlight.current = false;
      setBusyJoin(false);
    }
  };

  const handleCancelRequest = async () => {
    if (!me || joinInFlight.current) return;
    joinInFlight.current = true;
    setBusyJoin(true);
    try {
      await cancelJoinById(group.id, me.id);
      logEvent(AnalyticsEvent.GroupJoinRequestCancelled, { groupId: group.id });
      toast.success(he.toastJoinRequestCancelled);
      if (nav.isFocused()) nav.goBack();
    } catch (err) {
      logError('cancelJoinGroup', err, {
        screen: 'CommunityDetailsPublicScreen',
        groupId: group.id,
        userId: me?.id,
      });
      if (__DEV__) console.warn('[communityPublic] cancel failed', err);
      toast.error(he.toastRequestFailed);
    } finally {
      joinInFlight.current = false;
      setBusyJoin(false);
    }
  };

  // CTA label depends on `isOpen` — auto-join vs admin approval.
  // The soonest upcoming game, from the list this screen already loaded.
  const nextPublicGame = upcomingGames.length
    ? [...upcomingGames].sort((a, b) => (a.startsAt ?? 0) - (b.startsAt ?? 0))[0]
    : null;

  const cta = group.isOpen ? he.communityJoinAuto : he.communityRequestToJoin;
  const invitationLoading = !!me && !me.isGuest && (invitation?.uid !== me.id || invitation.groupId !== groupId);
  const ctaDisabled = (isPending && !fromInvitation) || busyJoin || invitationLoading;

  return (
    // No 'top' any more: the hero claims the status-bar inset itself, exactly
    // as it does on the member screen. Claiming it here as well pushed the
    // whole hero down by the height of the notch.
    <SafeAreaView style={styles.root} edges={['bottom']}>
      {authAction.sheet}
      <ScrollView
        contentContainerStyle={styles.content}
        // "I press buttons and nothing is pressed; I scroll a little and then
        // the presses work" (1.1.8 report, fixed the same way on
        // CommunityDetailsScreen). Scrolling still working while taps do
        // nothing points at ScrollView's onStartShouldSetResponderCapture: it
        // takes the touch away from whatever is under the finger whenever
        // keyboardShouldPersistTaps is the default 'never' AND RN still has a
        // focused TextInput on record. This page owns none, but the public
        // feed it is opened from does, and that focus survives the navigation
        // (the native stack keeps the feed mounted), so the first tap after
        // arrival goes to dismissing a keyboard instead of to the button.
        // "handled" opts out of the capture, so the touch reaches the button
        // and only an unclaimed tap falls through.
        keyboardShouldPersistTaps="handled"
      >
        {/* The same hero and the same three tabs a member sees. A visitor's
            club must not be a different-looking screen — that was the whole
            complaint. What differs is what the tabs can open, and that is a
            real boundary: this screen reads `/groupsPublic`, the projection,
            because the rules do not let a non-member read `/groups` at all.
            So the two members-only tabs render LOCKED rather than absent, and
            tapping one explains what opens it. */}
        <View style={styles.heroBlock}>
          <CommunityStadiumHero
            groupId={group.id}
            name={group.name}
            city={group.city}
            memberCount={group.memberCount}
            coverUrl={group.coverPhotoUrl}
            coverImageId={group.coverImageId}
            onBackPress={() => nav.goBack()}
            // No hamburger for a visitor — every item in it is an admin or
            // member action, so the button would open an empty sheet.
          />
          {/* Keep the shared hero and flush tabs adjacent. */}
          <ClubTabs
            flush
            tabs={[
              { key: 'info', label: he.clubTabInfo },
              { key: 'players', label: he.clubTabPlayers, locked: true },
              { key: 'stats', label: he.clubTabStats, locked: true },
            ]}
            active="info"
            onChange={() => {}}
            onLockedPress={() => toast.info(he.clubTabLockedBody)}
          />
        </View>

        {group.description ? <Card style={styles.section}>
          <View style={styles.titleRow}><Ionicons name="document-text-outline" size={23} color="#0B1942"/><Text style={styles.sectionTitle}>על המועדון</Text></View>
          <Text style={styles.bodyText}>{group.description}</Text>
        </Card> : null}

        {nextPublicGame ? (
          <NextGameCard
            publicPreview
            coverSource={resolveRoundCover(nextPublicGame, group, false, failedCover)}
            onCoverError={() => setFailedCover(group.coverPhotoUrl ?? null)}
            startsAt={nextPublicGame.startsAt}
            fieldName={nextPublicGame.fieldName ?? group.fieldName ?? ''}
            playersCount={nextPublicGame.players?.length}
            maxPlayers={nextPublicGame.maxPlayers}
            format={nextPublicGame.format}
            fieldType={nextPublicGame.fieldType}
          />
        ) : null}

        {fromInvitation ? <View style={styles.invitation}>
          <View style={styles.invitationIcon}><Ionicons name="mail-outline" size={30} color="#126649"/></View>
          <View style={styles.invitationCopy}><Text style={styles.invitationTitle}>יש לך הזמנה אישית</Text><Text style={styles.bodyText}>מנהל המועדון הזמין אותך להצטרף.</Text></View>
        </View> : null}



        <Button
          title={invitationLoading ? 'בודקים אם יש לך הזמנה…' : fromInvitation ? 'אישור הזמנה והצטרפות' : isPending ? he.groupsActionPending : cta}
          variant="primary"
          iconLeft={!invitationLoading && !fromInvitation && !isPending ? 'add' : undefined}
          size="lg"
          fullWidth
          loading={busyJoin || invitationLoading}
          disabled={ctaDisabled}
          onPress={handleJoin}
          style={styles.join}
        />
        {phoneValid ? (
          <Button
            title={he.communityDetailsContactAdmin}
            variant="outline"
            size="lg"
            fullWidth
            iconLeft="logo-whatsapp"
            onPress={() => {
              logEvent(AnalyticsEvent.CommunityContactAdminTapped, {
                groupId: group.id,
                channel: 'whatsapp',
                source: 'public_preview',
              });
              openWhatsApp(group.contactPhone);
            }}
          />
        ) : null}
        {isPending ? (
          <Button
            title={he.communityCancelJoinRequest}
            variant="outline"
            size="lg"
            fullWidth
            loading={busyJoin}
            onPress={handleCancelRequest}
          />
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  // Local club ground — cool and a step below white, so the cards on it
  // have an edge. See `clubSurface`.
  root: { flex: 1, backgroundColor: clubSurface.ground },
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xl },

  // The hero is full-bleed; the scroll's content container is not. Undo its
  // gutter for this one child rather than un-padding the whole page.
  // The hero is full-bleed; this scroll's content container is not. Undo its
  // gutter and its top padding for the hero block alone.
  heroBlock: {
    marginHorizontal: -spacing.lg,
    marginTop: -spacing.lg,
  },

  section: { gap: 10, borderRadius: 24, borderWidth: 1, borderColor: '#E0ECFB', shadowOpacity: 0.04, elevation: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  invitation: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: 24, borderWidth: 1, borderColor: '#BEECD8', backgroundColor: '#ECFAF4' },
  invitationIcon: { width: 50, height: 50, borderRadius: 25, backgroundColor: '#D8F5E9', alignItems: 'center', justifyContent: 'center' },
  invitationCopy: { flex: 1, gap: 5 },
  invitationTitle: { fontSize: 19, fontWeight: '800', color: '#07533A', textAlign: RTL_LABEL_ALIGN },
  join: { backgroundColor: '#2861F4', borderColor: '#2861F4', borderRadius: 18 },
  clubName: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.text,
    textAlign: RTL_LABEL_ALIGN,
  },
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
