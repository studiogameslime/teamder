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
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SoccerBallLoader } from '@/components/SoccerBallLoader';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  useFocusEffect,
  useNavigation,
  useRoute,
  RouteProp,
} from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';

import { ScreenHeader } from '@/components/ScreenHeader';
import { FriendActionButton } from '@/components/profile/FriendActionButton';
import { goToDirectChat } from '@/navigation/navigationRef';
import { dmConvId } from '@/services/chatService';
import { PlayerIdentity } from '@/components/PlayerIdentity';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { AchievementBadge } from '@/components/AchievementBadge';
import { TIER_META } from '@/data/achievements';
import { TrustMeter } from '@/components/TrustMeter';
import { InfoTip } from '@/components/InfoTip';
import { toast } from '@/components/Toast';
import type { Group } from '@/types';
import { userService } from '@/services';
import { gameService } from '@/services/gameService';
import { groupService } from '@/services/groupService';
import { notificationsService } from '@/services/notificationsService';
import {
  achievementsService,
  type NewlyUnlocked,
} from '@/services/achievementsService';
import { AchievementCelebration } from '@/components/AchievementCelebration';
import { trustService, type TrustSummary } from '@/services/trustService';
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';
import { logError } from '@/services/errorLog';
import { useCurrentGroup, useGroupStore } from '@/store/groupStore';
import {
  Game,
  getAttendanceRate,
  getCancelRate,
  User,
  UserAchievementState,
} from '@/types';
import { colors, radius, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import { useUserStore } from '@/store/userStore';

type RouteParams = {
  PlayerCard: {
    userId: string;
    /**
     * Optional community context. When set, the card shows the
     * viewed user's average rating in that community + a button to
     * cast/update the viewer's own vote.
     */
    groupId?: string;
  };
};

export function PlayerCardScreen() {
  const route = useRoute<RouteProp<RouteParams, 'PlayerCard'>>();
  const nav = useNavigation();
  const { userId, groupId: routeGroupId } = route.params ?? {
    userId: '',
    groupId: undefined,
  };
  const me = useUserStore((s) => s.currentUser);
  // Fallback to the user's currently active community when the caller
  // didn't pass an explicit groupId. This makes the rating section
  // available from any entry point (home tab, search, live match jersey,
  // etc.) — coaches and players alike can rate as long as a community
  // context exists.
  const currentGroup = useCurrentGroup();
  const groupId = routeGroupId ?? currentGroup?.id;
  // We can confirm the rated player's membership only when the group we'd
  // scope the rating to is the one currently loaded (its playerIds/adminIds
  // are in hand). For a different community named by the route param we have
  // no member list locally.
  const canVerifyMembership =
    !!groupId && !!currentGroup && currentGroup.id === groupId;
  const ratedIsInGroup =
    canVerifyMembership &&
    (currentGroup!.playerIds.includes(userId) ||
      currentGroup!.adminIds.includes(userId));
  // Only offer rating scoped to a group where the rules would actually let
  // the write through — the rated player must be a member there. When we can
  // verify locally, honour that check (so a non-member shows no rate UI even
  // if the route handed us a groupId). When we can't (cross-community), fall
  // back to trusting the explicit route param.
  const effectiveRatingGroupId = canVerifyMembership
    ? ratedIsInGroup
      ? groupId
      : undefined
    : routeGroupId;

  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyInvite, setBusyInvite] = useState(false);
  const [nextGame, setNextGame] = useState<Game | null>(null);
  const [gamesLoading, setGamesLoading] = useState(true);
  const [inviteSent, setInviteSent] = useState(false);
  // Successful referrals — count of users whose `invitedBy === userId`.
  // Loaded once per `userId` change (i.e. once per profile open) so
  // the screen doesn't re-query on every render. Failure → null,
  // which the UI hides instead of showing a misleading "0".
  const [referralCount, setReferralCount] = useState<number | null>(null);

  useEffect(() => {
    if (userId) logEvent(AnalyticsEvent.PlayerCardOpened, { userId });
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

  // Referral count: re-fetched on every screen focus so a new
  // referral that lands while the user is elsewhere in the app
  // shows up the moment they return to this card. We don't poll
  // and we don't depend on snapshot-listeners — focus-only
  // refresh is the right cadence for a stat the user expects to
  // be roughly current, not real-time. The first focus after
  // mount also serves as the initial load.
  useFocusEffect(
    React.useCallback(() => {
      let alive = true;
      userService
        .getInvitedUsersCount(userId)
        .then((n) => {
          if (alive) setReferralCount(n);
        })
        .catch((err) => {
          if (__DEV__) {
            console.warn('[playerCard] getInvitedUsersCount failed', err);
          }
          // Leave the previous count visible on transient failures
          // — flicker-back-to-loading on every focus would be worse
          // UX than a slightly stale number. On the very first
          // focus this stays at the initial null and the row
          // simply doesn't render.
        });
      return () => {
        alive = false;
      };
    }, [userId]),
  );

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
        <ScreenHeader title={he.loading} />
        <SoccerBallLoader size={40} style={{ marginTop: spacing.lg }} />
      </SafeAreaView>
    );
  }

  if (!user) {
    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <ScreenHeader title={he.loading} />
        <View style={styles.empty}>
          <Text style={styles.emptyText}>{he.playerCardNotFound}</Text>
        </View>
      </SafeAreaView>
    );
  }

  const inviteAvailable =
    user.availability?.isAvailableForInvites !== false;

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

  // Distinct viewing modes — looking at YOUR own card vs another
  // player's card. The "other" view is interpersonal: shared games,
  // shared communities, the option to invite. It deliberately drops
  // referral count, the in-line "rate this player" widget (rating
  // belongs in the post-match flow), achievements, and discipline
  // cards — all of which read as "your private profile bits" when
  // shown in someone else's context.
  const isSelfView = !!me && me.id === user.id;

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <ScreenHeader title={user.name} />
      <ScrollView contentContainerStyle={styles.content}>
        {isSelfView ? (
          <>
            <View style={styles.header}>
              <PlayerIdentity user={user} size="xl" showShirtName />
              <Text style={styles.name}>{user.name}</Text>
              {user.email ? (
                <Text style={styles.email}>{user.email}</Text>
              ) : null}
            </View>

            {/* Games/attendance/cancel removed — attendance % is no longer
                shown, and games already live on the Profile + Statistics
                screens (this row was the dead stored-stats source). */}

            {referralCount !== null && referralCount > 0 ? (
              <View style={styles.referralRow}>
                <StatTile
                  label={he.playerCardReferrals}
                  value={String(referralCount)}
                  tint={colors.primary}
                />
                <Text style={styles.referralHelper}>
                  {he.playerCardReferralsHelper}
                </Text>
              </View>
            ) : null}

            <AchievementsSection user={user} />
          </>
        ) : me ? (
          // ── Other-player card (per the owner's sketch) ──
          <>
            <OtherTopCard user={user} viewerId={me.id} />
            {/* H2H "played together" must be GLOBAL (all communities) to agree
                with the Statistics screen's "השותף הקבוע" — scoping it to the
                rating group made a card opened from one community show "no
                shared history" even when the two played together elsewhere
                (user report, 2026-06-21). The same-team / against rows come
                from the global pairStats doc, so they were never group-scoped. */}
            <PairStatsSection
              viewerId={me.id}
              otherId={user.id}
              otherName={user.name}
            />
          </>
        ) : (
          // Not signed in — minimal identity only.
          <View style={styles.header}>
            <PlayerIdentity user={user} size="xl" showShirtName />
            <Text style={styles.name}>{user.name}</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function StatTile({
  label,
  value,
  tint,
  icon,
}: {
  label: string;
  value: string;
  tint?: string;
  icon?: keyof typeof Ionicons.glyphMap;
}) {
  return (
    <Card style={styles.statTile}>
      {icon ? (
        <Ionicons name={icon} size={18} color={tint ?? colors.primary} style={styles.statTileIcon} />
      ) : null}
      <Text style={[styles.statValue, tint ? { color: tint } : null]}>
        {value}
      </Text>
      <Text style={styles.statLabel}>{label}</Text>
    </Card>
  );
}

/** Top profile card for the OTHER-player view: avatar + name on the right,
 *  "הוסף לחברים" on the left. (Player rating is internal-admin-only now and
 *  lives in the community players screen, not on the global player card.) */
function OtherTopCard({ user, viewerId }: { user: User; viewerId: string }) {
  return (
    <Card style={styles.topCard}>
      <View style={styles.topIdentity}>
        <PlayerIdentity user={user} size={62} />
        <View style={styles.topNameBlock}>
          <Text style={styles.topName} numberOfLines={1}>
            {user.name}
          </Text>
        </View>
      </View>
      <View style={styles.topButtons}>
        <View style={styles.topButtonHalf}>
          <FriendActionButton meId={viewerId} otherUserId={user.id} />
        </View>
        <View style={styles.topButtonHalf}>
          <Button
            title={he.dmSendMessage}
            variant="outline"
            size="sm"
            iconLeft="chatbubble-outline"
            onPress={() => goToDirectChat(dmConvId(viewerId, user.id))}
            fullWidth
          />
        </View>
      </View>
    </Card>
  );
}

/** Simple count row: [icon] label … big blue number. */
function H2hCountRow({
  icon,
  label,
  value,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
}) {
  return (
    <View style={styles.h2hRow}>
      <Ionicons name={icon} size={20} color={colors.primary} style={styles.h2hRowIcon} />
      <Text style={[styles.h2hLabel, styles.h2hFlex]} numberOfLines={1}>
        {label}
      </Text>
      <Text style={styles.h2hBigNum}>{value}</Text>
    </View>
  );
}

/** Record row (no graph): [icon] label+sub … wins(green)/losses(red). */
function H2hRecordRow({
  icon,
  label,
  rounds,
  wins,
  losses,
  wonLabel,
  lostLabel,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  rounds: number;
  wins: number;
  losses: number;
  wonLabel: string;
  lostLabel: string;
}) {
  return (
    <View style={styles.h2hRow}>
      <Ionicons name={icon} size={20} color={colors.primary} style={styles.h2hRowIcon} />
      <View style={[styles.h2hLabelCol, styles.h2hFlex]}>
        <Text style={styles.h2hLabel} numberOfLines={1}>
          {label}
        </Text>
        <Text style={styles.h2hSub}>{he.pairStatsRoundsCount(rounds)}</Text>
      </View>
      {/* Losses (red) on the right, wins (green) on the far left. */}
      <View style={styles.wlStats}>
        <View style={styles.wlStat}>
          <Text style={[styles.wlNum, { color: colors.danger }]}>{losses}</Text>
          <Text style={[styles.wlLabel, { color: colors.danger }]}>{lostLabel}</Text>
        </View>
        <View style={styles.wlStat}>
          <Text style={[styles.wlNum, { color: colors.success }]}>{wins}</Text>
          <Text style={[styles.wlLabel, { color: colors.success }]}>{wonLabel}</Text>
        </View>
      </View>
    </View>
  );
}

/** Date row: [calendar] label … date. */
function H2hDateRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.h2hRow}>
      <Ionicons name="calendar-outline" size={20} color={colors.primary} style={styles.h2hRowIcon} />
      <Text style={[styles.h2hLabel, styles.h2hFlex]} numberOfLines={1}>
        {label}
      </Text>
      <Text style={styles.h2hDate}>{value}</Text>
    </View>
  );
}

