// CommunityDetailsScreen — redesigned community overview.
//
// New structure (replaces the previous everything-on-one-screen blob):
//   ① Compact gradient header with name, location, מאמן badge,
//      hamburger button at top-leading
//   ② Pending-approvals callout (admin-only, when count > 0)
//   ③ 2×2 summary grid (members, days, hour, field)
//   ④ Slim notification toggle row (members)
//   ⑤ Next-game card (deep-link to MatchDetails)
//   ⑥ Players preview (5 jerseys + +N + nav to full list)
//   ⑦ Hamburger bottom sheet hosting all settings/destructive actions
//
// All long-text blocks (description / rules / notes), the recurring-
// game admin shortcut, contact-admin and community-share have been
// pulled off the main screen — they live in the hamburger menu (or
// the dedicated edit screen for admin-touch concerns).

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  RouteProp,
  useFocusEffect,
  useNavigation,
  useRoute,
} from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { SoccerBallLoader } from '@/components/SoccerBallLoader';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Button } from '@/components/Button';
import { ConfirmDestructiveModal } from '@/components/ConfirmDestructiveModal';
import { toast } from '@/components/Toast';
import {
  HamburgerMenu,
  type HamburgerSection,
} from '@/components/profile/HamburgerMenu';
import { CommunityHeader } from '@/components/community/CommunityHeader';
import { SummaryGrid } from '@/components/community/SummaryGrid';
import { NextGameCard } from '@/components/community/NextGameCard';
import { PlayersPreview } from '@/components/community/PlayersPreview';
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
  Group,
  User,
  WeekdayIndex,
} from '@/types';
import { colors, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
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
  const [loading, setLoading] = useState(true);
  const [busyLeave, setBusyLeave] = useState(false);
  const [busyRecurring, setBusyRecurring] = useState(false);
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
        return;
      }
      logEvent(AnalyticsEvent.GroupViewed, { groupId: g.id });
      const memberIds = Array.from(
        new Set([...g.adminIds, ...g.playerIds, ...g.pendingPlayerIds]),
      );
      const [users, games] = await Promise.all([
        groupService.hydrateUsers(memberIds),
        gameService
          .getCommunityGames(me?.id ?? '', [g.id])
          .catch(() => [] as Game[]),
      ]);
      const now = Date.now();
      const allUpcoming = games
        .filter(
          (x) => x.groupId === g.id && x.status === 'open' && x.startsAt > now,
        )
        .sort((a, b) => a.startsAt - b.startsAt);
      setMembers(users);
      setUpcoming(allUpcoming);
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

  const handleCreateRecurring = async () => {
    if (!group || !me || busyRecurring) return;
    const ts = nextOccurrence(group);
    if (!ts) {
      Alert.alert(he.error, he.communityDetailsRecurringNoConfig);
      return;
    }
    Alert.alert(
      he.communityDetailsCreateRecurringGame,
      `${recurringSummary(group)} · ${formatHebrewDate(ts)}`,
      [
        { text: he.cancel, style: 'cancel' },
        {
          text: he.communityDetailsRecurringConfirm,
          onPress: async () => {
            if (busyRecurring) return;
            setBusyRecurring(true);
            try {
              const r = await createRecurring(group, me.id);
              if (!r.ok) {
                Alert.alert(he.error, he.communityDetailsRecurringFailed);
              } else {
                await reload();
              }
            } finally {
              setBusyRecurring(false);
            }
          },
        },
      ],
    );
  };

  // ─── Render ────────────────────────────────────────────────────────────

  if (loading && !group) {
    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <ScreenHeader title={he.loading} />
        <View style={styles.center}>
          <SoccerBallLoader size={40} />
        </View>
      </SafeAreaView>
    );
  }

  if (!group) {
    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <ScreenHeader title={he.loading} />
        <View style={styles.center}>
          <Text style={styles.emptyText}>{he.communitiesEmpty}</Text>
        </View>
      </SafeAreaView>
    );
  }

  const location =
    [group.city, group.fieldAddress].filter(Boolean).join(' · ') || undefined;
  const nextGame = upcoming[0];

  // Single-section hamburger — no titles, ordered by importance.
  // Share moved out of the menu and into a primary CTA at the
  // bottom of the screen so members get a one-tap path to invite
  // friends without hunting for it.
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
                    'ProfileTab',
                    { screen: 'AdminApproval' },
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
        <SafeAreaView edges={['top']} style={styles.headerArea}>
          <CommunityHeader
            name={group.name}
            location={location}
            isAdmin={isAdmin}
            onMenuPress={() => setMenuOpen(true)}
          />
        </SafeAreaView>

        <View style={styles.body}>
          {/* ② Pending-approvals callout — admin only. Stays on the
              main screen because it's high-urgency; everything else
              that admin-touched moved to the hamburger. */}
          {isAdmin && group.pendingPlayerIds.length > 0 ? (
            <Pressable
              onPress={() =>
                (nav as { navigate: (s: string, p: unknown) => void }).navigate(
                  'ProfileTab',
                  { screen: 'AdminApproval' },
                )
              }
              style={({ pressed }) => [
                styles.approvalsCard,
                pressed && { opacity: 0.85 },
              ]}
              accessibilityRole="button"
            >
              <View style={styles.approvalsIcon}>
                <Ionicons name="alert-circle" size={20} color="#C2410C" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.approvalsTitle}>
                  {he.communityMenuApprovals}
                </Text>
                <Text style={styles.approvalsSub}>
                  {he.communityDetailsPendingTitle}{' '}
                  ({group.pendingPlayerIds.length})
                </Text>
              </View>
              <Ionicons name="chevron-back" size={18} color="#C2410C" />
            </Pressable>
          ) : null}

          {/* ③ Summary grid */}
          <SummaryGrid
            items={[
              {
                label: he.communitySummaryPlayers,
                value: String(group.playerIds?.length ?? 0),
                icon: 'people-outline',
              },
              {
                label: he.communitySummaryDays,
                value: formatDays(group.preferredDays) || '—',
                icon: 'calendar-outline',
              },
              {
                label: he.communitySummaryHour,
                value: group.preferredHour || '—',
                icon: 'time-outline',
              },
              {
                label: he.communitySummaryField,
                value: group.fieldName || '—',
                icon: 'football-outline',
              },
            ]}
          />

          {/* ④ Notification toggle — slim row, members only */}
          {isMember && me ? (
            <NotificationToggleRow
              userId={me.id}
              groupId={group.id}
              subscribed={(me.newGameSubscriptions ?? []).includes(group.id)}
            />
          ) : null}

          {/* ⑤ Next game */}
          <NextGameCard
            startsAt={nextGame?.startsAt}
            gameId={nextGame?.id}
            onPress={
              nextGame
                ? () =>
                    (nav as { navigate: (s: string, p: unknown) => void }).navigate(
                      'GameTab',
                      {
                        screen: 'MatchDetails',
                        params: { gameId: nextGame.id },
                      },
                    )
                : undefined
            }
          />

          {/* ⑥ Players preview */}
          <PlayersPreview
            total={group.playerIds?.length ?? 0}
            members={members.filter((u) => group.playerIds.includes(u.id))}
            onPress={() =>
              (nav as { navigate: (s: string, p: unknown) => void }).navigate(
                'CommunityPlayers',
                { groupId: group.id },
              )
            }
          />

          {/* ⑦ Share invite — primary CTA at the bottom for members.
              Pulled out of the hamburger so growing the community is
              a one-tap path. Hidden for non-members (they can't
              meaningfully invite to a group they aren't part of). */}
          {isMember || isAdmin ? (
            <Button
              title={he.communityMenuShareInvite}
              variant="primary"
              size="lg"
              fullWidth
              iconLeft="share-social-outline"
              onPress={handleInvite}
              style={{ marginTop: spacing.sm }}
            />
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

// ─── Slim notification-subscription row ─────────────────────────────────

function NotificationToggleRow({
  userId,
  groupId,
  subscribed: initial,
}: {
  userId: string;
  groupId: string;
  subscribed: boolean;
}) {
  const [subscribed, setSubscribed] = useState(initial);
  const flip = (next: boolean) => {
    setSubscribed(next);
    // Optimistic local store update so other screens see the change
    // immediately. The persist write is fire-and-forget.
    const me = useUserStore.getState().currentUser;
    if (me) {
      const cur = me.newGameSubscriptions ?? [];
      const updated = next
        ? Array.from(new Set([...cur, groupId]))
        : cur.filter((g) => g !== groupId);
      useUserStore.setState({
        currentUser: { ...me, newGameSubscriptions: updated },
      });
    }
    notificationsService.setCommunitySubscription(userId, groupId, next);
  };
  return (
    <Pressable
      onPress={() => flip(!subscribed)}
      style={({ pressed }) => [
        styles.notifyRow,
        pressed && { backgroundColor: colors.surfaceMuted },
      ]}
      accessibilityRole="switch"
      accessibilityState={{ checked: subscribed }}
    >
      <Ionicons
        name="notifications-outline"
        size={18}
        color={subscribed ? colors.primary : colors.textMuted}
      />
      <Text style={styles.notifyLabel} numberOfLines={1}>
        {he.communityNotifyRow}
      </Text>
      <Switch
        value={subscribed}
        onValueChange={flip}
        trackColor={{ false: colors.border, true: colors.primary }}
        thumbColor="#fff"
      />
    </Pressable>
  );
}

// ─── Helpers (recurring game) ───────────────────────────────────────────

function formatDays(days: WeekdayIndex[] | undefined): string {
  if (!days || days.length === 0) return '';
  return days
    .slice()
    .sort()
    .map((d) => he.availabilityDayShort[d])
    .join(', ');
}

function formatHebrewDate(ms: number): string {
  const d = new Date(ms);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(2);
  return `${dd}/${mm}/${yy}`;
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
function recurringSummary(g: Group): string {
  const dayIdx = effectiveRecurringDay(g);
  const time = effectiveRecurringTime(g);
  if (dayIdx === undefined || !time) return '';
  return `${he.availabilityDayShort[dayIdx]} · ${time}`;
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
async function createRecurring(
  group: Group,
  creatorId: string,
): Promise<{ ok: boolean; gameId?: string }> {
  const ts = nextOccurrence(group);
  if (!ts) return { ok: false };
  const fmt: import('@/types').GameFormat =
    group.recurringDefaultFormat ?? '5v5';
  const teams = group.recurringNumberOfTeams ?? 2;
  const perTeam = fmt === '5v5' ? 5 : fmt === '6v6' ? 6 : 7;
  try {
    const created = await import('@/services/gameService').then((m) =>
      m.gameService.createGameV2({
        groupId: group.id,
        title: group.name,
        startsAt: ts,
        fieldName: group.fieldName,
        maxPlayers: perTeam * teams,
        format: fmt,
        numberOfTeams: teams,
        cancelDeadlineHours: undefined,
        visibility: 'community',
        requiresApproval: !group.isOpen,
        bringBall: true,
        bringShirts: true,
        createdBy: creatorId,
      }),
    );
    return { ok: true, gameId: created.id };
  } catch {
    return { ok: false };
  }
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
  headerArea: {
    backgroundColor: '#15803D',
  },
  body: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    // More breathing room between cards. Was spacing.md (12) which
    // made the four cards stack visually crowded; lg (16) gives
    // each card room to read as its own unit.
    gap: spacing.lg,
  },
  // Approvals callout — high-priority admin shortcut
  approvalsCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: '#FED7AA',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: 14,
  },
  approvalsIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  approvalsTitle: {
    ...typography.body,
    color: '#9A3412',
    fontWeight: '800',
    textAlign: RTL_LABEL_ALIGN,
  },
  approvalsSub: {
    ...typography.caption,
    color: '#9A3412',
    textAlign: RTL_LABEL_ALIGN,
  },
  // Notification toggle row — slim, single line
  notifyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  notifyLabel: {
    ...typography.body,
    color: colors.text,
    fontWeight: '600',
    textAlign: RTL_LABEL_ALIGN,
    flex: 1,
  },
  // Loading-overlay during leave
  busyOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.6)',
  },
});
