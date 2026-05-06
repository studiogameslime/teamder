// CommunityDetailsScreen — premium "stadium-style" community page.
//
// Layout (top → bottom, RTL):
//   ① Stadium hero (full-bleed photo + dark gradient + ⋯/☰ + name)
//   ② Floating 2×2 stats grid lifted onto the bottom of the hero
//   ③ Notification toggle row (members only)
//   ④ Next-game card — primary focus, dark blue gradient
//   ⑤ Active-players preview — horizontal jersey rail
//   ⑥ "שתף הזמנה לקהילה" gradient CTA (members only)
//
// All admin / destructive actions live behind the ☰ hamburger menu;
// the ⋯ overflow opens the same menu (a single source of truth keeps
// menu items consistent regardless of which icon the user tapped).

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  RouteProp,
  useFocusEffect,
  useNavigation,
  useRoute,
} from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { Ionicons } from '@expo/vector-icons';
import { Button } from '@/components/Button';
import { SoccerBallLoader } from '@/components/SoccerBallLoader';
import { ScreenHeader } from '@/components/ScreenHeader';
import { ConfirmDestructiveModal } from '@/components/ConfirmDestructiveModal';
import { toast } from '@/components/Toast';
import {
  HamburgerMenu,
  type HamburgerSection,
} from '@/components/profile/HamburgerMenu';
import { CommunityStadiumHero } from '@/components/community/CommunityStadiumHero';
import { CommunityStatsGrid } from '@/components/community/CommunityStatsGrid';
import { CommunityNotifyToggle } from '@/components/community/CommunityNotifyToggle';
import { NextGameCard } from '@/components/community/NextGameCard';
import { PlayersPreview } from '@/components/community/PlayersPreview';
import { CommunityShareInviteCta } from '@/components/community/CommunityShareInviteCta';
import { groupService } from '@/services';
import { gameService } from '@/services/gameService';
import { deepLinkService } from '@/services/deepLinkService';
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';
import { notificationsService } from '@/services/notificationsService';
import {
  isValidIsraeliPhone,
  openWhatsApp,
} from '@/services/whatsappService';
import {
  Game,
  GameSummary,
  Group,
  User,
  WeekdayIndex,
} from '@/types';
import { colors, spacing, typography } from '@/theme';
import { he } from '@/i18n/he';
import { useUserStore } from '@/store/userStore';
import { useGroupStore } from '@/store/groupStore';
import type { CommunitiesStackParamList } from '@/navigation/CommunitiesStack';

type Nav = NativeStackNavigationProp<
  CommunitiesStackParamList,
  'CommunityDetails'
>;
type Params = RouteProp<CommunitiesStackParamList, 'CommunityDetails'>;

