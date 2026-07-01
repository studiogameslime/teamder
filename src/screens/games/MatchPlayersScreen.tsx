// MatchPlayersScreen — full roster for a single game.
//
// Sections:
//   • שחקנים רשומים    (in `players[]`)
//   • רשימת המתנה      (in `waitlist[]`)
//   • ממתינים לאישור   (in `pending[]`)   — admin sees count; users
//                                            who are in pending see
//                                            themselves too
//   • אורחים            (g.guests)
//
// Each player row shows: jersey, name, optional admin badge, optional
// late/no-show indicator pulled from `arrivals` map.
//
// Tap → PlayerCard.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { appAlert } from '@/components/AppDialog';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  RouteProp,
  useFocusEffect,
  useNavigation,
  useRoute,
} from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { ScreenHeader } from '@/components/ScreenHeader';
import { Card } from '@/components/Card';
import { GuestModal } from '@/components/GuestModal';
import { AdminRatingSheet } from '@/components/AdminRatingSheet';
import { PlayerIdentity } from '@/components/PlayerIdentity';
import { SoccerBallLoader } from '@/components/SoccerBallLoader';
import { formatRating, isRated } from '@/utils/rating';
import { gameService } from '@/services/gameService';
import { groupService } from '@/services/groupService';
import { isTerminalGame } from '@/services/gameLifecycle';
import { logError } from '@/services/errorLog';
import { useGameStore } from '@/store/gameStore';
import { useGroupStore } from '@/store/groupStore';
import { useUserStore } from '@/store/userStore';
import { colors, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { toast } from '@/components/Toast';
import { he } from '@/i18n/he';
import type { ArrivalStatus, Game, GameGuest, User, UserId } from '@/types';
import type { GameStackParamList } from '@/navigation/GameStack';

type Nav = NativeStackNavigationProp<GameStackParamList, 'MatchPlayers'>;
type Params = RouteProp<GameStackParamList, 'MatchPlayers'>;

interface RosterEntry {
  user: Pick<User, 'id' | 'name' | 'avatarId' | 'photoUrl'>;
  isAdmin: boolean;
  arrival?: ArrivalStatus;
  isBringingBall?: boolean;
  /** Holds the club's ball / jerseys (from the end-evening handoff). */
  holdsBall?: boolean;
  holdsJerseys?: boolean;
  /** Admin internal rating (0 = unrated). Only carried for admin viewers in
   *  internal-rating communities — members never receive it. */
  rating?: number;
}

export function MatchPlayersScreen() {
  const nav = useNavigation<Nav>();
  const { gameId } = useRoute<Params>().params;

  const playersMap = useGameStore((s) => s.players);
  const hydratePlayers = useGameStore((s) => s.hydratePlayers);
  const groups = useGroupStore((s) => s.groups);
  const currentUser = useUserStore((s) => s.currentUser);

  const [game, setGame] = useState<Game | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyOffer, setBusyOffer] = useState(false);
  // Guest being edited (rename by admin / rate by the adder).
  const [editingGuest, setEditingGuest] = useState<GameGuest | null>(null);
  // Admin internal-rating editor target (player id + name) + save spinner.
  const [ratingTarget, setRatingTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [savingRating, setSavingRating] = useState(false);

  const reload = useCallback(async () => {
    if (!gameId) {
      setGame(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const g = await gameService.getGameById(gameId);
      setGame(g);
      if (g) {
        const uids = Array.from(
          new Set([...g.players, ...g.waitlist, ...(g.pending ?? [])]),
        );
        if (uids.length > 0) hydratePlayers(uids);
      }
    } catch (err) {
      logError('matchPlayersLoad', err, {
        screen: 'MatchPlayersScreen',
        gameId,
      });
      setGame(null);
    } finally {
      setLoading(false);
    }
  }, [gameId, hydratePlayers]);

  useEffect(() => {
    reload();
  }, [reload]);
  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  // The game's community — source of admin set, internal ratings, and the
  // club ball/jersey holders (all live via the groups store).
  const group = useMemo(
    () => (game ? groups.find((x) => x.id === game.groupId) : undefined),
    [game, groups],
  );
  // Resolve admin set for this game's group so we can flag the
  // organizer/coaches in the roster.
  const adminIds = useMemo(
    () => new Set<string>(group?.adminIds ?? []),
    [group],
  );
  const internalRating = group?.internalRating === true;
  const iAmAdmin = adminIds.has(currentUser?.id ?? '');
  // Internal ratings are admin-only — show solely to admins, and only when the
  // community runs in internal-rating mode (user report: admin couldn't see
  // the ratings they'd assigned on the match roster).
  const showRatings = internalRating && iAmAdmin;
  // Club equipment holders (carried over from the end-evening handoff) so the
  // roster surfaces who has the ball / jerseys, same as the community list.
  const ballHolders = useMemo(
    () => new Set<string>(group?.ballHolderIds ?? []),
    [group?.ballHolderIds],
  );
  const jerseyHolders = useMemo(
    () => new Set<string>(group?.jerseysHolderIds ?? []),
    [group?.jerseysHolderIds],
  );

  // Set of uids stamped as "I'm bringing a ball" on this game. Only
  // meaningful for users in `players[]` — waitlist / pending / cancelled
  // entries never carry the badge (matches the MatchDetails preview).
  const ballBringers = useMemo(
    () => new Set(game?.ballBringerIds ?? []),
    [game?.ballBringerIds],
  );

  const buildEntries = useCallback(
    (uids: string[], opts?: { withBall?: boolean }): RosterEntry[] => {
      return uids.map((uid) => {
        const p = playersMap[uid];
        return {
          user: {
            id: uid,
            name: p?.displayName ?? '...',
            avatarId: p?.avatarId,
            photoUrl: p?.photoUrl,
          },
          isAdmin: adminIds.has(uid),
          arrival: game?.arrivals?.[uid],
          isBringingBall: opts?.withBall ? ballBringers.has(uid) : false,
          holdsBall: ballHolders.has(uid),
          holdsJerseys: jerseyHolders.has(uid),
          rating: showRatings ? group?.adminRatings?.[uid] : undefined,
        };
      });
    },
    [
      playersMap,
      adminIds,
      game?.arrivals,
      ballBringers,
      ballHolders,
      jerseyHolders,
      showRatings,
      group?.adminRatings,
    ],
  );

  // Admin-only: kick a registered player off the game. Confirms first,
  // then calls the service (which also offers the freed slot to the
  // head of the waitlist) and reloads the roster.
  const isAdminViewer = iAmAdmin;
  const handleRemovePlayer = useCallback(
    (uid: string, name: string) => {
      if (!game || !currentUser) return;
      appAlert('הסרת שחקן', `להסיר את ${name} מהמשחק?`, [
        { text: he.cancel, style: 'cancel' },
        {
          text: 'הסר',
          style: 'destructive',
          onPress: async () => {
            try {
              await gameService.removePlayer(game.id, currentUser.id, uid);
              toast.success('השחקן הוסר מהמשחק');
              await reload();
            } catch (err) {
              logError('matchPlayersRemove', err, {
                screen: 'MatchPlayersScreen',
                gameId: game.id,
                targetUserId: uid,
              });
              toast.error(String((err as Error)?.message ?? err));
            }
          },
        },
      ]);
    },
    [game, currentUser, reload],
  );

  // Admin saves a player's internal rating. The groups store is live, so the
  // chip refreshes from the snapshot — just close the sheet on success.
  const saveAdminRating = useCallback(
    async (playerId: string, rating: number | null) => {
      if (!group || !currentUser) return;
      setSavingRating(true);
      try {
        await groupService.setAdminRating(
          group.id,
          currentUser.id,
          playerId,
          rating,
        );
        setRatingTarget(null);
      } catch (err) {
        logError('matchPlayersSetRating', err, {
          screen: 'MatchPlayersScreen',
          groupId: group.id,
          targetUserId: playerId,
        });
        toast.error(he.error);
      } finally {
        setSavingRating(false);
      }
    },
    [group, currentUser],
  );

  if (loading && !game) {
    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <ScreenHeader title={he.matchPlayersScreenTitle} />
        <View style={styles.center}>
          <SoccerBallLoader size={40} />
        </View>
      </SafeAreaView>
    );
  }
  if (!game) {
    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <ScreenHeader title={he.matchPlayersScreenTitle} />
        <View style={styles.center}>
          <Text style={styles.emptyText}>{he.matchDetailsNotFound}</Text>
        </View>
      </SafeAreaView>
    );
  }

  const playerEntries = buildEntries(game.players ?? [], { withBall: true });
  const waitlistEntries = buildEntries(game.waitlist ?? []);
  const pendingEntries = buildEntries(game.pending ?? []);
  const guests = game.guests ?? [];
  // Anyone who joined and then cancelled. Sort newest-first so the
  // admin sees fresh drop-outs at the top of the section. EXCLUDE anyone
  // who's currently back in the roster — a stale `cancellations[uid]` entry
  // (a re-join that didn't clear it) otherwise showed the same player both
  // in the roster AND in "ביטלו השתתפות" (user report).
  const cancelledEntries = (() => {
    const map = game.cancellations ?? {};
    const active = new Set<string>([
      ...(game.players ?? []),
      ...(game.waitlist ?? []),
      ...(game.pending ?? []),
    ]);
    const uids = Object.keys(map)
      .filter((uid) => !active.has(uid))
      .sort((a, b) => (map[b] ?? 0) - (map[a] ?? 0));
    return buildEntries(uids).map((e) => ({
      ...e,
      cancelledAt: map[e.user.id] ?? 0,
    }));
  })();
  const lateCancelThresholdMs =
    typeof game.cancelDeadlineHours === 'number' && game.cancelDeadlineHours > 0
      ? game.startsAt - game.cancelDeadlineHours * 60 * 60 * 1000
      : 0;

  const goToCard = (uid: string) =>
    (nav as { navigate: (s: string, p: unknown) => void }).navigate(
      'PlayerCard',
      { userId: uid, groupId: game.groupId },
    );

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <ScreenHeader title={he.matchPlayersScreenTitle} />
      <ScrollView contentContainerStyle={styles.content}>
        {/* Unified registered list: real players first, then guests
            tagged "אורח" — earlier we split them into two distinct
            sections, which made it harder to gauge total roster
            capacity at a glance. The total count in the header now
            includes guests so the "N/maxPlayers" badge matches what
            the live capacity counter reads. */}
        <Section
          title={he.matchPlayersSectionRegistered}
          count={`${playerEntries.length + guests.length}/${game.maxPlayers}`}
        >
          {playerEntries.length === 0 && guests.length === 0 ? (
            <Empty />
          ) : (
            <Card style={styles.listCard}>
              {playerEntries.map((e, i) => (
                <PlayerRow
                  key={e.user.id}
                  entry={e}
                  showDivider={i > 0}
                  onPress={() => goToCard(e.user.id)}
                  // Admin-only kick. Hidden once the game is terminal
                  // (finished / cancelled — read-only) and never offered
                  // for the game's own organizer to avoid removing the
                  // host from their own match.
                  onRemove={
                    isAdminViewer &&
                    !isTerminalGame(game) &&
                    game.createdBy !== e.user.id
                      ? () => handleRemovePlayer(e.user.id, e.user.name)
                      : undefined
                  }
                  onSetRating={
                    showRatings
                      ? () =>
                          setRatingTarget({ id: e.user.id, name: e.user.name })
                      : undefined
                  }
                />
              ))}
              {guests.map((g, i) => {
                const isAdder = currentUser?.id === g.addedBy;
                const canSeeRating = isAdder || isAdminViewer;
                // The adder edits the rating; the admin can rename. Either
                // reason opens the editor (the modal gates the fields).
                const canEdit = isAdder || isAdminViewer;
                return (
                  <GuestRow
                    key={g.id}
                    guest={g}
                    showDivider={i + playerEntries.length > 0}
                    rating={canSeeRating ? g.estimatedRating : undefined}
                    onPress={
                      canEdit ? () => setEditingGuest(g) : undefined
                    }
                  />
                );
              })}
            </Card>
          )}
        </Section>

        {waitlistEntries.length > 0 ? (
          <Section
            title={he.matchPlayersSectionWaitlist}
            count={String(waitlistEntries.length)}
          >
            <Card style={styles.listCard}>
              {waitlistEntries.map((e, i) => {
                const isOffered = game.pendingPromotion?.uid === e.user.id;
                const isMyOffer =
                  isOffered && currentUser?.id === e.user.id;
                const isAdminViewer = adminIds.has(currentUser?.id ?? '');
                return (
                  <PlayerRow
                    key={e.user.id}
                    entry={e}
                    showDivider={i > 0}
                    onPress={() => goToCard(e.user.id)}
                    toneRight={
                      isOffered ? he.matchPlayersOfferPendingTag : he.matchPlayersWaitlistTag
                    }
                    offerHint={
                      isOffered && game.pendingPromotion
                        ? he.matchPlayersOfferOfferedAgo(
                            Math.floor(
                              (Date.now() - game.pendingPromotion.offeredAt) / 60000,
                            ),
                          )
                        : undefined
                    }
                    onConfirmOffer={
                      isMyOffer && !busyOffer
                        ? async () => {
                            setBusyOffer(true);
                            try {
                              await gameService.confirmSpotOffer(
                                game.id,
                                currentUser!.id,
                              );
                              await reload();
                            } catch {
                              // stale offer / network — silent
                            } finally {
                              setBusyOffer(false);
                            }
                          }
                        : undefined
                    }
                    onPassOffer={
                      isMyOffer && !busyOffer
                        ? async () => {
                            setBusyOffer(true);
                            try {
                              await gameService.passSpotOffer(
                                game.id,
                                currentUser!.id,
                              );
                              await reload();
                            } catch {
                              // ignore
                            } finally {
                              setBusyOffer(false);
                            }
                          }
                        : undefined
                    }
                    onAdminAdvance={
                      isOffered && !isMyOffer && isAdminViewer && !busyOffer
                        ? () => {
                            appAlert(
                              he.matchPlayersOfferAdvanceCta,
                              he.matchPlayersOfferAdvanceConfirm,
                              [
                                { text: 'ביטול', style: 'cancel' },
                                {
                                  text: he.matchPlayersOfferAdvanceCta,
                                  onPress: async () => {
                                    setBusyOffer(true);
                                    try {
                                      await gameService.adminAdvanceOffer(
                                        game.id,
                                      );
                                      await reload();
                                    } catch {
                                      // ignore
                                    } finally {
                                      setBusyOffer(false);
                                    }
                                  },
                                },
                              ],
                            );
                          }
                        : undefined
                    }
                    onSetRating={
                      showRatings
                        ? () =>
                            setRatingTarget({ id: e.user.id, name: e.user.name })
                        : undefined
                    }
                  />
                );
              })}
            </Card>
          </Section>
        ) : null}

        {pendingEntries.length > 0 ? (
          <Section
            title={he.matchPlayersSectionPending}
            count={String(pendingEntries.length)}
          >
            <Card style={styles.listCard}>
              {pendingEntries.map((e, i) => {
                const isAdminViewer = adminIds.has(currentUser?.id ?? '');
                return (
                  <PlayerRow
                    key={e.user.id}
                    entry={e}
                    showDivider={i > 0}
                    onPress={() => goToCard(e.user.id)}
                    toneRight={he.matchPlayersPendingTag}
                    // Admin-only: approve moves the requester into
                    // players[] (or waitlist if full) and pushes them an
                    // `approved`; reject drops them from pending[] and
                    // pushes `rejected`. Both reload the roster.
                    onApprove={
                      isAdminViewer
                        ? async () => {
                            try {
                              const r = await gameService.approveGameJoin(
                                game.id,
                                e.user.id,
                              );
                              // Full game → the approved player lands on the
                              // waitlist; tell the admin so it's not a silent
                              // "approved" that looks like a squad spot (J2vGVko0).
                              if (r?.bucket === 'waitlist') {
                                toast.info(he.requestsApprovedToWaitlist);
                              } else {
                                toast.success(he.matchPlayersApproveDone);
                              }
                              await reload();
                            } catch (err) {
                              toast.error(String((err as Error)?.message ?? err));
                            }
                          }
                        : undefined
                    }
                    onReject={
                      isAdminViewer
                        ? () =>
                            appAlert(
                              he.matchPlayersRejectTitle,
                              he.matchPlayersRejectBody(e.user.name),
                              [
                                { text: he.cancel, style: 'cancel' },
                                {
                                  text: he.matchPlayersRejectCta,
                                  style: 'destructive',
                                  onPress: async () => {
                                    try {
                                      await gameService.rejectGameJoin(
                                        game.id,
                                        e.user.id,
                                      );
                                      await reload();
                                    } catch (err) {
                                      toast.error(
                                        String((err as Error)?.message ?? err),
                                      );
                                    }
                                  },
                                },
                              ],
                            )
                        : undefined
                    }
                    onSetRating={
                      showRatings
                        ? () =>
                            setRatingTarget({ id: e.user.id, name: e.user.name })
                        : undefined
                    }
                  />
                );
              })}
            </Card>
          </Section>
        ) : null}

        {/* Guests-only section retired — guests now render inline
            within the "registered" section above. */}

        {cancelledEntries.length > 0 ? (
          <Section
            title={he.matchPlayersSectionCancelled}
            count={String(cancelledEntries.length)}
          >
            <Card style={styles.listCard}>
              {cancelledEntries.map((e, i) => {
                const isLate =
                  lateCancelThresholdMs > 0 &&
                  e.cancelledAt > lateCancelThresholdMs;
                return (
                  <PlayerRow
                    key={e.user.id}
                    entry={e}
                    showDivider={i > 0}
                    onPress={() => goToCard(e.user.id)}
                    toneRight={
                      isLate
                        ? he.matchPlayersCancelledLateTag
                        : he.matchPlayersCancelledTag
                    }
                    offerHint={he.matchPlayersCancelledAgo(
                      formatRelative(e.cancelledAt),
                    )}
                  />
                );
              })}
            </Card>
          </Section>
        ) : null}
      </ScrollView>

      {currentUser ? (
        <GuestModal
          visible={!!editingGuest}
          gameId={game.id}
          callerId={currentUser.id}
          existing={editingGuest}
          isAdmin={isAdminViewer}
          onClose={() => setEditingGuest(null)}
          onChanged={(action, saved) => {
            // Reflect the change IMMEDIATELY (don't wait for the reload) so an
            // edited guest rating updates on the spot, then refresh in bg.
            setGame((g) =>
              g
                ? {
                    ...g,
                    guests:
                      action === 'added'
                        ? [...(g.guests ?? []), saved]
                        : (g.guests ?? []).map((x) =>
                            x.id === saved.id ? saved : x,
                          ),
                  }
                : g,
            );
            reload();
          }}
        />
      ) : null}

      <AdminRatingSheet
        target={ratingTarget}
        current={
          ratingTarget ? group?.adminRatings?.[ratingTarget.id] ?? 0 : 0
        }
        saving={savingRating}
        onClose={() => setRatingTarget(null)}
        onSave={(rating) =>
          ratingTarget && saveAdminRating(ratingTarget.id, rating)
        }
      />
    </SafeAreaView>
  );
}