function CommunityChips({ groups }: { groups: Group[] }) {
  const nav = useNavigation<{ navigate: (s: string, p: object) => void }>();
  return (
    <View style={styles.commCard}>
      <View style={styles.commHeadRow}>
        <Ionicons name="people" size={16} color={colors.primary} />
        <Text style={styles.commHeader}>{he.pairStatsSharedCommunities}</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.commScroll}>
        {groups.map((g) => (
          // Tap a community chip → its page (user request).
          <Pressable
            key={g.id}
            style={({ pressed }) => [styles.commChip, pressed && { opacity: 0.7 }]}
            onPress={() => nav.navigate('CommunityDetails', { groupId: g.id })}
            accessibilityRole="button"
            accessibilityLabel={g.name}
          >
            {g.coverPhotoUrl ? (
              <Image source={{ uri: g.coverPhotoUrl }} style={styles.commLogo} />
            ) : (
              <View style={[styles.commLogo, styles.commLogoFallback]}>
                <Ionicons name="football" size={18} color={colors.primary} />
              </View>
            )}
            <Text style={styles.commName} numberOfLines={1}>
              {g.name}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

function PairStatsSection({
  viewerId,
  otherId,
  otherName,
  groupId,
}: {
  viewerId: string;
  otherId: string;
  otherName: string;
  groupId?: string;
}) {
  const ZERO = {
    registeredTogether: 0,
    attendedTogether: 0,
    firstSharedAt: null as number | null,
    lastSharedAt: null as number | null,
    sameTeam: 0,
    winsTogether: 0,
    lossesTogether: 0,
    against: 0,
    winsAgainst: 0,
    lossesAgainst: 0,
    assistedThem: 0,
    assistedMe: 0,
  };
  const [stats, setStats] = useState<typeof ZERO>(ZERO);
  const [sharedGroups, setSharedGroups] = useState<Group[]>([]);

  useEffect(() => {
    let alive = true;
    setStats(ZERO);
    setSharedGroups([]);
    gameService
      .getPairStats(viewerId, otherId, groupId)
      .then((s) => alive && setStats(s))
      .catch((err) => {
        if (__DEV__) console.warn('[pairStats] query failed', err);
      });
    groupService
      .findSharedCommunities(viewerId, otherId)
      .then((groups) => alive && setSharedGroups(groups))
      .catch((err) => {
        if (__DEV__) console.warn('[pairStats] shared-communities failed', err);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewerId, otherId, groupId]);

  const hasSharedGames =
    stats.registeredTogether > 0 || stats.attendedTogether > 0;

  return (
    <View style={styles.pairWrap}>
      {sharedGroups.length > 0 ? <CommunityChips groups={sharedGroups} /> : null}

      <Card style={styles.h2hCard}>
        <View style={styles.h2hTitleRow}>
          <Ionicons name="people" size={18} color={colors.primary} />
          <Text style={styles.h2hTitle}>{he.pairStatsTitle(otherName)}</Text>
        </View>

        {hasSharedGames ? (
          <>
            <H2hCountRow
              icon="clipboard-outline"
              label={he.pairStatsRegistered}
              value={String(stats.registeredTogether)}
            />
            <View style={styles.h2hDivider} />
            <H2hCountRow
              icon="checkmark-done-circle-outline"
              label={he.pairStatsAttended}
              value={String(stats.attendedTogether)}
            />
            {stats.sameTeam > 0 ? (
              <>
                <View style={styles.h2hDivider} />
                <H2hRecordRow
                  icon="people-outline"
                  label={he.pairStatsSameTeam}
                  rounds={stats.sameTeam}
                  wins={stats.winsTogether}
                  losses={stats.lossesTogether}
                  wonLabel={he.pairWonTogether}
                  lostLabel={he.pairLostTogether}
                />
              </>
            ) : null}
            {stats.against > 0 ? (
              <>
                <View style={styles.h2hDivider} />
                <H2hRecordRow
                  icon="git-compare-outline"
                  label={he.pairStatsAgainst}
                  rounds={stats.against}
                  wins={stats.winsAgainst}
                  losses={stats.lossesAgainst}
                  wonLabel={he.pairWonYou}
                  lostLabel={he.pairLostYou}
                />
              </>
            ) : null}
            {stats.assistedThem > 0 ? (
              <>
                <View style={styles.h2hDivider} />
                <H2hCountRow
                  icon="hand-left-outline"
                  label={he.pairAssistedThem}
                  value={String(stats.assistedThem)}
                />
              </>
            ) : null}
            {stats.assistedMe > 0 ? (
              <>
                <View style={styles.h2hDivider} />
                <H2hCountRow
                  icon="hand-right-outline"
                  label={he.pairAssistedYou}
                  value={String(stats.assistedMe)}
                />
              </>
            ) : null}
            {stats.lastSharedAt || stats.firstSharedAt ? (
              <>
                <View style={styles.h2hDivider} />
                <H2hDateRow
                  label={he.pairStatsLastShared}
                  value={formatPairDate((stats.lastSharedAt ?? stats.firstSharedAt) as number)}
                />
              </>
            ) : null}
          </>
        ) : (
          <Text style={styles.pairEmpty}>{he.pairStatsNoSharedHistory}</Text>
        )}
      </Card>
    </View>
  );
}

function formatPairDate(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleDateString('he-IL', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function AchievementsSection({ user }: { user: User }) {
  const [activeId, setActiveId] = useState<string | null>(null);
  // The stored `user.achievements` counters can be stale/inflated (legacy
  // join-bump path). For the viewer's OWN card we derive the real counters
  // from finished-game attendance — exactly like the "ההישגים שלי" screen —
  // so both places show the same count. For other users we can't read their
  // games/groups, so we fall back to the stored counters.
  const me = useUserStore((s) => s.currentUser);
  const groups = useGroupStore((s) => s.groups);
  const isMe = !!me && me.id === user.id;
  const [counters, setCounters] = useState<UserAchievementState | null>(null);
  const [celebrate, setCelebrate] = useState<NewlyUnlocked[]>([]);

  useEffect(() => {
    if (!isMe) {
      setCounters(null);
      return;
    }
    let alive = true;
    achievementsService
      .deriveCounters(user.id, {
        groups,
        friendsCount: me?.friends?.length ?? 0,
        goals: user.stats?.goals ?? 0,
        assists: user.stats?.assists ?? 0,
      })
      .then(async (c) => {
        if (!alive) return;
        setCounters(c);
        const fresh = await achievementsService.persistDerivedUnlocks(user.id, c);
        if (alive && fresh.length) setCelebrate(fresh);
      })
      .catch(() => {
        /* keep stored counters on failure */
      });
    return () => {
      alive = false;
    };
  }, [isMe, user.id, groups, me?.friends?.length]);

  const items = counters
    ? achievementsService.listFromCounters(user, counters)
    : achievementsService.list(user);
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
          {he.achievementsCount(unlockedCount, items.length)}
        </Text>
      </View>
      <View style={styles.achievementsGrid}>
        {ordered.map((item) => (
          <View key={item.def.id} style={styles.achievementsCell}>
            <AchievementBadge
              def={item.def}
              tier={item.currentTier?.tier ?? null}
              size={64}
              showTierLabel
              onPress={() => setActiveId(item.def.id)}
            />
          </View>
        ))}
      </View>
      {active ? (
        <Card style={styles.detailCard}>
          <Text style={styles.detailTitle}>{active.def.titleHe}</Text>
          {active.currentTier ? (
            <Text
              style={[
                styles.detailTier,
                { color: TIER_META[active.currentTier.tier].color },
              ]}
            >
              {he.achievementTierReached(TIER_META[active.currentTier.tier].he)}
            </Text>
          ) : null}
          <Text style={styles.detailDesc}>
            {active.next
              ? he.achievementProgressToNext(
                  Math.min(active.value, active.next.threshold),
                  active.next.threshold,
                  TIER_META[active.next.tier].he,
                )
              : he.achievementMaxed}
          </Text>
          {active.unlocked && active.unlockedAt ? (
            <Text style={styles.detailMeta}>
              {he.achievementUnlockedAt(formatHebrewDate(active.unlockedAt))}
            </Text>
          ) : !active.unlocked ? (
            <Text style={styles.detailMeta}>{he.achievementsLockedHint}</Text>
          ) : null}
        </Card>
      ) : null}
      {celebrate.length > 0 ? (
        <AchievementCelebration
          items={celebrate}
          onDone={() => setCelebrate([])}
        />
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
  // Content gap stays roomy between sections, but the header and
  // stats row need to feel like one "identity card" — they're
  // bridged via headerWrap/statsRow marginTop instead.
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xl },
  header: {
    alignItems: 'center',
    gap: spacing.xs,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    // Subtle surface band — anchors avatar+name visually and lets
    // the stats row sit just below as a continuation rather than
    // a disconnected row of tiles on a bare background.
    marginHorizontal: -spacing.lg,
    marginTop: -spacing.lg,
    paddingHorizontal: spacing.lg,
    backgroundColor: '#F4F6FB',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
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
  referralRow: {
    gap: spacing.xs,
    alignItems: 'stretch',
  },
  referralHelper: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
  },
  statTile: {
    flex: 1,
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: radius.lg,
  },
  statValue: { ...typography.h2, color: colors.text },
  statTileIcon: { marginBottom: 2 },
  statLabel: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  ctaCard: {
    gap: spacing.sm,
  },
  pairWrap: {
    gap: spacing.lg,
  },
  // ── Other-player top card ──
  topCard: { padding: spacing.md, gap: spacing.md },
  topIdentity: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  topNameBlock: { alignItems: 'flex-start', gap: 3 },
  topName: { ...typography.h3, color: colors.text, fontWeight: '800', textAlign: RTL_LABEL_ALIGN },
  topRatingRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 5 },
  topRatingNum: { ...typography.body, color: colors.text, fontWeight: '800' },
  topRatingCount: { ...typography.caption, color: colors.textMuted, textAlign: RTL_LABEL_ALIGN },
  // Two compact action buttons side-by-side under the identity row, each
  // taking half the width (was a full-width column that dwarfed the card).
  topButtons: { flexDirection: 'row', gap: spacing.sm, alignItems: 'stretch' },
  topButtonHalf: { flex: 1 },
  starRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 1 },
  // ── Shared-communities chips ──
  commCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  commHeadRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 6 },
  commHeader: { ...typography.bodyBold, color: colors.text, fontWeight: '800', textAlign: RTL_LABEL_ALIGN },
  commScroll: { flexDirection: 'row-reverse', gap: spacing.sm, paddingVertical: 2 },
  commChip: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
  },
  commLogo: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.surfaceMuted },
  commLogoFallback: { alignItems: 'center', justifyContent: 'center' },
  commName: { ...typography.body, color: colors.text, fontWeight: '700', textAlign: RTL_LABEL_ALIGN },
  // ── Head-to-head card ──
  h2hCard: { padding: spacing.md, gap: 0 },
  h2hTitleRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8, marginBottom: spacing.xs },
  h2hTitle: { ...typography.h3, color: colors.text, fontWeight: '800', textAlign: RTL_LABEL_ALIGN },
  h2hDivider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  h2hRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.md, minHeight: 56 },
  h2hRowIcon: { width: 22, textAlign: 'center' },
  h2hLabel: { ...typography.body, color: colors.text, fontWeight: '700', textAlign: RTL_LABEL_ALIGN },
  h2hFlex: { flex: 1, minWidth: 0 },
  h2hLabelCol: { gap: 1 },
  h2hSub: { ...typography.caption, color: colors.textMuted, textAlign: RTL_LABEL_ALIGN },
  h2hBigNum: { ...typography.h2, color: colors.primary, fontWeight: '900' },
  h2hDate: { ...typography.body, color: colors.text, fontWeight: '700' },
  wlStats: { flexDirection: 'row', gap: spacing.md },
  wlStat: { alignItems: 'center', minWidth: 34 },
  wlNum: { ...typography.h3, fontWeight: '900' },
  wlLabel: { ...typography.caption, fontWeight: '700' },
  pairTitleRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 6,
  },
  pairTitle: {
    ...typography.body,
    color: colors.text,
    fontWeight: '800',
    textAlign: RTL_LABEL_ALIGN,
  },
  pairSharedHeadRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 5 },
  pairH2HHeader: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '800',
    textAlign: RTL_LABEL_ALIGN,
  },
  // Head-to-head row: leading colored icon chip · label/sub · value.
  pairRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: spacing.sm },
  pairRowIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pairRowText: { flex: 1, minWidth: 0, gap: 1 },
  pairRowLabel: { ...typography.body, color: colors.text, fontWeight: '700', textAlign: RTL_LABEL_ALIGN },
  pairRowSubRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 4 },
  pairRowSub: { ...typography.caption, color: colors.textMuted },
  pairRowValue: { ...typography.body, color: colors.text, fontWeight: '800' },
  pairGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  pairEmptyCard: {
    padding: spacing.lg,
  },
  pairEmpty: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
  },
  pairSharedCard: {
    padding: spacing.md,
    gap: spacing.xs,
  },
  pairSharedHeader: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '700',
    textAlign: RTL_LABEL_ALIGN,
  },
  pairSharedList: {
    ...typography.body,
    color: colors.text,
    fontWeight: '600',
    textAlign: RTL_LABEL_ALIGN,
  },
  pairTimelineCard: {
    padding: spacing.md,
    gap: spacing.sm,
  },
  pairTimelineRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  pairTimelineLabel: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '700',
  },
  pairTimelineValue: {
    ...typography.body,
    color: colors.text,
    fontWeight: '600',
  },
  pairH2HSub: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: 1,
  },
  ratingTitleRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
  },
  ratingSection: {
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  ratingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  ratingValue: {
    ...typography.h2,
    color: colors.text,
    fontWeight: '700',
  },
  ratingCount: {
    ...typography.caption,
    color: colors.textMuted,
  },
  disciplineSection: { gap: spacing.sm },
  trustWrap: {
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
  },
  trustBreakdown: {
    alignItems: 'center',
    gap: 2,
    marginTop: spacing.xs,
  },
  disciplineHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  disciplineCaption: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
    marginTop: -spacing.xs,
  },
  disciplineUnavailable: {
    ...typography.caption,
    color: colors.textMuted,
    fontStyle: 'italic',
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
    textAlign: RTL_LABEL_ALIGN,
  },
  disciplineEventsCard: { gap: spacing.sm },
  eventListLabel: {
    ...typography.label,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
  },
  eventRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  eventReason: {
    ...typography.body,
    color: colors.text,
    textAlign: RTL_LABEL_ALIGN,
  },
  eventDate: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
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
    textAlign: RTL_LABEL_ALIGN,
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
    textAlign: RTL_LABEL_ALIGN,
  },
  detailTier: {
    ...typography.caption,
    fontWeight: '900',
    textAlign: RTL_LABEL_ALIGN,
  },
  detailDesc: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
  },
  detailMeta: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
  },
  unavailable: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
  },
  unavailableLink: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '700',
    textDecorationLine: 'underline',
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