export function CommunityDetailsScreen() {
  const nav = useNavigation<Nav>();
  const { groupId } = useRoute<Params>().params;
  const me = useUserStore((s) => s.currentUser);
  const leaveGroup = useGroupStore((s) => s.leaveGroup);
  const deleteGroup = useGroupStore((s) => s.deleteGroup);

  const [group, setGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<User[]>([]);
  const [upcoming, setUpcoming] = useState<Game[]>([]);
  const [history, setHistory] = useState<GameSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyLeave, setBusyLeave] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const g = await groupService.get(groupId);
      setGroup(g);
      if (!g) {
        setMembers([]);
        setUpcoming([]);
        setHistory([]);
        return;
      }
      logEvent(AnalyticsEvent.GroupViewed, { groupId: g.id });
      const memberIds = Array.from(
        new Set([...g.adminIds, ...g.playerIds, ...g.pendingPlayerIds]),
      );
      const [users, games, hist] = await Promise.all([
        groupService.hydrateUsers(memberIds),
        // ALL upcoming open games of THIS community (regardless of
        // whether the current user is registered) — this is the
        // correct read for the "next game" card. The discovery
        // helper `getCommunityGames` is wrong here because it
        // excludes games the user is already in, so admins/members
        // who'd already RSVP'd would either see no card or worse,
        // a card from a different community.
        gameService.getUpcomingGamesForGroup(g.id).catch(() => [] as Game[]),
        gameService.getHistory(g.id).catch(() => [] as GameSummary[]),
      ]);
      setMembers(users);
      setUpcoming(games);
      setHistory(hist);
    } finally {
      setLoading(false);
    }
  }, [groupId, me]);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );
  useEffect(() => {
    reload();
  }, [reload]);

  const isMember = useMemo(
    () => !!group && !!me && group.playerIds.includes(me.id),
    [group, me],
  );
  const isAdmin = useMemo(
    () => !!group && !!me && group.adminIds.includes(me.id),
    [group, me],
  );
  const phoneValid =
    !!group?.contactPhone && isValidIsraeliPhone(group.contactPhone);

  // ─── Action handlers ────────────────────────────────────────────────────

  const handleLeave = () => {
    if (!group || !me) return;
    if (group.adminIds.includes(me.id) && group.adminIds.length === 1) {
      Alert.alert(he.error, he.communityDetailsLeaveLastAdmin);
      return;
    }
    Alert.alert(
      he.communityDetailsLeaveConfirmTitle,
      he.communityDetailsLeaveConfirmBody,
      [
        { text: he.cancel, style: 'cancel' },
        {
          text: he.communityDetailsLeave,
          style: 'destructive',
          onPress: async () => {
            setBusyLeave(true);
            try {
              await leaveGroup(group.id, me.id);
              nav.goBack();
            } catch (e) {
              const msg = (e as Error).message;
              if (msg === 'LAST_ADMIN') {
                Alert.alert(he.error, he.communityDetailsLeaveLastAdmin);
              } else {
                Alert.alert(he.error, String(msg ?? e));
              }
            } finally {
              setBusyLeave(false);
            }
          },
        },
      ],
    );
  };

  const handleInvite = async () => {
    if (!group) return;
    try {
      const link = deepLinkService.buildInviteUrl({
        type: 'team',
        id: group.id,
        invitedBy: me?.id,
      });
      const result = await Share.share({
        title: he.inviteShareSubject,
        message: he.communityInviteShareBody(link),
      });
      if (result.action !== 'dismissedAction') {
        logEvent(AnalyticsEvent.InviteShared, { groupId: group.id });
      }
    } catch (err) {
      if (__DEV__) console.warn('[community] share failed', err);
    }
  };

  const handleCreateRecurring = () => {
    if (!group || !me) return;
    const ts = nextOccurrence(group);
    if (!ts) {
      Alert.alert(he.error, he.communityDetailsRecurringNoConfig);
      return;
    }
    // Open the create-game wizard pre-filled with the community's
    // recurring config. The wizard's recurring mode adds a required
    // "registrationOpensAt" picker at step 3 — the new game stays
    // hidden + closed for joins until that time. The previous
    // implementation called `createGameV2` directly with no UI step,
    // bypassing the wizard.
    (nav as { navigate: (s: string, p: unknown) => void }).navigate(
      'GameCreate',
      {
        recurring: true,
        groupId: group.id,
        startsAt: ts,
        format: group.recurringDefaultFormat,
        numberOfTeams: group.recurringNumberOfTeams,
      },
    );
  };

  const handleNotify = (next: boolean) => {
    if (!me || !group) return;
    // Optimistic local store update — other screens see the change
    // immediately. Persist write is fire-and-forget.
    const cur = me.newGameSubscriptions ?? [];
    const updated = next
      ? Array.from(new Set([...cur, group.id]))
      : cur.filter((g) => g !== group.id);
    useUserStore.setState({
      currentUser: { ...me, newGameSubscriptions: updated },
    });
    notificationsService.setCommunitySubscription(me.id, group.id, next);
  };

  // ─── Loading / empty states ─────────────────────────────────────────────

  if (loading && !group) {
    return (
      <View style={styles.root}>
        <ScreenHeader title={he.loading} />
        <View style={styles.center}>
          <SoccerBallLoader size={40} />
        </View>
      </View>
    );
  }

  if (!group) {
    // Group genuinely doesn't exist (deleted by admin or never
    // existed). Show a friendly fallback with an explicit way back
    // to the main communities feed — a deep-link entry has no
    // back-stack, so silent goBack would leave the user stranded.
    return (
      <View style={styles.root}>
        <ScreenHeader title={he.loading} />
        <View style={styles.center}>
          <Ionicons
            name="trash-outline"
            size={48}
            color={colors.textMuted}
          />
          <Text style={styles.emptyText}>
            {he.communityDetailsDeletedTitle}
          </Text>
          <Text style={[styles.emptyText, { marginTop: spacing.sm }]}>
            {he.communityDetailsDeletedBody}
          </Text>
          <Button
            title={he.deletedTargetBackToMain}
            variant="primary"
            size="lg"
            style={{ marginTop: spacing.lg }}
            onPress={() => {
              const navAny = nav as unknown as { navigate: (s: string, p?: unknown) => void };
              navAny.navigate('CommunitiesTab', {
                screen: 'CommunitiesFeed',
              });
            }}
          />
        </View>
      </View>
    );
  }

  const nextGame = upcoming[0];
  const matchesHeld = history.filter((h) => h.status === 'finished').length;

  // Hamburger menu — all admin / destructive / contact actions live
  // here. The ⋯ overflow opens the same sheet so users get one mental
  // model: "more actions live in the menu".
  const sections: HamburgerSection[] = [
    {
      id: 'main',
      items: [
        ...(isAdmin
          ? [
              {
                id: 'edit',
                label: he.communityEditTitle,
                icon: 'create-outline' as const,
                onPress: () =>
                  (nav as { navigate: (s: string, p: unknown) => void }).navigate(
                    'CommunityEdit',
                    { groupId: group.id },
                  ),
              },
            ]
          : []),
        ...(isAdmin && hasRecurringInfo(group)
          ? [
              {
                id: 'recurring',
                label: he.communityMenuRecurringGame,
                icon: 'repeat-outline' as const,
                onPress: handleCreateRecurring,
              },
            ]
          : []),
        ...(isAdmin && group.pendingPlayerIds.length > 0
          ? [
              {
                id: 'approvals',
                label: he.communityMenuApprovals,
                icon: 'shield-checkmark-outline' as const,
                badge: group.pendingPlayerIds.length,
                onPress: () =>
                  (nav as { navigate: (s: string, p: unknown) => void }).navigate(
                    'AdminApproval',
                    undefined,
                  ),
              },
            ]
          : []),
        {
          id: 'allPlayers',
          label: he.communityPlayersSeeAll,
          icon: 'people-outline' as const,
          onPress: () =>
            (nav as { navigate: (s: string, p: unknown) => void }).navigate(
              'CommunityPlayers',
              { groupId: group.id },
            ),
        },
        ...(phoneValid && !isAdmin
          ? [
              {
                id: 'whatsapp',
                label: he.communityMenuContactAdmin,
                icon: 'logo-whatsapp' as const,
                onPress: () => openWhatsApp(group.contactPhone),
              },
            ]
          : []),
        ...(isMember || isAdmin
          ? [
              {
                id: 'leave',
                label: he.communityDetailsLeave,
                icon: 'exit-outline' as const,
                onPress: handleLeave,
                tone: 'danger' as const,
              },
            ]
          : []),
        ...(isAdmin
          ? [
              {
                id: 'delete',
                label: he.deleteGroupTitle,
                icon: 'trash-outline' as const,
                onPress: () => setDeleteOpen(true),
                tone: 'danger' as const,
              },
            ]
          : []),
      ],
    },
  ];

  const openMenu = () => setMenuOpen(true);

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={reload}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        {/* ① Stadium hero */}
        <CommunityStadiumHero
          name={group.name}
          memberCount={group.playerIds?.length ?? 0}
          onBackPress={() => nav.goBack()}
          onMenuPress={openMenu}
        />

        {/* ② Floating stats grid — pulled UP via negative margin so it
            overlaps the bottom of the hero (the hero leaves a 56px
            strip of stadium for exactly this overlap zone). Trimmed
            to two stats: founding date and matches held. The other
            two metrics moved elsewhere — member count is now a pill
            badge under the title in the hero, and the regular field
            is shown on each game card already. */}
        <View style={styles.statsFloat}>
          <CommunityStatsGrid
            items={[
              {
                icon: 'calendar',
                label: he.communityStatsCreatedAt,
                value: formatShortDate(group.createdAt),
              },
              {
                icon: 'football',
                label: he.communityStatsMatchesHeld,
                value: matchesHeld > 0 ? String(matchesHeld) : '—',
              },
            ]}
          />
        </View>

        <View style={styles.body}>
          {/* ③ Notification toggle — members only */}
          {isMember && me ? (
            <CommunityNotifyToggle
              subscribed={(me.newGameSubscriptions ?? []).includes(group.id)}
              onChange={handleNotify}
            />
          ) : null}

          {/* ④ Next game — main focus.
               Navigates within THIS stack (CommunitiesStack now hosts
               MatchDetails too) so back returns to CommunityDetails.
               Crossing into GameTab would dump the user on GamesList
               on back.
               If the next game is still in `scheduled` status (its
               `registrationOpensAt` is in the future), tapping the
               card pops a small Alert telling the user when
               registration opens — admins can still navigate to the
               edit screen via the overflow menu, but anyone (admins
               included) sees the same lock UI on the card. */}
          <NextGameCard
            startsAt={nextGame?.startsAt}
            fieldName={nextGame?.fieldName ?? group.fieldName}
            registrationOpensAt={
              nextGame?.status === 'scheduled'
                ? nextGame.registrationOpensAt
                : undefined
            }
            onPress={
              nextGame
                ? () => {
                    if (
                      nextGame.status === 'scheduled' &&
                      typeof nextGame.registrationOpensAt === 'number'
                    ) {
                      const d = new Date(nextGame.registrationOpensAt);
                      const dd = String(d.getDate()).padStart(2, '0');
                      const mm = String(d.getMonth() + 1).padStart(2, '0');
                      const hh = String(d.getHours()).padStart(2, '0');
                      const mn = String(d.getMinutes()).padStart(2, '0');
                      Alert.alert(
                        he.communityNextGameLocked,
                        he.communityNextGameLockedBody(
                          `${dd}.${mm} ${hh}:${mn}`,
                        ),
                      );
                      return;
                    }
                    nav.navigate('MatchDetails', { gameId: nextGame.id });
                  }
                : undefined
            }
          />

          {/* ⑤ Players preview */}
          <PlayersPreview
            total={group.playerIds?.length ?? 0}
            members={members.filter((u) => group.playerIds.includes(u.id))}
            onSeeAll={() =>
              (nav as { navigate: (s: string, p: unknown) => void }).navigate(
                'CommunityPlayers',
                { groupId: group.id },
              )
            }
            onPressMember={(uid) =>
              (nav as { navigate: (s: string, p: unknown) => void }).navigate(
                'PlayerCard',
                { userId: uid, groupId: group.id },
              )
            }
          />

          {/* ⑥ Share-invite CTA — members & admins only */}
          {isMember || isAdmin ? (
            <CommunityShareInviteCta onPress={handleInvite} />
          ) : null}
        </View>
      </ScrollView>

      <HamburgerMenu
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        sections={sections}
      />

      <ConfirmDestructiveModal
        visible={deleteOpen}
        title={he.deleteGroupTitle}
        body={he.deleteGroupBody}
        onClose={() => setDeleteOpen(false)}
        onConfirm={async () => {
          if (!me) return;
          try {
            await deleteGroup(group.id, me.id);
            setDeleteOpen(false);
            toast.success(he.deleteGroupSuccess);
            nav.goBack();
          } catch (err) {
            if (__DEV__) console.warn('[community] delete failed', err);
            toast.error(he.error);
          }
        }}
      />

      {busyLeave ? (
        <View style={styles.busyOverlay} pointerEvents="none">
          <SoccerBallLoader size={36} />
        </View>
      ) : null}
    </View>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function formatShortDate(ms: number): string {
  const d = new Date(ms);
  return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${String(
    d.getFullYear(),
  ).slice(2)}`;
}

function effectiveRecurringDay(g: Group): WeekdayIndex | undefined {
  if (typeof g.recurringDayOfWeek === 'number') return g.recurringDayOfWeek;
  return g.preferredDays?.[0];
}
function effectiveRecurringTime(g: Group): string | undefined {
  return g.recurringTime || g.preferredHour;
}
function hasRecurringInfo(g: Group): boolean {
  return !!effectiveRecurringDay(g) && !!effectiveRecurringTime(g);
}
function nextOccurrence(g: Group): number | null {
  const dayIdx = effectiveRecurringDay(g);
  const time = effectiveRecurringTime(g);
  if (dayIdx === undefined || !time) return null;
  const [hh, mm] = time.split(':').map((n) => parseInt(n, 10));
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  const now = new Date();
  const target = new Date(now);
  const delta = (dayIdx - now.getDay() + 7) % 7;
  target.setDate(now.getDate() + (delta === 0 ? 7 : delta));
  target.setHours(hh, mm, 0, 0);
  return target.getTime();
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: {
    paddingBottom: spacing.xxl,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
  },
  // Pulls the stats grid up onto the bottom of the stadium hero. The
  // hero leaves 56px of paddingBottom for this overlap; if you tweak
  // one of these, tweak the other in tandem.
  statsFloat: {
    paddingHorizontal: spacing.lg,
    marginTop: -42,
  },
  body: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    gap: spacing.lg,
  },
  busyOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.6)',
  },
});
