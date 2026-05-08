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
import { PlayerIdentity } from '@/components/PlayerIdentity';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { AchievementBadge } from '@/components/AchievementBadge';
import { DisciplineCards } from '@/components/DisciplineCards';
import { RatingModal } from '@/components/RatingModal';
import { toast } from '@/components/Toast';
import { ratingsService } from '@/services/ratingsService';
import type { GroupRatingSummary } from '@/types';
import { userService } from '@/services';
import { gameService } from '@/services/gameService';
import { groupService } from '@/services/groupService';
import { notificationsService } from '@/services/notificationsService';
import { achievementsService } from '@/services/achievementsService';
import { disciplineService } from '@/services/disciplineService';
import { useCurrentGroup } from '@/store/groupStore';
import {
  Game,
  getAttendanceRate,
  getCancelRate,
  User,
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
  const ratedIsInGroup =
    !!groupId &&
    !!currentGroup &&
    currentGroup.id === groupId &&
    (currentGroup.playerIds.includes(userId) ||
      currentGroup.adminIds.includes(userId));
  const effectiveRatingGroupId =
    routeGroupId ?? (ratedIsInGroup ? groupId : undefined);

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
        <View style={styles.header}>
          <PlayerIdentity user={user} size="xl" showShirtName />
          <Text style={styles.name}>{user.name}</Text>
          {/* Email is intentionally only shown on YOUR own card. It's
              PII and there's no use case for surfacing it on
              someone else's profile. */}
          {isSelfView && user.email ? (
            <Text style={styles.email}>{user.email}</Text>
          ) : null}
        </View>

        {/* Dry facts about the player. Shown for both self and other
            views — they're factual ("how reliable is this person?")
            and don't read as private. The "other" view skips the
            sections that are inherently personal: rating widget,
            achievements, discipline cards. */}
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

        {referralCount !== null && referralCount > 0 ? (
          <View style={styles.referralRow}>
            <StatTile
              label={he.playerCardReferrals}
              value={String(referralCount)}
              tint={colors.primary}
            />
            <Text style={styles.referralHelper}>
              {isSelfView
                ? he.playerCardReferralsHelper
                : he.playerCardReferralsHelperOther}
            </Text>
          </View>
        ) : null}

        {isSelfView ? (
          <>
            {effectiveRatingGroupId ? (
              <RatingSection
                groupId={effectiveRatingGroupId}
                viewerId={me?.id ?? null}
                ratedUser={user}
              />
            ) : null}

            <DisciplineSection user={user} />

            <AchievementsSection user={user} />
          </>
        ) : me ? (
          <PairStatsSection
            viewerId={me.id}
            otherId={user.id}
            otherName={user.name}
            groupId={effectiveRatingGroupId}
          />
        ) : null}

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
                });
                // Note: the CF (`sendGameInvite`) bumps the inviter's
                // achievements counter server-side on success, so we
                // no longer call `achievementsService.bump` here.
                setInviteSent(true);
                toast.success(
                  he.playerCardInviteSentToast.replace('{name}', user.name),
                );
              } catch (err) {
                if (__DEV__) console.warn('[PlayerCard] invite failed', err);
                const code = (err as { code?: string })?.code ?? '';
                if (code === 'resource-exhausted') {
                  toast.error(he.inviteRateLimited);
                } else if (code === 'failed-precondition') {
                  toast.error(he.inviteAlreadyJoined);
                } else if (code === 'permission-denied') {
                  toast.error(he.inviteNotAllowed);
                } else {
                  toast.error(he.playerCardInviteFailed);
                }
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
  // Default to the zero shape so the section always renders — even
  // if the stats query is still in flight or it failed silently
  // (missing index, network blip). Without this fallback the whole
  // "אתה ו-X" card would disappear and the user would think the
  // feature is broken.
  const ZERO = {
    registeredTogether: 0,
    attendedTogether: 0,
    sameTeamGames: 0,
    sameTeamRounds: 0,
    firstSharedAt: null as number | null,
    lastSharedAt: null as number | null,
  };
  const [stats, setStats] = useState<typeof ZERO>(ZERO);
  const [sharedNames, setSharedNames] = useState<string[]>([]);

  useEffect(() => {
    let alive = true;
    setStats(ZERO);
    setSharedNames([]);
    gameService
      .getPairStats(viewerId, otherId, groupId)
      .then((s) => {
        if (alive) setStats(s);
      })
      .catch((err) => {
        if (__DEV__) console.warn('[pairStats] query failed', err);
        // keep ZERO so the empty-state still renders
      });
    groupService
      .findSharedCommunities(viewerId, otherId)
      .then((groups) => {
        if (alive) setSharedNames(groups.map((g) => g.name).filter(Boolean));
      })
      .catch((err) => {
        if (__DEV__) console.warn('[pairStats] shared-communities failed', err);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewerId, otherId, groupId]);

  const hasSharedGames =
    stats.registeredTogether > 0 ||
    stats.attendedTogether > 0 ||
    stats.sameTeamGames > 0 ||
    stats.sameTeamRounds > 0;
  return (
    <View style={styles.pairWrap}>
      <Text style={styles.pairTitle}>{he.pairStatsTitle(otherName)}</Text>

      {/* Shared communities up top — that's the most concrete
          "we know each other from..." signal. */}
      {sharedNames.length > 0 ? (
        <Card style={styles.pairSharedCard}>
          <Text style={styles.pairSharedHeader}>
            {he.pairStatsSharedCommunitiesPlural(sharedNames.length)}
          </Text>
          <Text style={styles.pairSharedList} numberOfLines={3}>
            {sharedNames.join(' · ')}
          </Text>
        </Card>
      ) : null}

      {hasSharedGames ? (
        <>
          <View style={styles.pairGrid}>
            <StatTile
              label={he.pairStatsAttended}
              value={String(stats.attendedTogether)}
            />
            <StatTile
              label={he.pairStatsRegistered}
              value={String(stats.registeredTogether)}
            />
            <StatTile
              label={he.pairStatsSameTeamGames}
              value={String(stats.sameTeamGames)}
            />
            <StatTile
              label={he.pairStatsSameTeamRounds}
              value={String(stats.sameTeamRounds)}
            />
          </View>
          {(stats.firstSharedAt || stats.lastSharedAt) ? (
            <Card style={styles.pairTimelineCard}>
              {stats.firstSharedAt ? (
                <View style={styles.pairTimelineRow}>
                  <Text style={styles.pairTimelineLabel}>
                    {he.pairStatsFirstShared}
                  </Text>
                  <Text style={styles.pairTimelineValue}>
                    {formatPairDate(stats.firstSharedAt)}
                  </Text>
                </View>
              ) : null}
              {stats.lastSharedAt &&
              stats.lastSharedAt !== stats.firstSharedAt ? (
                <View style={styles.pairTimelineRow}>
                  <Text style={styles.pairTimelineLabel}>
                    {he.pairStatsLastShared}
                  </Text>
                  <Text style={styles.pairTimelineValue}>
                    {formatPairDate(stats.lastSharedAt)}
                  </Text>
                </View>
              ) : null}
            </Card>
          ) : null}
        </>
      ) : (
        <Card style={styles.pairEmptyCard}>
          <Text style={styles.pairEmpty}>{he.pairStatsNoSharedHistory}</Text>
        </Card>
      )}
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

function RatingSection({
  groupId,
  viewerId,
  ratedUser,
}: {
  groupId: string;
  viewerId: string | null;
  ratedUser: User;
}) {
  const [summary, setSummary] = useState<GroupRatingSummary | null>(null);
  const [open, setOpen] = useState(false);
  const [hasVoted, setHasVoted] = useState(false);

  // Live summary subscription so the badge re-renders right after a save.
  useEffect(() => {
    const unsub = ratingsService.subscribeSummary(
      groupId,
      ratedUser.id,
      setSummary,
    );
    return unsub;
  }, [groupId, ratedUser.id]);

  // Whether the viewer already cast a vote — drives the button label
  // and the prefill in the modal.
  useEffect(() => {
    if (!viewerId || viewerId === ratedUser.id) {
      setHasVoted(false);
      return;
    }
    let alive = true;
    ratingsService.getMyVote(groupId, viewerId, ratedUser.id).then((v) => {
      if (alive) setHasVoted(!!v);
    });
    return () => {
      alive = false;
    };
  }, [groupId, viewerId, ratedUser.id]);

  const isSelf = !!viewerId && viewerId === ratedUser.id;

  return (
    <View style={styles.ratingSection}>
      <Text style={styles.achievementsTitle}>{he.ratingInThisGroup}</Text>
      {summary && summary.count > 0 ? (
        <View style={styles.ratingHeader}>
          <Ionicons
            name="star"
            size={20}
            color={colors.warning}
            style={{ marginEnd: 4 }}
          />
          <Text style={styles.ratingValue}>
            {summary.average.toFixed(1)}
          </Text>
          <Text style={styles.ratingCount}>
            {' · '}
            {he.ratingCount(summary.count)}
          </Text>
        </View>
      ) : (
        <Text style={styles.emptyHint}>{he.ratingNone}</Text>
      )}

      {!isSelf && viewerId ? (
        <Button
          title={hasVoted ? he.ratingButtonReRate : he.ratingButtonRate}
          variant="outline"
          size="sm"
          iconLeft="star-outline"
          onPress={() => setOpen(true)}
          fullWidth
        />
      ) : null}

      <RatingModal
        visible={open}
        groupId={groupId}
        raterUserId={viewerId}
        ratedUserId={ratedUser.id}
        ratedDisplayName={ratedUser.name}
        onClose={() => setOpen(false)}
        onChanged={async () => {
          // Force-refresh the local "have I voted?" flag so the button
          // toggles between "rate" / "update rating" without delay.
          if (viewerId) {
            const v = await ratingsService.getMyVote(
              groupId,
              viewerId,
              ratedUser.id,
            );
            setHasVoted(!!v);
          }
        }}
      />
    </View>
  );
}

function DisciplineSection({ user }: { user: User }) {
  // Read-only: snapshot from last 10 PAST games + last 5 events log.
  // Issue/revoke are post-game admin flows and intentionally do not
  // appear on the public Player Card.
  //
  // The DISPLAYED yellow/red counts come from
  // `getPlayerDisciplineSnapshot` — a windowed view over the user's
  // 10 most recent terminal games. Lifetime counters on
  // `user.discipline` are kept for backward compat but are NOT what
  // the card surfaces.
  //
  // Tri-state UI:
  //   • 'loading' — first fetch in flight; render a small spinner,
  //     never numbers (a 0 here would lie: "clean player" vs
  //     "unknown" must look different).
  //   • 'error'   — fetch failed; render "אין נתונים זמינים".
  //   • Snapshot  — render the actual numbers + caption.
  const state = disciplineService.state(user);
  type SnapshotState =
    | { kind: 'loading' }
    | { kind: 'error' }
    | {
        kind: 'ready';
        yellowCardsLast10: number;
        redCardsLast10: number;
        gamesCounted: number;
      };
  const [snapshot, setSnapshot] = useState<SnapshotState>({ kind: 'loading' });
  useEffect(() => {
    let alive = true;
    setSnapshot({ kind: 'loading' });
    disciplineService
      .getPlayerDisciplineSnapshot(user.id)
      .then((s) => {
        if (alive) {
          setSnapshot({
            kind: 'ready',
            yellowCardsLast10: s.yellowCardsLast10,
            redCardsLast10: s.redCardsLast10,
            gamesCounted: s.gamesCounted,
          });
        }
      })
      .catch((err) => {
        if (__DEV__) {
          console.warn('[playerCard] discipline snapshot failed', err);
        }
        if (alive) setSnapshot({ kind: 'error' });
      });
    return () => {
      alive = false;
    };
  }, [user.id]);
  const RECENT_MS = 30 * 24 * 60 * 60 * 1000;
  const hasRecentRed = state.events.some(
    (e) => e.type === 'red' && Date.now() - e.createdAt < RECENT_MS,
  );

  const captionText =
    snapshot.kind === 'ready'
      ? snapshot.gamesCounted === 0
        ? he.disciplineSnapshotEmpty
        : snapshot.gamesCounted >= 10
          ? he.disciplineSnapshotCaptionFull
          : he.disciplineSnapshotCaptionPartial(snapshot.gamesCounted)
      : null;

  return (
    <View style={styles.disciplineSection}>
      <View style={styles.disciplineHeader}>
        <Text style={styles.achievementsTitle}>{he.disciplineTitle}</Text>
        {snapshot.kind === 'loading' ? (
          <SoccerBallLoader size={20} />
        ) : snapshot.kind === 'error' ? (
          <Text style={styles.disciplineUnavailable}>
            {he.disciplineSnapshotUnavailable}
          </Text>
        ) : (
          <DisciplineCards
            yellowCards={snapshot.yellowCardsLast10}
            redCards={snapshot.redCardsLast10}
            size={32}
          />
        )}
      </View>
      {captionText ? (
        <Text style={styles.disciplineCaption}>{captionText}</Text>
      ) : null}
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
                <Text style={styles.eventReason}>{reasonLabel(e.reason)}</Text>
                <Text style={styles.eventDate}>
                  {formatHebrewDate(e.createdAt)}
                </Text>
              </View>
            </View>
          ))}
        </Card>
      )}
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
    gap: spacing.sm,
  },
  pairTitle: {
    ...typography.body,
    color: colors.text,
    fontWeight: '800',
    textAlign: RTL_LABEL_ALIGN,
  },
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