/** Hebrew "ago" string — terse so it fits next to the row. */
function formatRelative(ts: number): string {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'עכשיו';
  if (mins < 60) return `לפני ${mins} דק׳`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `לפני ${hours} שע׳`;
  const days = Math.floor(hours / 24);
  return `לפני ${days} ימים`;
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>
        {title}
        {count ? <Text style={styles.sectionCount}> ({count})</Text> : null}
      </Text>
      {children}
    </View>
  );
}

function Empty() {
  return <Text style={styles.emptyText}>{he.matchPlayersEmpty}</Text>;
}

function PlayerRow({
  entry,
  showDivider,
  onPress,
  toneRight,
  offerHint,
  onConfirmOffer,
  onPassOffer,
  onAdminAdvance,
  onApprove,
  onReject,
  onRemove,
  onSetRating,
}: {
  entry: RosterEntry;
  showDivider: boolean;
  onPress: () => void;
  toneRight?: string;
  offerHint?: string;
  onConfirmOffer?: () => void;
  onPassOffer?: () => void;
  onAdminAdvance?: () => void;
  onApprove?: () => void;
  onReject?: () => void;
  onRemove?: () => void;
  /** Admin-only: open the internal-rating editor for this player. When
   *  provided, the rating chip renders (showing the value, or "דרג"). */
  onSetRating?: () => void;
}) {
  const { user, isAdmin, arrival, isBringingBall, holdsBall, holdsJerseys, rating } =
    entry;
  // `onRemove` is NOT here on purpose — a plain "remove player" renders as
  // a compact inline icon on the row instead of a full-width pink bar, which
  // looked cluttered down a long roster (user report). The prominent
  // full-width buttons are reserved for offer/approve/reject.
  const showOfferActions = !!(
    onConfirmOffer ||
    onPassOffer ||
    onAdminAdvance ||
    onApprove ||
    onReject
  );
  return (
    <View
      style={[
        styles.row,
        showDivider && styles.rowDivider,
        showOfferActions && styles.rowOffered,
      ]}
    >
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          styles.rowBodyPressable,
          pressed && { opacity: 0.6 },
        ]}
        accessibilityRole="button"
        accessibilityLabel={user.name}
      >
        <PlayerIdentity user={user} size="sm" />
        <View style={styles.rowBody}>
          <View style={styles.nameRow}>
            <Text style={styles.name} numberOfLines={1}>
              {user.name}
            </Text>
            {isAdmin ? (
              <Tag label={he.matchPlayersAdminTag} tone="primary" />
            ) : null}
            {holdsBall ? (
              <View
                style={styles.holderBadge}
                accessibilityLabel={he.equipmentHolderBallA11y}
              >
                <Ionicons name="football" size={13} color="#1D4ED8" />
              </View>
            ) : null}
            {holdsJerseys ? (
              <View
                style={styles.holderBadge}
                accessibilityLabel={he.equipmentHolderJerseysA11y}
              >
                <Ionicons name="shirt" size={13} color="#7C3AED" />
              </View>
            ) : null}
          </View>
          {offerHint ? (
            <Text style={styles.offerHint}>{offerHint}</Text>
          ) : arrival === 'late' ? (
            <Tag label={he.matchPlayersLateTag} tone="warning" inline />
          ) : arrival === 'no_show' ? (
            <Tag label={he.matchPlayersNoShowTag} tone="danger" inline />
          ) : null}
        </View>
        {/* Admin-only internal-rating chip — shows the value (or "דרג"), taps
            open the editor. A nested Pressable so it works inside the row. */}
        {onSetRating ? (
          <Pressable
            onPress={onSetRating}
            hitSlop={6}
            style={({ pressed }) => [
              styles.ratingChip,
              pressed && { opacity: 0.6 },
            ]}
          >
            <Ionicons name="star" size={12} color={colors.warning} />
            <Text style={styles.ratingChipText}>
              {isRated(rating) ? formatRating(rating) : he.communityAdminRatingSet}
            </Text>
          </Pressable>
        ) : null}
        {isBringingBall ? (
          <View style={styles.ballBadge}>
            <Ionicons name="football" size={14} color="#1D4ED8" />
          </View>
        ) : null}
        {toneRight ? (
          <Text style={styles.toneRight} numberOfLines={1}>
            {toneRight}
          </Text>
        ) : null}
        <Ionicons name="chevron-back" size={16} color={colors.textMuted} />
      </Pressable>
      {showOfferActions ? (
        <View style={styles.offerActions}>
          {onConfirmOffer ? (
            <Pressable
              onPress={onConfirmOffer}
              style={({ pressed }) => [
                styles.offerCta,
                styles.offerCtaPrimary,
                pressed && { opacity: 0.8 },
              ]}
            >
              <Text style={styles.offerCtaPrimaryText}>
                {he.matchPlayersOfferConfirmCta}
              </Text>
            </Pressable>
          ) : null}
          {onPassOffer ? (
            <Pressable
              onPress={onPassOffer}
              style={({ pressed }) => [
                styles.offerCta,
                styles.offerCtaGhost,
                pressed && { opacity: 0.6 },
              ]}
            >
              <Text style={styles.offerCtaGhostText}>
                {he.matchPlayersOfferPassCta}
              </Text>
            </Pressable>
          ) : null}
          {onAdminAdvance ? (
            <Pressable
              onPress={onAdminAdvance}
              style={({ pressed }) => [
                styles.offerCta,
                styles.offerCtaGhost,
                pressed && { opacity: 0.6 },
              ]}
            >
              <Text style={styles.offerCtaGhostText}>
                {he.matchPlayersOfferAdvanceCta}
              </Text>
            </Pressable>
          ) : null}
          {onApprove ? (
            <Pressable
              onPress={onApprove}
              style={({ pressed }) => [
                styles.offerCta,
                styles.offerCtaPrimary,
                pressed && { opacity: 0.8 },
              ]}
              accessibilityLabel={he.matchPlayersApproveCta}
            >
              <Text style={styles.offerCtaPrimaryText}>
                {he.matchPlayersApproveCta}
              </Text>
            </Pressable>
          ) : null}
          {onReject ? (
            <Pressable
              onPress={onReject}
              style={({ pressed }) => [
                styles.offerCta,
                styles.offerCtaGhost,
                pressed && { opacity: 0.6 },
              ]}
              accessibilityLabel={he.matchPlayersRejectCta}
            >
              <Text style={styles.offerCtaGhostText}>
                {he.matchPlayersRejectCta}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {/* Compact inline remove — a small icon at the row's end instead of a
          full-width bar (only shown when there are no offer/approve actions
          stacking below). */}
      {onRemove && !showOfferActions ? (
        <Pressable
          onPress={onRemove}
          hitSlop={8}
          style={({ pressed }) => [
            styles.inlineRemoveBtn,
            pressed && { opacity: 0.6 },
          ]}
          accessibilityRole="button"
          accessibilityLabel="הסר שחקן"
        >
          <Ionicons name="person-remove-outline" size={18} color={colors.danger} />
        </Pressable>
      ) : null}
    </View>
  );
}

function GuestRow({
  guest,
  showDivider,
  rating,
  onPress,
}: {
  guest: GameGuest;
  showDivider: boolean;
  /** Shown only when the viewer is allowed to see it (adder or admin). */
  rating?: number;
  /** When set, the row is tappable to open the guest editor. */
  onPress?: () => void;
}) {
  const body = (
    <View style={[styles.row, showDivider && styles.rowDivider]}>
      <View style={styles.guestAvatar}>
        <Ionicons name="person" size={18} color={colors.textMuted} />
      </View>
      <View style={styles.rowBody}>
        <Text style={styles.name} numberOfLines={1}>
          {guest.name}
        </Text>
        <Text style={styles.guestSub}>{he.matchPlayersGuestTag}</Text>
      </View>
      {rating != null ? (
        <View style={styles.guestRatingPill}>
          <Ionicons name="star" size={13} color={colors.primary} />
          <Text style={styles.guestRatingText}>{rating}</Text>
        </View>
      ) : null}
      {onPress ? (
        <Ionicons
          name="create-outline"
          size={18}
          color={colors.textMuted}
          style={styles.guestEditIcon}
        />
      ) : null}
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable onPress={onPress} android_ripple={{ color: colors.surfaceMuted }}>
      {body}
    </Pressable>
  );
}

function Tag({
  label,
  tone,
  inline,
}: {
  label: string;
  tone: 'primary' | 'warning' | 'danger';
  inline?: boolean;
}) {
  const palette =
    tone === 'primary'
      ? { bg: colors.primaryLight, fg: colors.primary }
      : tone === 'warning'
        ? { bg: '#FEF3C7', fg: '#B45309' }
        : { bg: '#FEE2E2', fg: colors.danger };
  return (
    <View
      style={[
        styles.tag,
        { backgroundColor: palette.bg },
        inline && { alignSelf: 'flex-start', marginTop: 2 },
      ]}
    >
      <Text style={[styles.tagText, { color: palette.fg }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: {
    padding: spacing.lg,
    gap: spacing.lg,
    paddingBottom: spacing.xl,
  },
  section: { gap: spacing.sm },
  sectionTitle: {
    ...typography.body,
    color: colors.text,
    fontWeight: '800',
    textAlign: RTL_LABEL_ALIGN,
  },
  sectionCount: {
    color: colors.textMuted,
    fontWeight: '500',
    fontSize: 14,
  },
  listCard: { padding: 0, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  rowOffered: {
    flexDirection: 'column',
    alignItems: 'stretch',
    paddingBottom: spacing.sm,
    backgroundColor: 'rgba(59,130,246,0.06)',
  },
  rowBodyPressable: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  inlineRemoveBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceMuted,
  },
  rowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
  },
  rowBody: { flex: 1, gap: 4 },
  offerHint: {
    ...typography.caption,
    color: '#3B82F6',
    fontWeight: '600',
    textAlign: RTL_LABEL_ALIGN,
  },
  offerActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
    flexWrap: 'wrap',
  },
  offerCta: {
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  offerCtaPrimary: {
    backgroundColor: '#3B82F6',
    flex: 1,
    minWidth: 100,
  },
  offerCtaPrimaryText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  offerCtaGhost: {
    borderWidth: 1,
    borderColor: colors.border,
    flex: 1,
    minWidth: 100,
  },
  offerCtaGhostText: {
    color: colors.text,
    fontWeight: '600',
    fontSize: 14,
  },
  offerCtaDanger: {
    borderWidth: 1,
    borderColor: '#FECACA',
    backgroundColor: '#FEE2E2',
    flex: 1,
    minWidth: 100,
  },
  offerCtaDangerText: {
    color: colors.danger,
    fontWeight: '700',
    fontSize: 14,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  name: {
    ...typography.body,
    color: colors.text,
    fontWeight: '700',
    textAlign: RTL_LABEL_ALIGN,
    flexShrink: 1,
  },
  toneRight: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '600',
  },
  guestAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  guestSub: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
  },
  guestRatingPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: colors.surfaceMuted,
  },
  guestRatingText: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '700',
  },
  guestEditIcon: {
    marginStart: 6,
  },
  tag: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },
  ballBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#DBEAFE',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  holderBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ratingChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.surfaceMuted,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  ratingChipText: {
    ...typography.caption,
    color: colors.text,
    fontWeight: '800',
  },
  tagText: {
    ...typography.caption,
    fontWeight: '700',
    fontSize: 11,
  },
  emptyText: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
  },
});
