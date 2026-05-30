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
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
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

import { ScreenHeader } from '@/components/ScreenHeader';
import { Card } from '@/components/Card';
import { PlayerIdentity } from '@/components/PlayerIdentity';
import { SoccerBallLoader } from '@/components/SoccerBallLoader';
import { gameService } from '@/services/gameService';
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
    } catch {
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

  // Resolve admin set for this game's group so we can flag the
  // organizer/coaches in the roster.
  const adminIds = useMemo(() => {
    if (!game) return new Set<string>();
    const g = groups.find((x) => x.id === game.groupId);
    return new Set<string>(g?.adminIds ?? []);
  }, [game, groups]);

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
        };
      });
    },
    [playersMap, adminIds, game?.arrivals, ballBringers],
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
  // admin sees fresh drop-outs at the top of the section.
  const cancelledEntries = (() => {
    const map = game.cancellations ?? {};
    const uids = Object.keys(map).sort((a, b) => (map[b] ?? 0) - (map[a] ?? 0));
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
                />
              ))}
              {guests.map((g, i) => (
                <GuestRow
                  key={g.id}
                  guest={g}
                  showDivider={i + playerEntries.length > 0}
                />
              ))}
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
                            Alert.alert(
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
                              await gameService.approveGameJoin(
                                game.id,
                                e.user.id,
                              );
                              toast.success(he.matchPlayersApproveDone);
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
                            Alert.alert(
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
}) {
  const { user, isAdmin, arrival, isBringingBall } = entry;
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
          </View>
          {offerHint ? (
            <Text style={styles.offerHint}>{offerHint}</Text>
          ) : arrival === 'late' ? (
            <Tag label={he.matchPlayersLateTag} tone="warning" inline />
          ) : arrival === 'no_show' ? (
            <Tag label={he.matchPlayersNoShowTag} tone="danger" inline />
          ) : null}
        </View>
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
    </View>
  );
}

function GuestRow({ guest, showDivider }: { guest: GameGuest; showDivider: boolean }) {
  return (
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
    </View>
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
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
