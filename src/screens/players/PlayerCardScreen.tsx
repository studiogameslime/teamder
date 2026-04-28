// PlayerCardScreen — read-only profile of any user in the system.
//
// Inputs (route param): userId. Outputs: avatar + name + email + 3 stats
// derived from the raw counters via getAttendanceRate / getCancelRate.
//
// "Invite to Game" CTA is intentionally a stub for v1 — the actual invite
// flow (organizer picks a game, target accepts) is post-MVP. Disabled
// when the target user has `availability.isAvailableForInvites === false`.

import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRoute, useNavigation, RouteProp } from '@react-navigation/native';

import { ScreenHeader } from '@/components/ScreenHeader';
import { PlayerIdentity } from '@/components/PlayerIdentity';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { AchievementBadge } from '@/components/AchievementBadge';
import { DisciplineCards } from '@/components/DisciplineCards';
import { userService } from '@/services';
import { gameService } from '@/services/gameService';
import { notificationsService } from '@/services/notificationsService';
import { achievementsService } from '@/services/achievementsService';
import { disciplineService } from '@/services/disciplineService';
import { useGroupStore } from '@/store/groupStore';
import {
  Game,
  getAttendanceRate,
  getCancelRate,
  User,
} from '@/types';
import { colors, radius, spacing, typography } from '@/theme';
import { he } from '@/i18n/he';
import { useUserStore } from '@/store/userStore';

type RouteParams = { PlayerCard: { userId: string } };

export function PlayerCardScreen() {
  const route = useRoute<RouteProp<RouteParams, 'PlayerCard'>>();
  const nav = useNavigation();
  const { userId } = route.params ?? { userId: '' };
  const me = useUserStore((s) => s.currentUser);

  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyInvite, setBusyInvite] = useState(false);
  const [nextGame, setNextGame] = useState<Game | null>(null);
  const [gamesLoading, setGamesLoading] = useState(true);
  const [inviteSent, setInviteSent] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    userService
      .getUserById(userId)
      .then((u) => {
        if (alive) setUser(u);
      })
      .catch(() => {
        if (alive) setUser(null);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [userId]);

  // Re-fetch on demand — used by the discipline override actions so the
  // UI reflects the new counters without a full screen pop / push.
  const reloadUser = async () => {
    const u = await userService.getUserById(userId);
    setUser(u);
  };

  // Pre-load the inviter's next admin-organized game so the CTA can
  // reflect the target's actual status (joined / waitlist / pending)
  // instead of a generic "Invite" that fires a duplicate notification.
  useEffect(() => {
    if (!me) {
      setGamesLoading(false);
      return;
    }
    let alive = true;
    setGamesLoading(true);
    gameService
      .getMyGames(me.id)
      .then((mine) => {
        if (!alive) return;
        const next = mine
          .filter(
            (g) =>
              g.createdBy === me.id &&
              g.status === 'open' &&
              g.startsAt > Date.now()
          )
          .sort((a, b) => a.startsAt - b.startsAt)[0];
        setNextGame(next ?? null);
      })
      .catch(() => {
        if (alive) setNextGame(null);
      })
      .finally(() => {
        if (alive) setGamesLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [me?.id]);

  if (loading) {
    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <ScreenHeader title="" />
        <ActivityIndicator
          size="small"
          color={colors.primary}
          style={{ marginTop: spacing.lg }}
        />
      </SafeAreaView>
    );
  }

  if (!user) {
    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <ScreenHeader title="" />
        <View style={styles.empty}>
          <Text style={styles.emptyText}>{he.playerCardNotFound}</Text>
        </View>
      </SafeAreaView>
    );
  }

  const inviteAvailable =
    user.availability?.isAvailableForInvites !== false;
  const attendance = getAttendanceRate(user.stats);
  const cancelRate = getCancelRate(user.stats);
  const total = user.stats?.totalGames ?? 0;

  // Compute *why* the invite CTA is unavailable, in priority order, so
  // we can show a single explicit reason next to the button instead of
  // a generic disabled state. Returns null when the CTA should fire.
  const isSelf = !!me && me.id === user.id;
  const alreadyInGame: 'players' | 'waitlist' | 'pending' | null = (() => {
    if (!nextGame) return null;
    if ((nextGame.players ?? []).includes(user.id)) return 'players';
    if ((nextGame.waitlist ?? []).includes(user.id)) return 'waitlist';
    if ((nextGame.pending ?? []).includes(user.id)) return 'pending';
    return null;
  })();
  const blockedReason: string | null = isSelf
    ? he.playerCardSelf
    : !inviteAvailable
    ? he.playerCardNotAvailable
    : alreadyInGame === 'players'
    ? he.playerCardAlreadyJoined
    : alreadyInGame === 'waitlist'
    ? he.playerCardAlreadyWaitlist
    : alreadyInGame === 'pending'
    ? he.playerCardAlreadyPending
    : !nextGame && !gamesLoading
    ? he.playerCardNoGameToInvite
    : null;
  const canInvite = !blockedReason && !!nextGame && !inviteSent && !!me;

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <ScreenHeader title={user.name} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <PlayerIdentity
            user={user}
            size="xl"
            showShirtName
            highlight
          />
          <Text style={styles.name}>{user.name}</Text>
          {user.email ? <Text style={styles.email}>{user.email}</Text> : null}
        </View>

        <View style={styles.statsRow}>
          <StatTile label={he.playerCardTotalGames} value={String(total)} />
          <StatTile
            label={he.playerCardAttendance}
            value={`${attendance}%`}
            tint={colors.success}
          />
          <StatTile
            label={he.playerCardCancelRate}
            value={`${cancelRate}%`}
            tint={cancelRate > 30 ? colors.danger : colors.textMuted}
          />
        </View>

        <DisciplineSection
          user={user}
          viewerId={me?.id}
          onChange={reloadUser}
        />

        <AchievementsSection user={user} />

        <Card style={styles.ctaCard}>
          <Button
            title={
              inviteSent
                ? he.playerCardInviteSent
                : gamesLoading
                ? he.playerCardLoadingGame
                : he.playerCardInvite
            }
            variant="primary"
            size="lg"
            fullWidth
            loading={busyInvite || gamesLoading}
            disabled={!canInvite || busyInvite}
            onPress={async () => {
              if (!canInvite || !me || !user || !nextGame) return;
              setBusyInvite(true);
              try {
                await notificationsService.inviteToGame({
                  recipientId: user.id,
                  gameId: nextGame.id,
                  gameTitle: nextGame.title,
                  inviterName: me.name,
                  startsAt: nextGame.startsAt,
                });
                // Best-effort: bump the inviter's invite counter so the
                // "Invited X" achievements unlock on threshold. Failure
                // here doesn't roll back the user-visible invite send.
                achievementsService.bump(me.id, 'invitesSent', 1);
                // Lock the button so a second tap can't dispatch a
                // duplicate invite for the same game/recipient pair.
                setInviteSent(true);
              } catch (err) {
                if (__DEV__) console.warn('[PlayerCard] invite failed', err);
                Alert.alert(he.error, he.playerCardInviteFailed);
              } finally {
                setBusyInvite(false);
              }
            }}
          />
          {inviteSent ? (
            <Text style={styles.success}>
              {he.playerCardInviteSentToast.replace('{name}', user.name)}
            </Text>
          ) : blockedReason ? (
            <Text style={styles.unavailable}>{blockedReason}</Text>
          ) : null}
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

function StatTile({
  label,
  value,
  tint,
}: {
  label: string;
  value: string;
  tint?: string;
}) {
  return (
    <Card style={styles.statTile}>
      <Text style={[styles.statValue, tint ? { color: tint } : null]}>
        {value}
      </Text>
      <Text style={styles.statLabel}>{label}</Text>
    </Card>
  );
}

function DisciplineSection({
  user,
  viewerId,
  onChange,
}: {
  user: User;
  viewerId?: string;
  onChange: () => Promise<void>;
}) {
  const [busy, setBusy] = useState<null | 'yellow' | 'red' | string>(null);
  const groups = useGroupStore((s) => s.groups);
  const state = disciplineService.state(user);
  // Coach controls show ONLY when the viewer admins a group that the
  // viewed user is a member of (and the viewer isn't viewing their own
  // card). Showing them on every Player Card was too permissive — a
  // coach of group A would see issue/revoke buttons on a member of
  // group B. The Firestore rule still allows the write, but the UI
  // shouldn't expose the surface.
  const sharesGroupAsAdmin =
    !!viewerId &&
    viewerId !== user.id &&
    groups.some(
      (g) =>
        g.adminIds.includes(viewerId) &&
        (g.playerIds.includes(user.id) || g.adminIds.includes(user.id)),
    );
  const isAnyAdmin = sharesGroupAsAdmin;

  // "Recent red" warning if a red card was issued in the last 30 days.
  const RECENT_MS = 30 * 24 * 60 * 60 * 1000;
  const hasRecentRed = state.events.some(
    (e) => e.type === 'red' && Date.now() - e.createdAt < RECENT_MS,
  );

  const issue = async (type: 'yellow' | 'red') => {
    setBusy(type);
    try {
      await disciplineService.issueCard({
        userId: user.id,
        type,
        reason: 'manual',
        issuedBy: viewerId,
      });
      await onChange();
    } finally {
      setBusy(null);
    }
  };

  const revoke = (eventId: string) => {
    Alert.alert(he.disciplineConfirmRevoke, '', [
      { text: he.cancel, style: 'cancel' },
      {
        text: he.disciplineRevoke,
        style: 'destructive',
        onPress: async () => {
          setBusy(eventId);
          try {
            await disciplineService.revokeCard(user.id, eventId);
            await onChange();
          } finally {
            setBusy(null);
          }
        },
      },
    ]);
  };

  return (
    <View style={styles.disciplineSection}>
      <View style={styles.disciplineHeader}>
        <Text style={styles.achievementsTitle}>{he.disciplineTitle}</Text>
        <DisciplineCards
          yellowCards={state.yellowCards}
          redCards={state.redCards}
          size={32}
        />
      </View>
      {hasRecentRed ? (
        <View style={styles.warningPill}>
          <Text style={styles.warningPillText}>
            {he.disciplineWarningRecentRed}
          </Text>
        </View>
      ) : null}

      {state.events.length === 0 ? (
        <Text style={styles.emptyHint}>{he.disciplineNoCards}</Text>
      ) : (
        <Card style={styles.disciplineEventsCard}>
          <Text style={styles.eventListLabel}>{he.disciplineRecent}</Text>
          {state.events.slice(0, 5).map((e) => (
            <View key={e.id} style={styles.eventRow}>
              <DisciplineCards
                yellowCards={e.type === 'yellow' ? 1 : 0}
                redCards={e.type === 'red' ? 1 : 0}
                size={22}
                hideEmpty
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.eventReason}>
                  {reasonLabel(e.reason)}
                </Text>
                <Text style={styles.eventDate}>
                  {formatHebrewDate(e.createdAt)}
                </Text>
              </View>
              {isAnyAdmin ? (
                <Button
                  title={he.disciplineRevoke}
                  variant="outline"
                  size="sm"
                  loading={busy === e.id}
                  onPress={() => revoke(e.id)}
                />
              ) : null}
            </View>
          ))}
        </Card>
      )}

      {isAnyAdmin ? (
        <View style={styles.coachActions}>
          <Text style={styles.coachActionsLabel}>
            {he.disciplineCoachActions}
          </Text>
          <View style={styles.coachActionsRow}>
            <Button
              title={he.disciplineGiveYellow}
              variant="outline"
              size="sm"
              loading={busy === 'yellow'}
              onPress={() => issue('yellow')}
              fullWidth
              style={{ flex: 1 }}
            />
            <Button
              title={he.disciplineGiveRed}
              variant="outline"
              size="sm"
              loading={busy === 'red'}
              onPress={() => issue('red')}
              fullWidth
              style={{ flex: 1 }}
            />
          </View>
        </View>
      ) : null}
    </View>
  );
}

function reasonLabel(r: 'late' | 'no_show' | 'manual'): string {
  if (r === 'late') return he.disciplineReasonLate;
  if (r === 'no_show') return he.disciplineReasonNoShow;
  return he.disciplineReasonManual;
}

function AchievementsSection({ user }: { user: User }) {
  const [activeId, setActiveId] = useState<string | null>(null);
  // Compute on every render — list() is a pure read over user.achievements.
  // Cheap; ACHIEVEMENTS has ~13 entries.
  const items = achievementsService.list(user);
  const active = activeId ? items.find((i) => i.def.id === activeId) : null;

  // Sort: unlocked first (by category order in the catalog), locked
  // after. Within each, preserve catalog order.
  const ordered = [...items].sort((a, b) => {
    if (a.unlocked === b.unlocked) return 0;
    return a.unlocked ? -1 : 1;
  });

  const unlockedCount = items.filter((i) => i.unlocked).length;

  return (
    <View style={styles.achievementsSection}>
      <View style={styles.achievementsHeader}>
        <Text style={styles.achievementsTitle}>{he.achievementsTitle}</Text>
        <Text style={styles.achievementsCount}>
          {unlockedCount} / {items.length}
        </Text>
      </View>
      <View style={styles.achievementsGrid}>
        {ordered.map((item) => (
          <View key={item.def.id} style={styles.achievementsCell}>
            <AchievementBadge
              def={item.def}
              unlocked={item.unlocked}
              size={64}
              onPress={() => setActiveId(item.def.id)}
            />
          </View>
        ))}
      </View>
      {active ? (
        <Card style={styles.detailCard}>
          <Text style={styles.detailTitle}>{active.def.titleHe}</Text>
          <Text style={styles.detailDesc}>{active.def.descriptionHe}</Text>
          {active.unlocked && active.unlockedAt ? (
            <Text style={styles.detailMeta}>
              {he.achievementUnlockedAt(formatHebrewDate(active.unlockedAt))}
            </Text>
          ) : !active.unlocked ? (
            <Text style={styles.detailMeta}>{he.achievementsLockedHint}</Text>
          ) : null}
        </Card>
      ) : null}
    </View>
  );
}

function formatHebrewDate(ms: number): string {
  const d = new Date(ms);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(2);
  return `${dd}/${mm}/${yy}`;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xl },
  header: { alignItems: 'center', gap: spacing.xs },
  name: {
    ...typography.h2,
    color: colors.text,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  email: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
  },
  statsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  statTile: {
    flex: 1,
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: radius.lg,
  },
  statValue: { ...typography.h2, color: colors.text },
  statLabel: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  ctaCard: {
    gap: spacing.sm,
  },
  disciplineSection: { gap: spacing.sm },
  disciplineHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  warningPill: {
    backgroundColor: '#FEE2E2',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
  },
  warningPillText: {
    ...typography.caption,
    color: colors.danger,
    fontWeight: '700',
  },
  emptyHint: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'right',
  },
  disciplineEventsCard: { gap: spacing.sm },
  eventListLabel: {
    ...typography.label,
    color: colors.textMuted,
    textAlign: 'right',
  },
  eventRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  eventReason: {
    ...typography.body,
    color: colors.text,
    textAlign: 'right',
  },
  eventDate: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'right',
  },
  coachActions: { gap: spacing.xs },
  coachActionsLabel: {
    ...typography.label,
    color: colors.textMuted,
    textAlign: 'right',
  },
  coachActionsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  achievementsSection: {
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  achievementsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  achievementsTitle: {
    ...typography.h3,
    color: colors.text,
    textAlign: 'right',
  },
  achievementsCount: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '600',
  },
  achievementsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: spacing.md,
    rowGap: spacing.lg,
    justifyContent: 'center',
  },
  achievementsCell: {
    width: 80,
    alignItems: 'center',
  },
  detailCard: {
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  detailTitle: {
    ...typography.bodyBold,
    color: colors.text,
    textAlign: 'right',
  },
  detailDesc: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'right',
  },
  detailMeta: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'right',
  },
  unavailable: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
  },
  success: {
    ...typography.caption,
    color: colors.success,
    textAlign: 'center',
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
